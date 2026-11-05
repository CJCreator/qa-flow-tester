/**
 * LAT-8: the OpenRouter model list is reused for MODEL_LIST_TTL_MS; key validation is not cached.
 * Unit tier: fake fetch; no network.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenRouterClient, MODEL_LIST_TTL_MS } from '../src/ai/openrouter.js';

const MODEL = {
  id: 'vendor/text:free',
  name: 'Text',
  context_length: 8000,
  pricing: { prompt: '0', completion: '0' },
  architecture: { input_modalities: ['text'] },
};

function fakeFetch() {
  const modelCalls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/models')) {
      modelCalls.push(url);
      return new Response(JSON.stringify({ data: [MODEL] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { label: 'k' } }), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, modelCalls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OpenRouterClient model list cache (LAT-8)', () => {
  it('fetches the list once within the TTL', async () => {
    const f = fakeFetch();
    const client = new OpenRouterClient(f.impl);
    await client.listFreeModels('sk-or-test');
    await client.listFreeModels('sk-or-test');
    await client.modelPrice('vendor/text:free');
    expect(f.modelCalls).toHaveLength(1);
  });

  it('fetches again after the TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const f = fakeFetch();
    const client = new OpenRouterClient(f.impl);
    await client.listFreeModels('sk-or-test');
    vi.setSystemTime(new Date(Date.now() + MODEL_LIST_TTL_MS + 1));
    await client.listFreeModels('sk-or-test');
    expect(f.modelCalls).toHaveLength(2);
  });
});
