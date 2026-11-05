/**
 * Settings picks a Gemini model the saved AI Studio key can use (POST /api/ai/settings), and lists the models
 * the key can use (GET /api/ai/gemini/models). AI Studio is a fake fetch; the key store is in memory.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIProviderType } from '@qa/types';
import { DEFAULT_MODELS, type KeyResolver } from '@qa/core';
import { RunnerServer } from '../src/server.js';

const PORT = 3783;
const STUDIO = 'https://generativelanguage.googleapis.com/v1beta';
const KEY = 'AIzaFAKE-runner-gemini-key-0123';
const scratch = path.join(process.cwd(), '.tmp-ai-gemini-models');
const modelsFile = path.join(scratch, 'data', '.qa-ai-models.json');

type Answer = { status: number; body: unknown } | Error;

/** What the fake AI Studio answers: the model list, and generateContent per model (200 when not set). */
let studio: { list: Answer; probe: Record<string, Answer> };
let studioCalls: string[];
const realFetch = globalThis.fetch;

const listOf = (...ids: string[]) => ({
  status: 200,
  body: { models: ids.map((id) => ({ name: `models/${id}`, supportedGenerationMethods: ['generateContent'] })) },
});
const KEY_INVALID = {
  status: 400,
  body: { error: { code: 400, message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } },
};
const PREPAID = { status: 402, body: { error: { message: 'Your prepayment credits are depleted.' } } };

const keys: Partial<Record<AIProviderType, string>> = {};
const keyResolver = {
  resolveKey: async (p?: AIProviderType) =>
    p && keys[p] ? { provider: p, apiKey: keys[p]!, source: 'keychain' as const } : null,
  saveByokKey: async (p: AIProviderType, k: string) => {
    keys[p] = k;
    return 'keychain' as const;
  },
  readSecret: async () => null,
  saveSecret: async () => true,
  forgetSecret: async () => {},
} as unknown as KeyResolver;

function call(method: string, rawPath: string, json?: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const payload = json === undefined ? undefined : JSON.stringify(json);
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: rawPath,
        method,
        headers: {
          host: `localhost:${PORT}`,
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) }
            : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: text ? JSON.parse(text) : null }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const savedModels = async () => JSON.parse(await fs.readFile(modelsFile, 'utf8'));

