import { describe, it, expect, vi } from 'vitest';
import type { AICompletionOptions, AIMessage, AIProviderType } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import type { ResolvedKeyInfo } from '../src/ai/key-resolver.js';
import { auditAiRequestBudget, resolveAuditAi, type ResolveAuditAiDeps } from '../src/audit/ai/stage-ai.js';

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
