import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { AIMessage, AICompletionOptions } from '@qa/types';
import { AnthropicProvider } from '../src/ai/providers/anthropic.js';
import { OpenAIProvider } from '../src/ai/providers/openai.js';
import { GeminiProvider } from '../src/ai/providers/gemini.js';
import { AI_REQUEST_TIMEOUT_MS, AITimeoutError, requestSignal } from '../src/ai/timeout.js';
import type { AIProvider } from '../src/ai/ai-provider.js';

// RISK-005: a hung AI Provider must not hold the single run slot. No real network: fetch is stubbed.

const KEY = 'sk-test-SECRET-KEY-0123456789';
const MESSAGES: AIMessage[] = [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: 'Hello' },
];

interface FetchCall {
  url: string;
  init: RequestInit;
}

/** A fetch that never answers; like the real one, it rejects with the signal's reason when aborted. */
function hangingFetch(calls: FetchCall[]) {
  return vi.fn((url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (!signal) return;
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const providers: Array<{ name: string; make: () => AIProvider }> = [
  { name: 'Anthropic', make: () => new AnthropicProvider(KEY) },
  { name: 'OpenAI', make: () => new OpenAIProvider(KEY) },
  { name: 'OpenRouter', make: () => new OpenAIProvider(KEY, 'https://openrouter.ai/api/v1') },
  { name: 'Gemini', make: () => new GeminiProvider(KEY) },
];

/** `complete` is optional on AIProvider; every provider under test has it. Narrows the type. */
function withComplete(provider: AIProvider): AIProvider & Required<Pick<AIProvider, 'complete'>> {
  expect(provider.complete).toBeDefined();
  if (!provider.complete) throw new Error('provider has no complete()');
  return provider as AIProvider & Required<Pick<AIProvider, 'complete'>>;
}

function assertNoKey(err: unknown) {
  const e = err as Error;
  expect(String(e.message)).not.toContain(KEY);
  expect(String(e)).not.toContain(KEY);
  expect(String(e.stack ?? '')).not.toContain(KEY);
}

describe('requestSignal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('aborts with AITimeoutError after the default deadline', async () => {
    const { signal } = requestSignal({});
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBeInstanceOf(AITimeoutError);
    expect((signal.reason as AITimeoutError).name).toBe('AITimeoutError');
    expect((signal.reason as AITimeoutError).timeoutMs).toBe(AI_REQUEST_TIMEOUT_MS);
  });

  it('falls back to the default for a non-positive or non-finite timeoutMs', async () => {
    for (const timeoutMs of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { signal } = requestSignal({ timeoutMs });
      await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS - 1);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(signal.aborted).toBe(true);
    }
  });

  it('follows the caller signal', () => {
    const caller = new AbortController();
    const { signal } = requestSignal({ signal: caller.signal, timeoutMs: 1000 });
    expect(signal.aborted).toBe(false);
    caller.abort();
    expect(signal.aborted).toBe(true);
    expect(signal.reason).not.toBeInstanceOf(AITimeoutError);
  });

  it('release clears the deadline timer and removes its listener from the caller signal', async () => {
    const caller = new AbortController();
    const added = vi.spyOn(caller.signal, 'addEventListener');
    const removed = vi.spyOn(caller.signal, 'removeEventListener');
    const { signal, release } = requestSignal({ signal: caller.signal, timeoutMs: 1000 });
    const ours = added.mock.calls.find((c) => c[0] === 'abort');
    expect(ours).toBeDefined();
    expect(vi.getTimerCount()).toBe(1);
    release();
    expect(removed).toHaveBeenCalledWith('abort', ours?.[1]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(signal.aborted).toBe(false);
  });

  it('release without a caller signal clears the deadline timer', () => {
    const { release } = requestSignal({ timeoutMs: 1000 });
    expect(vi.getTimerCount()).toBe(1);
    release();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe.each(providers)('$name provider timeout and abort', ({ make }) => {
  let realFetch: typeof fetch;
  let calls: FetchCall[];

  beforeEach(() => {
    vi.useFakeTimers();
    realFetch = globalThis.fetch;
    calls = [];
    globalThis.fetch = hangingFetch(calls) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it('rejects with AITimeoutError after timeoutMs when the AI service never answers', async () => {
    const provider = withComplete(make());
    const pending = provider.complete(MESSAGES, { timeoutMs: 5000 });
    const outcome = pending.then(
      () => null,
      (e: unknown) => e
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await outcome;
    expect(err).toBeInstanceOf(AITimeoutError);
    expect((err as Error).name).toBe('AITimeoutError');
    expect((err as AITimeoutError).timeoutMs).toBe(5000);
    expect(calls[0].init.signal?.aborted).toBe(true);
    assertNoKey(err);
  });

  it('generateText also times out', async () => {
    const provider = make();
    const outcome = provider.generateText(MESSAGES, { timeoutMs: 250 }).then(
      () => null,
      (e: unknown) => e
    );
    await vi.advanceTimersByTimeAsync(250);
    const err = await outcome;
    expect(err).toBeInstanceOf(AITimeoutError);
    assertNoKey(err);
  });

  it('applies AI_REQUEST_TIMEOUT_MS when no timeoutMs is given', async () => {
    const provider = withComplete(make());
    const outcome = provider.complete(MESSAGES).then(
      () => null,
      (e: unknown) => e
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    const signal = calls[0].init.signal!;
    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS - 1);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    const err = await outcome;
    expect(err).toBeInstanceOf(AITimeoutError);
    expect((err as AITimeoutError).timeoutMs).toBe(AI_REQUEST_TIMEOUT_MS);
  });

  it('rejects promptly with an AbortError when the caller aborts mid-request', async () => {
    const provider = withComplete(make());
    const caller = new AbortController();
    const outcome = provider.complete(MESSAGES, { signal: caller.signal, timeoutMs: 60_000 }).then(
      () => null,
      (e: unknown) => e
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(1);
    caller.abort();
    const err = await outcome;
    expect((err as Error).name).toBe('AbortError');
    expect(err).not.toBeInstanceOf(AITimeoutError);
    expect(calls[0].init.signal?.aborted).toBe(true);
    assertNoKey(err);
  });

  it('rejects with an AbortError when the caller signal is already aborted', async () => {
    const provider = withComplete(make());
    const caller = new AbortController();
    caller.abort();
    const err = await provider.complete(MESSAGES, { signal: caller.signal }).then(
      () => null,
      (e: unknown) => e
    );
    expect((err as Error).name).toBe('AbortError');
    expect(calls.every((c) => c.init.signal?.aborted)).toBe(true);
    assertNoKey(err);
  });
});

describe('answered calls keep their behaviour', () => {
  let realFetch: typeof fetch;
  let calls: FetchCall[];
  let reply: () => Response;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    calls = [];
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return reply();
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it.each(providers)('$name: a successful call removes its listener from the caller signal', async ({ make }) => {
    reply = () =>
      jsonResponse({
        content: [{ type: 'text', text: 'hi' }],
        choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
        candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      });
    const provider = withComplete(make());
    const caller = new AbortController();
    const added = vi.spyOn(caller.signal, 'addEventListener');
    const removed = vi.spyOn(caller.signal, 'removeEventListener');
    await provider.complete(MESSAGES, { signal: caller.signal });
    const ours = added.mock.calls.filter((c) => c[0] === 'abort');
    expect(ours.length).toBeGreaterThan(0);
    for (const [, handler] of ours) expect(removed).toHaveBeenCalledWith('abort', handler);
  });

  it('Anthropic: same request body, headers, finishReason and usage', async () => {
    reply = () =>
      jsonResponse({
        content: [{ type: 'text', text: 'hi' }],
        stop_reason: 'max_tokens',
        model: 'claude-x',
        usage: { input_tokens: 3, output_tokens: 4 },
      });
    const out = await new AnthropicProvider(KEY, 'https://api.anthropic.com/v1', 'claude-x').complete(MESSAGES, {
      maxTokens: 100,
    });
    expect(out).toEqual({
      text: 'hi',
      finishReason: 'length',
      model: 'claude-x',
      usage: { promptTokens: 3, completionTokens: 4 },
    });
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'claude-x',
      max_tokens: 100,
      temperature: 0.2,
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'Be brief.',
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('OpenRouter: same request body, headers, finishReason and usage', async () => {
    reply = () =>
      jsonResponse({
        model: 'or-model',
        choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 6, completion_tokens_details: { reasoning_tokens: 2 } },
      });
    const out = await new OpenAIProvider(KEY, 'https://openrouter.ai/api/v1', 'or-model').complete(MESSAGES, {
      responseFormat: 'json',
    });
    expect(out).toEqual({
      text: '{"a":1}',
      finishReason: 'stop',
      model: 'or-model',
      usage: { promptTokens: 5, completionTokens: 6, reasoningTokens: 2 },
    });
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].init.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'or-model',
      temperature: 0.2,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hello' },
      ],
      response_format: { type: 'json_object' },
      reasoning: { enabled: false },
    });
  });

  it('OpenAI: a network failure keeps its message and is not reported as a timeout', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    const err = await new OpenAIProvider(KEY).complete(MESSAGES).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).not.toBeInstanceOf(AITimeoutError);
    expect((err as Error).message).toBe('Couldn’t reach the AI service: ECONNREFUSED');
  });

  it('Gemini: same request body, headers, finishReason and usage', async () => {
    reply = () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 8, thoughtsTokenCount: 1 },
      });
    const out = await new GeminiProvider(KEY, 'gem-x').complete(MESSAGES, { temperature: 0.5 });
    expect(out).toEqual({
      text: 'ok',
      finishReason: 'length',
      model: 'gem-x',
      usage: { promptTokens: 7, completionTokens: 9, reasoningTokens: 1 },
    });
    expect(calls[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/gem-x:generateContent`);
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json', 'x-goog-api-key': KEY });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      contents: [
        { role: 'user', parts: [{ text: 'Be brief.' }] },
        { role: 'user', parts: [{ text: 'Hello' }] },
      ],
      generationConfig: { temperature: 0.5, maxOutputTokens: 4096 },
    });
  });

  it('Gemini: an HTTP error keeps its message', async () => {
    reply = () => new Response('bad request', { status: 400 });
    const err = await new GeminiProvider(KEY).complete(MESSAGES).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).not.toBeInstanceOf(AITimeoutError);
    expect((err as Error).message).toBe('Gemini API error (400): bad request');
  });
});

// Order matters: the ADC token is cached in the module once a token request succeeds.
describe('Gemini ADC token and fallback requests', () => {
  let realFetch: typeof fetch;
  let tmpDir: string;
  let savedCreds: string | undefined;
  const options: AICompletionOptions = { timeoutMs: 50 };

  beforeEach(async () => {
    realFetch = globalThis.fetch;
    savedCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-ai-timeout-'));
    const credPath = path.join(tmpDir, 'adc.json');
    await fs.writeFile(
      credPath,
      JSON.stringify({
        client_id: 'test-client',
        client_secret: 'test-client-secret',
        refresh_token: 'test-refresh',
        quota_project_id: 'test-project',
      })
    );
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    if (savedCreds === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    else process.env.GOOGLE_APPLICATION_CREDENTIALS = savedCreds;
    vi.useRealTimers();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('times out a hung ADC token request instead of reporting missing credentials', async () => {
    const calls: FetchCall[] = [];
    globalThis.fetch = hangingFetch(calls) as unknown as typeof fetch;
    // Real timers here: the credentials file is read with real I/O before the token fetch starts.
    const err = await new GeminiProvider('adc').complete(MESSAGES, options).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(AITimeoutError);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0].init.signal?.aborted).toBe(true);
    assertNoKey(err);
  });

  it('times out the Vertex fallback request after a 403 on the key endpoint', async () => {
    const calls: FetchCall[] = [];
    const hang = hangingFetch(calls);
    globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.includes('generativelanguage')) {
        calls.push({ url: u, init });
        return new Response('quota', { status: 403 });
      }
      if (u.includes('oauth2')) {
        calls.push({ url: u, init });
        return jsonResponse({ access_token: 'ya29.test-token', expires_in: 3600 });
      }
      return hang(u, init);
    }) as unknown as typeof fetch;
    const err = await new GeminiProvider(KEY, 'gem-x').complete(MESSAGES, options).then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(AITimeoutError);
    assertNoKey(err);
    expect(calls.map((c) => c.url.split('?')[0])).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/models/gem-x:generateContent',
      'https://oauth2.googleapis.com/token',
      'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gem-x:generateContent',
    ]);
    expect(calls.every((c) => c.init.signal === calls[0].init.signal)).toBe(true);
    expect(calls[2].init.signal?.aborted).toBe(true);
  });
});
