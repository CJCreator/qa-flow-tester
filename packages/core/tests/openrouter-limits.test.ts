import { describe, expect, it } from 'vitest';
import { OpenRouterClient } from '../src/ai/openrouter.js';

function client(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { c: new OpenRouterClient(fetchImpl), calls };
}

describe('OpenRouterClient.keyLimits', () => {
  it('reads what the service reports', async () => {
    const { c } = client({
      data: {
        free_model_daily_requests: { used: 10, limit: 50, remaining: 40 },
        limit_remaining: 4.5,
        rate_limit: { requests: 20, interval: '10s' },
      },
    });
    expect(await c.keyLimits('sk-or-test')).toEqual({
      remainingRequests: 40,
      limitRequests: 50,
      creditRemainingUsd: 4.5,
      requestsPerInterval: 20,
      intervalMs: 10000,
    });
  });

  it('leaves out fields the service does not report', async () => {
    const { c } = client({ data: { label: 'x' } });
    expect(await c.keyLimits('sk-or-test')).toEqual({});
  });

  it('ignores a rate limit it cannot understand', async () => {
    const { c } = client({ data: { rate_limit: { requests: 20, interval: 'often' } } });
    expect(await c.keyLimits('sk-or-test')).toEqual({});
  });

  it('returns null on a non-200, a missing key, a bad body or a network error', async () => {
    expect(await client({}, 401).c.keyLimits('sk-or-test')).toBeNull();
    expect(await client({ data: {} }).c.keyLimits('  ')).toBeNull();
    expect(await client(null).c.keyLimits('sk-or-test')).toBeNull();
    const boom = new OpenRouterClient((async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch);
    expect(await boom.keyLimits('sk-or-test')).toBeNull();
  });

  it('freeRequestsToday still works as before', async () => {
    const { c } = client({ data: { free_model_daily_requests: { used: 3, limit: 50, remaining: 47 } } });
    expect(await c.freeRequestsToday('sk-or-test')).toEqual({ used: 3, limit: 50, remaining: 47 });
  });
});

describe('OpenRouterClient.modelPrice', () => {
  const models = {
    data: [
      { id: 'vendor/paid', pricing: { prompt: '0.000001', completion: '0.000003' } },
      { id: 'vendor/free:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'vendor/odd', pricing: { prompt: 'x', completion: '1' } },
    ],
  };

  it('gives price per million tokens, 0 for free models', async () => {
    const { c } = client(models);
    expect(await c.modelPrice('vendor/paid')).toEqual({ prompt: 1, completion: 3 });
    expect(await c.modelPrice('vendor/free:free')).toEqual({ prompt: 0, completion: 0 });
  });

  it('null for unknown model, unreadable price, or failure', async () => {
    expect(await client(models).c.modelPrice('nope')).toBeNull();
    expect(await client(models).c.modelPrice('vendor/odd')).toBeNull();
    expect(await client(models, 500).c.modelPrice('vendor/paid')).toBeNull();
  });
});
