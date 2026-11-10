import { describe, it, expect, vi } from 'vitest';
import type { AICompletionOptions, AIMessage, AIProviderType } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import type { ResolvedKeyInfo } from '../src/ai/key-resolver.js';
import {
  auditAiRequestBudget,
  classifyAiError,
  isKeyRefused,
  resolveAuditAi,
  type ResolveAuditAiDeps,
} from '../src/audit/ai/stage-ai.js';

const TEST_KEY = 'test-key-not-real';
const MESSAGES: AIMessage[] = [{ role: 'user', content: 'Assess the homepage.' }];

function fakeProvider(type: AIProviderType, answer = 'Two headings skip a level.') {
  const calls: AICompletionOptions[] = [];
  const provider: AIProvider = {
    providerType: type,
    async generateText(_messages, options) {
      calls.push(options ?? {});
      return answer;
    },
  };
  return { provider, calls };
}

function keysFor(found: ResolvedKeyInfo | null) {
  return { resolveKey: vi.fn(async (_preferred?: AIProviderType) => found) };
}

function setup(overrides: Partial<ResolveAuditAiDeps> = {}, answer?: string) {
  const fake = fakeProvider('openrouter', answer);
  const createProvider = vi.fn((_type: AIProviderType, _key: string) => fake.provider);
  const deps: ResolveAuditAiDeps = {
    setup: { provider: 'openrouter', text: 'default/text', vision: 'default/vision' },
    keys: keysFor({ provider: 'openrouter', apiKey: TEST_KEY, source: 'keychain' }),
    createProvider,
    ...overrides,
  };
  return { deps, createProvider, calls: fake.calls };
}