describe('Gemini model choice in Settings', () => {
  let server: RunnerServer;

  beforeAll(async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith(STUDIO)) return realFetch(input, init);
      studioCalls.push(url);
      const respond = (a: Answer) => {
        if (a instanceof Error) throw a;
        return new Response(JSON.stringify(a.body), { status: a.status });
      };
      if (url.startsWith(`${STUDIO}/models?`)) return respond(studio.list);
      const model = decodeURIComponent(/\/models\/([^:]+):generateContent/.exec(url)![1]);
      return respond(studio.probe[model] ?? { status: 200, body: { candidates: [] } });
    }) as typeof fetch;
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      keyResolver,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    globalThis.fetch = realFetch;
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  beforeEach(async () => {
    for (const p of Object.keys(keys)) delete keys[p as AIProviderType];
    await fs.rm(modelsFile, { force: true });
    studioCalls = [];
    studio = { list: listOf('gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'), probe: {} };
  });

  it('saves a new key and the model that answered, chosen automatically', async () => {
    studio.probe['gemini-2.5-flash'] = { status: 404, body: { error: { message: 'not found' } } };
    const res = await call('POST', '/api/ai/settings', { provider: 'gemini', apiKey: KEY });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      saved: true,
      provider: 'gemini',
      configured: true,
      model: 'gemini-2.0-flash',
      visionModel: 'gemini-2.0-flash',
    });
    expect(res.body.modelNote).toBeUndefined();
    expect(keys.gemini).toBe(KEY);
    const saved = await savedModels();
    expect(saved).toMatchObject({ provider: 'gemini', text: 'gemini-2.0-flash', vision: 'gemini-2.0-flash' });
    expect(saved.chosenBy).toBeUndefined();
    expect((await call('GET', '/api/ai/settings')).body.chosenBy).toBe('auto');
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it('treats a -latest alias as not naming a model', async () => {
    const res = await call('POST', '/api/ai/settings', {
      provider: 'gemini',
      apiKey: KEY,
      model: 'gemini-flash-latest',
    });
    expect(res.body.model).toBe('gemini-2.5-flash');
    expect((await savedModels()).chosenBy).toBeUndefined();
  });

  it('keeps a model the person named', async () => {
    const res = await call('POST', '/api/ai/settings', { provider: 'gemini', apiKey: KEY, model: 'gemini-2.0-flash' });
    expect(res.body.model).toBe('gemini-2.0-flash');
    expect(await savedModels()).toMatchObject({ text: 'gemini-2.0-flash', chosenBy: 'person' });
  });

  it('does not save a key AI Studio rejects', async () => {
    studio.list = KEY_INVALID;
    const res = await call('POST', '/api/ai/settings', { provider: 'gemini', apiKey: KEY });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ saved: false, code: 'key-invalid' });
    expect(res.body.reason).toMatch(/did not accept this key/);
    expect(keys.gemini).toBeUndefined();
    await expect(fs.access(modelsFile)).rejects.toThrow();
  });

  it('saves the key with a note when its project has no credit', async () => {
    studio.probe = { 'gemini-2.5-flash': PREPAID, 'gemini-2.0-flash': PREPAID };
    const res = await call('POST', '/api/ai/settings', { provider: 'gemini', apiKey: KEY });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.modelNote).toMatch(/no prepaid credit left/);
    expect(keys.gemini).toBe(KEY);
  });

  it('picks again with the saved key for model: null', async () => {
    keys.gemini = KEY;
    await fs.mkdir(path.dirname(modelsFile), { recursive: true });
    await fs.writeFile(
      modelsFile,
      JSON.stringify({
        provider: 'gemini',
        text: 'gemini-flash-latest',
        vision: 'gemini-flash-latest',
        chosenBy: 'person',
      })
    );
    const res = await call('POST', '/api/ai/settings', { provider: 'gemini', model: null });
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('gemini-2.5-flash');
    const saved = await savedModels();
    expect(saved).toMatchObject({ text: 'gemini-2.5-flash', vision: 'gemini-2.5-flash' });
    expect(saved.chosenBy).toBeUndefined();
  });

  it('does not call AI Studio for the Google sign-in key adc', async () => {
    const res = await call('POST', '/api/ai/settings', { provider: 'gemini', apiKey: 'adc' });
    expect(res.status).toBe(200);
    expect(res.body.modelNote).toBeUndefined();
    expect(studioCalls).toHaveLength(0);
  });

  describe('GET /api/ai/gemini/models', () => {
    it('lists the ranked models the saved key can use, the first recommended', async () => {
      keys.gemini = KEY;
      await fs.mkdir(path.dirname(modelsFile), { recursive: true });
      await fs.writeFile(
        modelsFile,
        JSON.stringify({ provider: 'gemini', text: 'gemini-2.0-flash', chosenBy: 'person' })
      );
      const res = await call('GET', '/api/ai/gemini/models');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        models: [
          { id: 'gemini-2.5-flash', recommended: true },
          { id: 'gemini-2.0-flash', recommended: false },
        ],
        current: 'gemini-2.0-flash',
        chosenBy: 'person',
      });
      // Listing only: no model is tried.
      expect(studioCalls.every((u) => u.startsWith(`${STUDIO}/models?`))).toBe(true);
    });

    it('is 400 without a saved Gemini key, or with a key AI Studio rejects', async () => {
      const none = await call('GET', '/api/ai/gemini/models');
      expect(none.status).toBe(400);
      expect(typeof none.body.error).toBe('string');
      keys.gemini = KEY;
      studio.list = KEY_INVALID;
      const bad = await call('GET', '/api/ai/gemini/models');
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatch(/did not accept this key/);
      expect(JSON.stringify(bad.body)).not.toContain(KEY);
    });

    it('answers the default model for the key adc, without calling AI Studio', async () => {
      keys.gemini = 'adc';
      const res = await call('GET', '/api/ai/gemini/models');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        models: [{ id: DEFAULT_MODELS.gemini, recommended: true }],
        current: null,
        chosenBy: 'auto',
      });
      expect(studioCalls).toHaveLength(0);
    });
  });
});
