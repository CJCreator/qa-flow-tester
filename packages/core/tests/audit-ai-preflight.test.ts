import { describe, it, expect, vi } from 'vitest';
import type { AIMessage, AIProviderType } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { AITimeoutError } from '../src/ai/timeout.js';
import { preflightAuditAi } from '../src/audit/ai/preflight.js';
import type { AuditAiResolution } from '../src/audit/ai/stage-ai.js';

const TEST_KEY = 'test-key-preflight';

function scriptedProvider(outcome: string | Error) {
  const requests: AIMessage[][] = [];
  const provider: AIProvider = {
    providerType: 'mock',
    async generateText(messages) {
      requests.push(messages);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return { provider, requests };
}

describe('preflightAuditAi (ADR 0042, T-81)', () => {
  it('no key configured: returns no-key without sending an AI request', async () => {
    const resolveKey = vi.fn(async () => null);
    const createProvider = vi.fn();

    const status = await preflightAuditAi(resolveKey, { createProvider });

    expect(status).toBe('no-key');
    expect(resolveKey).toHaveBeenCalledTimes(1);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('no key in resolveAi resolution: returns no-key without sending a request', async () => {
    const resolveAi = vi.fn(async (): Promise<AuditAiResolution> => ({ ok: false, reason: 'no-ai-key' }));

    const status = await preflightAuditAi(resolveAi);

    expect(status).toBe('no-key');
    expect(resolveAi).toHaveBeenCalledTimes(1);
  });

  it('key present and ping succeeds: returns ready', async () => {
    const { provider, requests } = scriptedProvider('Hello there');
    const resolveKey = vi.fn(async () => ({ provider: 'mock' as AIProviderType, apiKey: TEST_KEY }));
    const createProvider = vi.fn(() => provider);

    const status = await preflightAuditAi(resolveKey, { createProvider });

    expect(status).toBe('ready');
    expect(resolveKey).toHaveBeenCalledTimes(1);
    expect(createProvider).toHaveBeenCalledWith('mock', TEST_KEY);
    expect(requests).toHaveLength(1);
  });

  it('key present and provider returns 401/403: returns key-expired', async () => {
    const { provider, requests } = scriptedProvider(new Error('API key expired (401)'));
    const resolveKey = vi.fn(async () => ({ provider: 'openrouter' as AIProviderType, apiKey: 'expired-key' }));
    const createProvider = vi.fn(() => provider);

    const status = await preflightAuditAi(resolveKey, { createProvider });

    expect(status).toBe('key-expired');
    expect(requests).toHaveLength(1);
  });

  it('key present and provider returns 429: returns quota', async () => {
    const { provider, requests } = scriptedProvider(new Error('Rate limit exceeded 429: quota exhausted'));
    const resolveKey = vi.fn(async () => ({ provider: 'gemini' as AIProviderType, apiKey: TEST_KEY }));
    const createProvider = vi.fn(() => provider);

    const status = await preflightAuditAi(resolveKey, { createProvider });

    expect(status).toBe('quota');
    expect(requests).toHaveLength(1);
  });

  it('key present and request times out: returns timeout', async () => {
    const { provider, requests } = scriptedProvider(new AITimeoutError('AI service timeout', 5000));
    const resolveKey = vi.fn(async () => ({ provider: 'mock' as AIProviderType, apiKey: TEST_KEY }));
    const createProvider = vi.fn(() => provider);

    const status = await preflightAuditAi(resolveKey, { createProvider });

    expect(status).toBe('timeout');
    expect(requests).toHaveLength(1);
  });

  it('key present and provider returns 500: returns provider-error', async () => {
    const { provider, requests } = scriptedProvider(new Error('500 Internal Server Error'));
    const resolveKey = vi.fn(async () => ({ provider: 'mock' as AIProviderType, apiKey: TEST_KEY }));
    const createProvider = vi.fn(() => provider);

    const status = await preflightAuditAi(resolveKey, { createProvider });

    expect(status).toBe('provider-error');
    expect(requests).toHaveLength(1);
  });

  it('works with ResolveAuditAiDeps object target', async () => {
    const { provider, requests } = scriptedProvider('pong');
    const createProvider = vi.fn(() => provider);

    const status = await preflightAuditAi({
      setup: { provider: 'mock' },
      keys: {
        resolveKey: async () => ({ provider: 'mock' as AIProviderType, apiKey: TEST_KEY, source: 'cli' as const }),
      },
      createProvider,
    });

    expect(status).toBe('ready');
    expect(requests).toHaveLength(1);
  });
});
