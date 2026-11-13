import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { AIProviderType } from '@qa/types';
import { createAIProvider } from '../src/ai/ai-provider.js';
import { GeminiProvider } from '../src/ai/providers/gemini.js';
import { AnthropicProvider } from '../src/ai/providers/anthropic.js';
import { OpenAIProvider } from '../src/ai/providers/openai.js';

interface Call {
  url: string;
  headers: Record<string, string>;
}

const MESSAGES = [{ role: 'user' as const, content: 'hi' }];

/** A fetch that records every call and answers with the given status and body. */
function recordingFetch(calls: Call[], status: number, body: string) {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  });
}

const LONG_JSON = (message: string) => JSON.stringify({ error: { type: 'x', message } });

describe('AI provider guards', () => {
  const realFetch = globalThis.fetch;
  let calls: Call[];
  let tmpDir: string;
  let adcPath: string;

  beforeEach(async () => {
    calls = [];
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-guards-'));
    adcPath = path.join(tmpDir, 'application_default_credentials.json');
    await fs.writeFile(
      adcPath,
      JSON.stringify({
        type: 'authorized_user',
        client_id: 'fake-client',
        client_secret: 'fake-secret',
        refresh_token: 'fake-refresh',
        quota_project_id: 'fake-project',
      })
    );
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', adcPath);
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('createAIProvider', () => {
    it('refuses unknown provider names instead of returning the test AI', () => {
      expect(() => createAIProvider('Mock' as AIProviderType, 'k')).toThrow(/Unknown AI provider/);
      expect(() => createAIProvider('nope' as AIProviderType, 'k')).toThrow(/Unknown AI provider/);
    });

    it('still returns the test AI for the exact name mock', () => {
      expect(createAIProvider('mock', 'none').providerType).toBe('mock');
    });
  });

  describe('Google sign-in (ADC) on a shared copy', () => {
    it('refuses adc as the key before reading the credentials file or calling Google', async () => {
      globalThis.fetch = recordingFetch(calls, 200, '{}') as unknown as typeof fetch;
      await expect(new GeminiProvider('adc').complete(MESSAGES)).rejects.toThrow(/your own computer/);
      expect(calls).toHaveLength(0);
    });

    it('never falls back to the credentials file when AI Studio refuses the key', async () => {
      globalThis.fetch = recordingFetch(
        calls,
        402,
        LONG_JSON('prepayment credits are depleted')
      ) as unknown as typeof fetch;
      await expect(new GeminiProvider('studio-key').complete(MESSAGES)).rejects.toThrow(/Gemini API error \(402\)/);
      const urls = calls.map((c) => c.url);
      expect(urls.some((u) => u.startsWith('https://oauth2.googleapis.com/'))).toBe(false);
      expect(urls.some((u) => u.startsWith('https://aiplatform.googleapis.com/'))).toBe(false);
    });

    it('refuses a model name that could change the request URL, before any call', async () => {
      globalThis.fetch = recordingFetch(calls, 200, '{}') as unknown as typeof fetch;
      await expect(new GeminiProvider('studio-key', '../../v1/projects/x').complete(MESSAGES)).rejects.toThrow(
        /model name is not valid/
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe('provider error text is trimmed', () => {
    const KEY = 'test-key-123';
    const body = LONG_JSON(`${'lorem ipsum '.repeat(400)} ${KEY} end`);

    it('Anthropic: short message with the status, no key, no raw JSON', async () => {
      globalThis.fetch = recordingFetch(calls, 400, body) as unknown as typeof fetch;
      const err = await new AnthropicProvider(KEY).complete(MESSAGES).then(
        () => null,
        (e: unknown) => e as Error
      );
      expect(err?.message.length).toBeLessThanOrEqual(340);
      expect(err?.message).toContain('(400)');
      expect(err?.message).not.toContain(KEY);
    });

    it('OpenAI: short message with the status, no key', async () => {
      globalThis.fetch = recordingFetch(calls, 400, body) as unknown as typeof fetch;
      const err = await new OpenAIProvider(KEY).complete(MESSAGES).then(
        () => null,
        (e: unknown) => e as Error
      );
      expect(err?.message.length).toBeLessThanOrEqual(340);
      expect(err?.message).toContain('(400)');
      expect(err?.message).not.toContain(KEY);
    });

    it('Gemini: short message with the status, no key', async () => {
      globalThis.fetch = recordingFetch(calls, 400, body) as unknown as typeof fetch;
      const err = await new GeminiProvider(KEY, 'gemini-2.5-flash').complete(MESSAGES).then(
        () => null,
        (e: unknown) => e as Error
      );
      expect(err?.message.length).toBeLessThanOrEqual(340);
      expect(err?.message).toContain('(400)');
      expect(err?.message).not.toContain(KEY);
    });

    it('OpenRouter 429 keeps the upstream rate-limit wording the budget switch reads', async () => {
      const raw = JSON.stringify({
        error: {
          message: 'Provider returned error',
          code: 429,
          metadata: { raw: 'vendor/m:free is temporarily rate-limited upstream. Please retry shortly' },
        },
      });
      globalThis.fetch = recordingFetch(calls, 429, raw) as unknown as typeof fetch;
      const err = await new OpenAIProvider('test-key', 'https://openrouter.ai/api/v1').complete(MESSAGES).then(
        () => null,
        (e: unknown) => e as Error
      );
      expect(err?.message).toMatch(/temporarily rate.?limited/);
      expect(err?.message).toMatch(/\(429\)/);
    });
  });
});
