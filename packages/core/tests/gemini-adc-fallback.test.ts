import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_MODELS } from '../src/ai/default-models.js';

type GeminiModule = typeof import('../src/ai/providers/gemini.js');

const DEFAULT = DEFAULT_MODELS.gemini;
const OK_BODY = (text: string) =>
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

interface Call {
  url: string;
  headers: Record<string, string>;
}

describe('Gemini AI Studio key to Vertex AI (Google sign-in) fallback', () => {
  const realFetch = globalThis.fetch;
  let tmpDir: string;
  let adcPath: string;
  let calls: Call[];
  let studio: { status: number; body: string };
  let vertex: Record<string, { status: number; body: string }>;
  let mod: GeminiModule;

  const vertexCalls = () => calls.filter((c) => c.url.startsWith('https://aiplatform.googleapis.com/'));
  const studioCalls = () => calls.filter((c) => c.url.startsWith('https://generativelanguage.googleapis.com/'));

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-adc-test-'));
    adcPath = path.join(tmpDir, 'adc.json');
    await fs.writeFile(
      adcPath,
      JSON.stringify({
        type: 'authorized_user',
        client_id: 'fake-client-id',
        client_secret: 'fake-client-secret',
        refresh_token: 'fake-refresh-token',
        quota_project_id: 'test-project',
      })
    );
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', adcPath);
    calls = [];
    studio = { status: 402, body: 'prepayment credits are depleted' };
    vertex = {};
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }), { status: 200 });
      }
      if (u.startsWith('https://generativelanguage.googleapis.com/')) {
        return new Response(studio.body, { status: studio.status });
      }
      if (u.startsWith('https://aiplatform.googleapis.com/')) {
        const model = /models\/([^:]+):generateContent/.exec(u)![1];
        const r = vertex[model] ?? { status: 200, body: OK_BODY(`vertex:${model}`) };
        return new Response(r.body, { status: r.status });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    // The ADC token is cached at module level; a fresh module per test keeps tests independent.
    vi.resetModules();
    mod = await import('../src/ai/providers/gemini.js');
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  const ask = (model?: string, key = 'studio-key') =>
    new mod.GeminiProvider(key, model).complete([{ role: 'user', content: 'hi' }]);

  describe('helpers', () => {
    it('vertexModelFor maps -latest aliases to the default model and leaves others alone', () => {
      expect(mod.vertexModelFor('gemini-flash-latest')).toBe(DEFAULT);
      expect(mod.vertexModelFor('gemini-pro-latest')).toBe(DEFAULT);
      expect(mod.vertexModelFor('Gemini-Flash-LATEST')).toBe(DEFAULT);
      expect(mod.vertexModelFor('gemini-9-custom')).toBe('gemini-9-custom');
      expect(mod.vertexModelFor(DEFAULT)).toBe(DEFAULT);
      expect(mod.vertexModelFor('latest-model-x')).toBe('latest-model-x');
    });

    it('aiStudioKeyUnusable flags unusable-key answers only', () => {
      for (const s of [401, 402, 403, 429]) expect(mod.aiStudioKeyUnusable(s, 'whatever')).toBe(true);
      expect(mod.aiStudioKeyUnusable(400, '{"error":{"status":"API_KEY_INVALID"}}')).toBe(true);
      expect(mod.aiStudioKeyUnusable(400, 'API key not valid. Please pass a valid API key.')).toBe(true);
      expect(mod.aiStudioKeyUnusable(400, 'API key expired. Please renew the API key.')).toBe(true);
      expect(mod.aiStudioKeyUnusable(400, 'Bad request: contents is empty')).toBe(false);
      expect(mod.aiStudioKeyUnusable(500, 'internal')).toBe(false);
      expect(mod.aiStudioKeyUnusable(500, 'API_KEY_INVALID')).toBe(false);
      expect(mod.aiStudioKeyUnusable(404, 'not found')).toBe(false);
    });
  });

  it('falls back to Vertex on AI Studio 402 and swaps the alias for the default model', async () => {
    const completion = await ask('gemini-flash-latest');
    expect(studioCalls()).toHaveLength(1);
    expect(studioCalls()[0].url).toContain('gemini-flash-latest:generateContent');
    expect(studioCalls()[0].url).not.toContain('key=');
    expect(studioCalls()[0].headers['x-goog-api-key']).toBe('studio-key');
    const v = vertexCalls();
    expect(v).toHaveLength(1);
    expect(v[0].url).toBe(
      `https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/${DEFAULT}:generateContent`
    );
    expect(v[0].headers.Authorization).toBe('Bearer fake-token');
    expect(v[0].headers['X-Goog-User-Project']).toBe('test-project');
    expect(completion.text).toBe(`vertex:${DEFAULT}`);
    expect(completion.model).toBe(DEFAULT);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'quota exhausted'],
    [
      400,
      '{"error":{"message":"API key not valid","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}',
    ],
  ])('also falls back to Vertex on AI Studio %i', async (status, body) => {
    studio = { status, body };
    const completion = await ask('gemini-flash-latest');
    expect(vertexCalls()).toHaveLength(1);
    expect(completion.text).toBe(`vertex:${DEFAULT}`);
  });

  it('does not use Vertex for an AI Studio 500 and throws the 500', async () => {
    studio = { status: 500, body: 'internal error' };
    await expect(ask('gemini-flash-latest')).rejects.toThrow(/Gemini API error \(500\): internal error/);
    expect(vertexCalls()).toHaveLength(0);
    expect(calls.some((c) => c.url.includes('oauth2.googleapis.com'))).toBe(false);
  });

  it('does not use Vertex for a plain 400', async () => {
    studio = { status: 400, body: 'contents is empty' };
    await expect(ask()).rejects.toThrow(/Gemini API error \(400\)/);
    expect(vertexCalls()).toHaveLength(0);
  });

  it('retries once with the default model when Vertex answers 404 for a custom model', async () => {
    vertex['gemini-9-custom'] = { status: 404, body: 'model not found' };
    const completion = await ask('gemini-9-custom');
    const v = vertexCalls();
    expect(v).toHaveLength(2);
    expect(v[0].url).toContain('/models/gemini-9-custom:generateContent');
    expect(v[1].url).toContain(`/models/${DEFAULT}:generateContent`);
    expect(completion.text).toBe(`vertex:${DEFAULT}`);
    expect(completion.model).toBe(DEFAULT);
  });

  it('keeps a custom model that Vertex accepts', async () => {
    const completion = await ask('gemini-9-custom');
    expect(vertexCalls()).toHaveLength(1);
    expect(completion.model).toBe('gemini-9-custom');
  });

  it('names both answers when Vertex fails too', async () => {
    studio = { status: 429, body: 'quota gone' };
    vertex[DEFAULT] = { status: 403, body: 'vertex denied' };
    const err = await ask('gemini-flash-latest').catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain('Gemini API error (429): quota gone');
    expect(msg).toContain('Vertex AI with Google sign-in (403): vertex denied');
  });

  it('throws the original AI Studio error when there is no ADC file', async () => {
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', path.join(tmpDir, 'missing.json'));
    await expect(ask('gemini-flash-latest')).rejects.toThrow(
      /^Gemini API error \(402\): prepayment credits are depleted$/
    );
    expect(vertexCalls()).toHaveLength(0);
    expect(await mod.hasGoogleAdc()).toBe(false);
  });

  it('hasGoogleAdc is true when the credentials file exists', async () => {
    expect(await mod.hasGoogleAdc()).toBe(true);
  });

  it("goes straight to Vertex with the mapped model for the key 'adc'", async () => {
    const completion = await ask('gemini-pro-latest', 'adc');
    expect(studioCalls()).toHaveLength(0);
    const v = vertexCalls();
    expect(v).toHaveLength(1);
    expect(v[0].url).toContain(`/models/${DEFAULT}:generateContent`);
    expect(v[0].url).toContain('/projects/test-project/');
    expect(v[0].headers.Authorization).toBe('Bearer fake-token');
    expect(completion.model).toBe(DEFAULT);
  });

  it('throws NO_GOOGLE_PROJECT when ADC has no quota project and no env var is set', async () => {
    await fs.writeFile(
      adcPath,
      JSON.stringify({
        type: 'authorized_user',
        client_id: 'fake-client-id',
        client_secret: 'fake-client-secret',
        refresh_token: 'fake-refresh-token',
      })
    );
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCP_PROJECT;
    await expect(ask('gemini-pro-latest', 'adc')).rejects.toThrow(mod.NO_GOOGLE_PROJECT);
    expect(vertexCalls()).toHaveLength(0);
  });
});