describe('resolveAuditAi', () => {
  it("REQ-011 AC-1: calls the saved provider with the tool user's key", async () => {
    const { deps, createProvider, calls } = setup();
    const resolved = await resolveAuditAi(deps);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(deps.keys.resolveKey).toHaveBeenCalledWith('openrouter');
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledWith('openrouter', TEST_KEY);
    const answer = await resolved.ai.ask('documents', MESSAGES);
    expect(answer).toMatchObject({ ok: true, completion: { text: 'Two headings skip a level.' } });
    expect(calls).toHaveLength(1);
  });

  it('REQ-011 AC-2: no key means no provider, no request, and reason no-ai-key', async () => {
    const { deps, createProvider } = setup({ keys: keysFor(null) });
    expect(await resolveAuditAi(deps)).toEqual({ ok: false, reason: 'no-ai-key' });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('treats an empty key as no key', async () => {
    const { deps, createProvider } = setup({
      keys: keysFor({ provider: 'openrouter', apiKey: '', source: 'env' }),
    });
    expect(await resolveAuditAi(deps)).toEqual({ ok: false, reason: 'no-ai-key' });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('REQ-039 AC-1: each stage sends its own model', async () => {
    const { deps, calls } = setup({ models: { assessment: 'model/A', rewrite: 'model/B' } });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    const a = await resolved.ai.ask('assessment', MESSAGES);
    const b = await resolved.ai.ask('rewrite', MESSAGES);
    expect(calls.map((c) => [c.stage, c.model])).toEqual([
      ['assessment', 'model/A'],
      ['rewrite', 'model/B'],
    ]);
    expect(a).toMatchObject({ ok: true, model: 'model/A' });
    expect(b).toMatchObject({ ok: true, model: 'model/B' });
  });

  it('REQ-039 AC-1: a stage without its own model uses its slot default', async () => {
    const { deps, calls } = setup({ models: {} });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    for (const stage of ['assessment', 'documents', 'preview', 'rewrite'] as const) {
      await resolved.ai.ask(stage, MESSAGES);
    }
    expect(calls.map((c) => [c.stage, c.model])).toEqual([
      ['assessment', 'default/vision'],
      ['documents', 'default/text'],
      ['preview', 'default/text'],
      ['rewrite', 'default/text'],
    ]);
  });

  it('leaves the model to the provider when no model is set at all', async () => {
    const { deps, calls } = setup({ setup: { provider: 'openrouter' } });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    expect(await resolved.ai.ask('rewrite', MESSAGES)).toMatchObject({ ok: true, model: null });
    expect(calls[0].model).toBeUndefined();
  });

  it("does not send the saved provider's model ids to a key found for another provider", async () => {
    const { deps, createProvider, calls } = setup({
      keys: keysFor({ provider: 'anthropic', apiKey: TEST_KEY, source: 'env' }),
      models: { rewrite: 'openrouter/model' },
    });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    expect(createProvider).toHaveBeenCalledWith('anthropic', TEST_KEY);
    expect(resolved.ai.provider).toBe('anthropic');
    await resolved.ai.ask('rewrite', MESSAGES);
    expect(calls[0].model).toBeUndefined();
  });

  it('passes the abort signal and timeout to the provider', async () => {
    const { deps, calls } = setup();
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    const controller = new AbortController();
    await resolved.ai.ask('preview', MESSAGES, { signal: controller.signal, timeoutMs: 30_000, maxTokens: 500 });
    expect(calls[0].signal).toBe(controller.signal);
    expect(calls[0].timeoutMs).toBe(30_000);
    expect(calls[0].maxTokens).toBe(500);
  });

  it('makes no request once the signal is aborted', async () => {
    const { deps, calls } = setup();
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    const controller = new AbortController();
    controller.abort();
    await expect(resolved.ai.ask('preview', MESSAGES, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(calls).toHaveLength(0);
  });

  it('stops at the AI Request Budget and reports budget-spent', async () => {
    const { deps, calls } = setup({ budget: auditAiRequestBudget(2) });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    expect((await resolved.ai.ask('documents', MESSAGES)).ok).toBe(true);
    expect((await resolved.ai.ask('rewrite', MESSAGES)).ok).toBe(true);
    expect(await resolved.ai.ask('assessment', MESSAGES)).toEqual({ ok: false, reason: 'budget-spent' });
    expect(await resolved.ai.ask('preview', MESSAGES)).toEqual({ ok: false, reason: 'budget-spent' });
    expect(calls).toHaveLength(2);
  });

  it('a zero budget makes no request', async () => {
    const { deps, calls } = setup({ budget: auditAiRequestBudget(0) });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    expect(await resolved.ai.ask('rewrite', MESSAGES)).toEqual({ ok: false, reason: 'budget-spent' });
    expect(calls).toHaveLength(0);
  });

  it('flags claim words in an answer (ADR 0018)', async () => {
    const { deps } = setup({}, 'Your site is now fully accessible and secure.');
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    expect(await resolved.ai.ask('rewrite', MESSAGES)).toMatchObject({
      ok: true,
      claimWords: ['secure', 'fully accessible'],
    });
  });

  it('reports no claim words for a plain answer', async () => {
    const { deps } = setup();
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    expect(await resolved.ai.ask('rewrite', MESSAGES)).toMatchObject({ ok: true, claimWords: [] });
  });
});

/** Fakes per provider type, so a test can tell which provider answered. `failing` makes a type throw. */
function adcSetup(opts: { keyed?: AIProviderType | null; failing?: Partial<Record<AIProviderType, Error>> } = {}) {
  const fakes = new Map<AIProviderType, ReturnType<typeof fakeProvider>>();
  const createProvider = vi.fn((type: AIProviderType, _key: string) => {
    const fake = fakeProvider(type, `answer from ${type}`);
    const err = opts.failing?.[type];
    if (err) {
      fake.provider.generateText = async (_m, o) => {
        fake.calls.push(o ?? {});
        throw err;
      };
    }
    fakes.set(type, fake);
    return fake.provider;
  });
  const keyed = opts.keyed === undefined ? 'openrouter' : opts.keyed;
  const hasAdc = vi.fn(async () => true);
  const deps: ResolveAuditAiDeps = {
    setup: { provider: 'openrouter', text: 'default/text', vision: 'default/vision' },
    keys: keysFor(keyed ? { provider: keyed, apiKey: TEST_KEY, source: 'keychain' } : null),
    models: { rewrite: 'saved/rewrite' },
    createProvider,
    hasAdc,
  };
  return { deps, createProvider, hasAdc, fakes };
}

describe('isKeyRefused', () => {
  it('is true for 401, 402, 403 and key or credit messages', () => {
    for (const m of [
      'Request failed (401)',
      'Request failed (402)',
      'Request failed (403)',
      'API key expired. Please renew',
      'API key not valid',
      'Credits are depleted',
      'Insufficient credits',
      'insufficient quota',
      'Billing not enabled',
    ]) {
      expect(isKeyRefused(new Error(m)), m).toBe(true);
    }
  });

  it('is false for 429, 500, timeouts and bad answers', () => {
    for (const m of ['Request failed (429)', 'upstream 500', 'The AI did not answer in time.', 'not json']) {
      expect(isKeyRefused(new Error(m)), m).toBe(false);
    }
  });
});

describe('resolveAuditAi: Google sign-in (ADC) fallback', () => {
  it('no key and ADC available: Gemini through ADC', async () => {
    const { deps, createProvider, fakes } = adcSetup({ keyed: null });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledWith('gemini', 'adc');
    expect(resolved.ai.provider).toBe('gemini');
    expect(await resolved.ai.ask('rewrite', MESSAGES)).toMatchObject({
      ok: true,
      completion: { text: 'answer from gemini' },
      model: null,
    });
    expect(fakes.get('gemini')!.calls[0].model).toBeUndefined();
  });

  it('an empty key and ADC available: Gemini through ADC', async () => {
    const { deps, createProvider } = adcSetup();
    deps.keys = keysFor({ provider: 'openrouter', apiKey: '', source: 'env' });
    const resolved = await resolveAuditAi(deps);
    expect(resolved.ok).toBe(true);
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledWith('gemini', 'adc');
  });

  it('no key and no ADC: still no-ai-key', async () => {
    const { deps, createProvider, hasAdc } = adcSetup({ keyed: null });
    hasAdc.mockResolvedValue(false);
    expect(await resolveAuditAi(deps)).toEqual({ ok: false, reason: 'no-ai-key' });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('no key and hasAdc unset: still no-ai-key', async () => {
    const { deps, createProvider } = adcSetup({ keyed: null });
    delete deps.hasAdc;
    expect(await resolveAuditAi(deps)).toEqual({ ok: false, reason: 'no-ai-key' });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('a refused key (403) switches to Gemini ADC, retries once and stays there', async () => {
    const { deps, createProvider, fakes } = adcSetup({
      failing: { openrouter: new Error('OpenRouter request failed (403)') },
    });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    expect(resolved.ai.provider).toBe('openrouter');

    const first = await resolved.ai.ask('rewrite', MESSAGES);
    expect(first).toMatchObject({ ok: true, completion: { text: 'answer from gemini' }, model: null });
    expect(resolved.ai.provider).toBe('gemini');
    expect(createProvider).toHaveBeenCalledWith('gemini', 'adc');
    expect(fakes.get('openrouter')!.calls).toHaveLength(1);
    expect(fakes.get('gemini')!.calls).toHaveLength(1);
    // Saved models and defaults belong to the saved provider, not to ADC.
    expect(fakes.get('gemini')!.calls[0].model).toBeUndefined();

    await resolved.ai.ask('assessment', MESSAGES);
    expect(fakes.get('openrouter')!.calls).toHaveLength(1);
    expect(fakes.get('gemini')!.calls).toHaveLength(2);
    expect(fakes.get('gemini')!.calls[1].model).toBeUndefined();
    expect(createProvider.mock.calls.filter(([t]) => t === 'gemini')).toHaveLength(1);
  });

  it.each(['Request failed (401)', 'Request failed (402)', 'API key expired', 'Credits are depleted'])(
    'a key-refused error "%s" switches to Gemini ADC',
    async (message) => {
      const { deps } = adcSetup({ failing: { openrouter: new Error(message) } });
      const resolved = await resolveAuditAi(deps);
      if (!resolved.ok) throw new Error('expected AI');
      expect(await resolved.ai.ask('rewrite', MESSAGES)).toMatchObject({ completion: { text: 'answer from gemini' } });
    }
  );

  it('takes the budget once per ask, not again for the retry', async () => {
    const budget = auditAiRequestBudget(1);
    const { deps, fakes } = adcSetup({ failing: { openrouter: new Error('failed (401)') } });
    deps.budget = budget;
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    expect((await resolved.ai.ask('rewrite', MESSAGES)).ok).toBe(true);
    expect(fakes.get('gemini')!.calls).toHaveLength(1);
    expect(await resolved.ai.ask('rewrite', MESSAGES)).toEqual({ ok: false, reason: 'budget-spent' });
  });

  it('a Gemini provider is not switched: its error is thrown', async () => {
    const { deps, createProvider } = adcSetup({
      keyed: 'gemini',
      failing: { gemini: new Error('Gemini request failed (403)') },
    });
    deps.setup = { provider: 'gemini' };
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    await expect(resolved.ai.ask('rewrite', MESSAGES)).rejects.toThrow('(403)');
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledWith('gemini', TEST_KEY);
    expect(resolved.ai.provider).toBe('gemini');
  });

  it('a non-key error (500) is thrown and does not switch', async () => {
    const { deps, createProvider, hasAdc } = adcSetup({ failing: { openrouter: new Error('upstream 500') } });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    await expect(resolved.ai.ask('rewrite', MESSAGES)).rejects.toThrow('upstream 500');
    expect(resolved.ai.provider).toBe('openrouter');
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(hasAdc).not.toHaveBeenCalled();
  });

  it('a key-refused error with no ADC on this computer is thrown', async () => {
    const { deps, createProvider, hasAdc } = adcSetup({ failing: { openrouter: new Error('failed (401)') } });
    hasAdc.mockResolvedValue(false);
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    await expect(resolved.ai.ask('rewrite', MESSAGES)).rejects.toThrow('(401)');
    expect(resolved.ai.provider).toBe('openrouter');
    expect(createProvider).toHaveBeenCalledTimes(1);
  });

  it('a key-refused error with hasAdc unset is thrown as before', async () => {
    const { deps, createProvider } = adcSetup({ failing: { openrouter: new Error('failed (401)') } });
    delete deps.hasAdc;
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    await expect(resolved.ai.ask('rewrite', MESSAGES)).rejects.toThrow('(401)');
    expect(createProvider).toHaveBeenCalledTimes(1);
  });
});

describe('resolveAuditAi: parallel requests and the switch to Google sign-in (ADR 0043)', () => {
  it('requests already sent on a refused key all retry on Gemini, which is created once', async () => {
    const { deps, createProvider, fakes } = adcSetup({
      failing: { openrouter: new Error('API error (401): API key expired') },
    });
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    const answers = await Promise.all([1, 2, 3, 4].map(() => resolved.ai.ask('assessment', MESSAGES)));
    for (const a of answers) expect(a).toMatchObject({ ok: true, completion: { text: 'answer from gemini' } });
    expect(createProvider.mock.calls.filter(([type]) => type === 'gemini')).toHaveLength(1);
    expect(fakes.get('openrouter')!.calls).toHaveLength(4);
    expect(fakes.get('gemini')!.calls).toHaveLength(4);
    expect(resolved.ai.provider).toBe('gemini');
  });

  it('with no Google sign-in, every parallel request fails with its own error and nothing switches', async () => {
    const { deps, createProvider, hasAdc } = adcSetup({
      failing: { openrouter: new Error('API error (401): API key expired') },
    });
    hasAdc.mockResolvedValue(false);
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');
    const results = await Promise.allSettled([1, 2, 3].map(() => resolved.ai.ask('assessment', MESSAGES)));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(hasAdc).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledTimes(1);
  });
});

describe('classifyAiError and invalid key behavior (T-149)', () => {
  it('classifyAiError: 402 and depleted credits are quota', () => {
    expect(classifyAiError(new Error('Request failed (402): credits are depleted'))).toBe('quota');
    expect(classifyAiError({ status: 402, message: 'x' })).toBe('quota');
    expect(classifyAiError(new Error('Request failed (401)'))).toBe('key-expired');
    expect(classifyAiError(new Error('Request failed (500)'))).toBe('provider-error');
  });

  it('an invalid key is asked once: later requests fail without a provider call', async () => {
    const calls: any[] = [];
    const provider: AIProvider = {
      providerType: 'openrouter',
      async generateText(_m, o) {
        calls.push(o);
        throw new Error('Request failed (401): API key expired');
      },
    };
    const deps: ResolveAuditAiDeps = {
      setup: { provider: 'openrouter', text: 'default/text', vision: 'default/vision' },
      keys: keysFor({ provider: 'openrouter', apiKey: TEST_KEY, source: 'keychain' }),
      createProvider: () => provider,
    };
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');

    await expect(resolved.ai.ask('assessment', MESSAGES)).rejects.toThrow('API key expired');
    await expect(resolved.ai.ask('assessment', MESSAGES)).rejects.toThrow('API key expired');
    await expect(resolved.ai.ask('assessment', MESSAGES)).rejects.toThrow('API key expired');
    expect(calls).toHaveLength(1);
  });

  it('a 429 does not stop later requests', async () => {
    const calls: any[] = [];
    let count = 0;
    const provider: AIProvider = {
      providerType: 'openrouter',
      async generateText(_m, o) {
        calls.push(o);
        if (count++ === 0) throw new Error('Request failed (429)');
        return 'success';
      },
    };
    const deps: ResolveAuditAiDeps = {
      setup: { provider: 'openrouter', text: 'default/text', vision: 'default/vision' },
      keys: keysFor({ provider: 'openrouter', apiKey: TEST_KEY, source: 'keychain' }),
      createProvider: () => provider,
    };
    const resolved = await resolveAuditAi(deps);
    if (!resolved.ok) throw new Error('expected AI');

    await expect(resolved.ai.ask('assessment', MESSAGES)).rejects.toThrow('(429)');
    const second = await resolved.ai.ask('assessment', MESSAGES);
    expect(second.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});
