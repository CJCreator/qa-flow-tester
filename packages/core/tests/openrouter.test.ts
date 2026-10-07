import { describe, it, expect } from 'vitest';
import {
  OpenRouterClient,
  OpenRouterAuthError,
  keepOrPickModels,
  pickRecommendedModel,
  pickVisionModel,
  fallbackModels,
} from '../src/ai/openrouter.js';

const GOOD_KEY = 'sk-or-v1-good';

function fakeOpenRouter(models: unknown[], opts: { keyStatus?: number } = {}) {
  const calls: Array<{ url: string; auth?: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    calls.push({ url, auth });
    if (url.endsWith('/key')) {
      const status = auth === `Bearer ${GOOD_KEY}` ? (opts.keyStatus ?? 200) : 401;
      return new Response(JSON.stringify(status === 200 ? { data: {} } : { error: { message: 'User not found.' } }), {
        status,
      });
    }
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: models }));
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { client: new OpenRouterClient(fetchImpl), calls };
}

const model = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  context_length: 100000,
  pricing: { prompt: '0', completion: '0' },
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  supported_parameters: ['response_format'],
  ...extra,
});

describe('OpenRouterClient.validateKey', () => {
  it('accepts a key OpenRouter recognises', async () => {
    expect(await fakeOpenRouter([]).client.validateKey(GOOD_KEY)).toEqual({ valid: true });
  });

  it('rejects an unknown key with a readable reason instead of throwing', async () => {
    const result = await fakeOpenRouter([]).client.validateKey('sk-or-v1-revoked');
    expect(result.valid).toBe(false);
    expect(!result.valid && result.reason).toMatch(/doesn’t recognise/);
  });

  it('rejects malformed keys without calling OpenRouter', async () => {
    const { client, calls } = fakeOpenRouter([]);
    for (const key of ['', '   ', 'hello', undefined]) {
      const result = await client.validateKey(key);
      expect(result.valid).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it('reports an out-of-credit key', async () => {
    const result = await fakeOpenRouter([], { keyStatus: 402 }).client.validateKey(GOOD_KEY);
    expect(!result.valid && result.reason).toMatch(/out of credit/);
  });

  it('reports network failure as a reason, not an exception', async () => {
    const client = new OpenRouterClient((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    const result = await client.validateKey(GOOD_KEY);
    expect(!result.valid && result.reason).toMatch(/internet connection/);
  });
});

describe('OpenRouterClient.listFreeModels', () => {
  it('returns only free, chat-capable models, best first', async () => {
    const { client } = fakeOpenRouter([
      model('paid/model', { pricing: { prompt: '0.000001', completion: '0.000002' } }),
      model('vendor/no-json:free', { supported_parameters: [], context_length: 900000 }),
      model('vendor/big-json', { context_length: 500000 }),
      model('vendor/small-json', { context_length: 32000 }),
      model('google/lyria-3', { architecture: { input_modalities: ['text'], output_modalities: ['audio'] } }),
      model('nvidia/content-safety:free'),
      model('vendor/forced-reasoning', { reasoning: { mandatory: true }, context_length: 2000000 }),
    ]);
    const models = await client.listFreeModels(GOOD_KEY);
    expect(models.map((m) => m.id)).toEqual([
      'vendor/big-json',
      'vendor/small-json',
      'vendor/forced-reasoning',
      'vendor/no-json:free',
    ]);
    expect(pickRecommendedModel(models)).toBe('vendor/big-json');
  });

  it('never picks a router, whose model changes from call to call', async () => {
    const { client } = fakeOpenRouter([model('openrouter/free'), model('openrouter/auto'), model('vendor/big-json')]);
    const models = await client.listFreeModels(GOOD_KEY);
    expect(models.map((m) => m.id)).toEqual(['vendor/big-json']);
  });

  it('leaves out models that write anything but text, such as music', async () => {
    const { client } = fakeOpenRouter([
      model('google/lyria-3-pro-preview', {
        architecture: { input_modalities: ['text'], output_modalities: ['audio', 'text'] },
      }),
      model('vendor/text'),
    ]);
    expect((await client.listFreeModels(GOOD_KEY)).map((m) => m.id)).toEqual(['vendor/text']);
  });

  it('picks a separate model that can read screenshots for the visual review', async () => {
    const { client } = fakeOpenRouter([
      model('vendor/text-only', { context_length: 900000 }),
      model('vendor/vision', { architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }),
    ]);
    const models = await client.listFreeModels(GOOD_KEY);
    expect(pickRecommendedModel(models)).toBe('vendor/text-only');
    expect(pickVisionModel(models)).toBe('vendor/vision');
    expect(pickVisionModel(models.filter((m) => !m.supportsImages))).toBeNull();
  });

  it('keeps the chosen models while they stay free, and replaces only one that has gone', () => {
    const models = [
      { id: 'a', name: 'a', contextLength: 1, supportsJsonOutput: true, supportsImages: false },
      { id: 'b', name: 'b', contextLength: 1, supportsJsonOutput: true, supportsImages: true },
    ];
    expect(keepOrPickModels(models, { text: 'b', vision: 'b' })).toEqual({ text: 'b', vision: 'b' });
    expect(keepOrPickModels(models, { text: 'gone', vision: 'a' })).toEqual({ text: 'a', vision: 'b' });
    expect(keepOrPickModels([], { text: 'a' })).toEqual({ text: null, vision: null });
  });

  it('tries models that think before answering last: their thinking uses up the answer allowance', async () => {
    const { client } = fakeOpenRouter([
      model('vendor/thinker', { context_length: 900000, supported_parameters: ['response_format', 'reasoning'] }),
      model('vendor/plain', { context_length: 1000 }),
    ]);
    const models = await client.listFreeModels(GOOD_KEY);
    expect(models.map((m) => [m.id, !!m.thinks])).toEqual([
      ['vendor/plain', false],
      ['vendor/thinker', true],
    ]);
  });

  it('moves a model that keeps stopping before it answers to the end, unless the person chose it', () => {
    const models = [
      { id: 'a', name: 'a', contextLength: 1, supportsJsonOutput: true, supportsImages: false },
      { id: 'b', name: 'b', contextLength: 1, supportsJsonOutput: true, supportsImages: false },
      { id: 'c', name: 'c', contextLength: 1, supportsJsonOutput: true, supportsImages: false },
    ];
    const record = { a: { ok: 0, truncated: 3, failed: 0 } };
    expect(pickRecommendedModel(models, record)).toBe('b');
    expect(keepOrPickModels(models, { text: 'a' }, record).text).toBe('b');
    expect(keepOrPickModels(models, { text: 'a', chosenBy: 'person' }, record).text).toBe('a');
    expect(fallbackModels(models, 'b', record)).toEqual(['c']);
    // One bad answer among many good ones doesn't count against a model.
    expect(pickRecommendedModel(models, { a: { ok: 5, truncated: 1, failed: 0 } })).toBe('a');
  });

  it('returns an empty list, and no recommendation, when nothing is free', async () => {
    const { client } = fakeOpenRouter([model('paid/model', { pricing: { prompt: '1', completion: '1' } })]);
    const models = await client.listFreeModels(GOOD_KEY);
    expect(models).toEqual([]);
    expect(pickRecommendedModel(models)).toBeNull();
  });

  it('refuses to list models for a bad key, even though the list itself is public', async () => {
    await expect(fakeOpenRouter([model('a')]).client.listFreeModels('sk-or-v1-bad')).rejects.toBeInstanceOf(
      OpenRouterAuthError
    );
  });
});
