import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import {
  DiscoveryAgent,
  FlowTestOrchestrator,
  KeyResolver,
  MockAIProvider,
  OpenRouterClient,
  type SecretStore,
} from '@qa/core';
import type { DiscoveryDraft } from '@qa/types';

const GOOD_KEY = 'sk-or-v1-good-key-123';

class MemoryStore implements SecretStore {
  secrets = new Map<string, string>();
  async get(account: string) {
    return this.secrets.get(account) ?? null;
  }
  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
}

/** Fake OpenRouter: GOOD_KEY is valid; the model list is whatever the test sets. */
function fakeOpenRouter() {
  const state = {
    models: [] as unknown[],
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (url.endsWith('/key')) return new Response('{}', { status: auth === `Bearer ${GOOD_KEY}` ? 200 : 401 });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: state.models }));
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { client: new OpenRouterClient(fetchImpl), state };
}

const freeModel = (id: string) => ({
  id,
  name: id,
  context_length: 128000,
  pricing: { prompt: '0', completion: '0' },
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  supported_parameters: ['response_format'],
});

/** Serves `/` (a page with forms) and `/clean` (a page with nothing to report); logs every request. */
function startSite(port: number) {
  const requests: string[] = [];
  const pages: Record<string, string> = {
    '/': `<!doctype html><html lang="en"><head><title>Shop</title></head><body><main><h1>Shop</h1>
      <button><svg></svg></button>
      <form method="post" action="/order"><input aria-label="Qty" name="q"><button>Features</button></form>
      <details><summary>Shipping</summary>Free</details></main></body></html>`,
    // Links only to itself: website scans follow links, and this page must stay the only one visited.
    '/clean/': `<!doctype html><html lang="en"><head><title>Clean</title></head><body><nav><a href="/clean/">Home</a></nav><main><h1>Hello</h1><p>Nothing to see.</p></main></body></html>`,
  };
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const page = pages[req.url || ''];
    res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html' });
    res.end(page || '');
  });
  return new Promise<{ server: http.Server; requests: string[] }>((resolve) =>
    server.listen(port, () => resolve({ server, requests }))
  );
}

async function waitForIdle(baseUrl: string) {
  for (let i = 0; i < 120; i++) {
    const status = await (await fetch(`${baseUrl}/api/runner/status`)).json();
    if (!status.isRunning) return status;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('run did not finish');
}

describe('Runner endpoints for the wizard', () => {
  const RUNNER_PORT = 3287;
  const SITE_PORT = 3288;
  const runnerUrl = `http://localhost:${RUNNER_PORT}`;
  const siteUrl = `http://localhost:${SITE_PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-runner-wizard');
  const store = new MemoryStore();
  const openRouter = fakeOpenRouter();
  let runner: RunnerServer;
  let site: { server: http.Server; requests: string[] };

  beforeAll(async () => {
    site = await startSite(SITE_PORT);
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir: `${outputDir}-data`,
      keyResolver: new KeyResolver(outputDir, store),
      openRouter: openRouter.client,
      createAIProvider: () => new MockAIProvider(),
    });
    await runner.start();
  });

  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => site.server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(`${outputDir}-data`, { recursive: true, force: true }).catch(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${runnerUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  describe('Task 0.1: productContext', () => {
    const emptyDraft = (targetUrl: string): DiscoveryDraft => ({
      version: '1.0',
      productId: 'p',
      targetUrl,
      timestamp: new Date().toISOString(),
      pages: [],
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
    });

    it('writes productContext to a file and hands its path to discovery', async () => {
      const discover = vi.spyOn(DiscoveryAgent.prototype, 'discover').mockImplementation(async (o) => emptyDraft(o.targetUrl));
      const context = '# Checkout\n- Coupon codes are case-insensitive\n\n# Sign in\nUsers sign in with email.';

      const res = await post('/api/runner/run', { targetUrl: `${siteUrl}/clean/`, useAI: true, productContext: context });
      expect(res.status).toBe(202);
      await waitForIdle(runnerUrl);

      expect(discover).toHaveBeenCalledTimes(1);
      const contextFilePath = discover.mock.calls[0][0].contextFilePath;
      expect(contextFilePath).toBeTruthy();
      expect(await fs.readFile(contextFilePath!, 'utf8')).toBe(context);
    }, 60000);

    it('passes no context file when productContext is omitted', async () => {
      const discover = vi.spyOn(DiscoveryAgent.prototype, 'discover').mockImplementation(async (o) => emptyDraft(o.targetUrl));

      await post('/api/runner/run', { targetUrl: `${siteUrl}/clean/`, useAI: true });
      await waitForIdle(runnerUrl);

      expect(discover).toHaveBeenCalledTimes(1);
      expect(discover.mock.calls[0][0].contextFilePath).toBeUndefined();
    }, 60000);
  });

  describe('Tasks 0.2 / 0.3: OpenRouter', () => {
    it('validates keys and never echoes or logs them', async () => {
      const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];

      const good = await post('/api/ai/openrouter/validate', { apiKey: GOOD_KEY });
      expect(await good.json()).toEqual({ valid: true });

      const bad = await post('/api/ai/openrouter/validate', { apiKey: 'sk-or-v1-revoked' });
      expect(bad.status).toBe(200);
      const badBody = await bad.json();
      expect(badBody.valid).toBe(false);
      expect(badBody.reason).toEqual(expect.any(String));

      const malformed = await post('/api/ai/openrouter/validate', { apiKey: 'not a key' });
      expect((await malformed.json()).valid).toBe(false);

      const loggedText = logs.flatMap((spy) => spy.mock.calls.flat()).join(' ');
      expect(loggedText).not.toContain(GOOD_KEY);
      expect(loggedText).not.toContain('sk-or-v1-revoked');
      // Validation alone stores nothing
      expect(store.secrets.size).toBe(0);
    });

    it('lists only free models with a recommendation, and 401s a bad key', async () => {
      openRouter.state.models = [
        freeModel('vendor/a:free'),
        { ...freeModel('paid/b'), pricing: { prompt: '0.00001', completion: '0.00002' } },
      ];

      const ok = await fetch(`${runnerUrl}/api/ai/openrouter/free-models`, {
        headers: { Authorization: `Bearer ${GOOD_KEY}` },
      });
      const body = await ok.json();
      expect(body.models.map((m: { id: string }) => m.id)).toEqual(['vendor/a:free']);
      expect(body.recommendedModel).toBe('vendor/a:free');

      const unauthorized = await fetch(`${runnerUrl}/api/ai/openrouter/free-models`, {
        headers: { Authorization: 'Bearer sk-or-v1-revoked' },
      });
      expect(unauthorized.status).toBe(401);
      expect((await unauthorized.json()).error).toEqual(expect.any(String));

      const missing = await fetch(`${runnerUrl}/api/ai/openrouter/free-models`);
      expect(missing.status).toBe(401);
    });

    it('returns an empty list without erroring when nothing is free', async () => {
      openRouter.state.models = [{ ...freeModel('paid/b'), pricing: { prompt: '1', completion: '1' } }];
      const res = await fetch(`${runnerUrl}/api/ai/openrouter/free-models`, {
        headers: { Authorization: `Bearer ${GOOD_KEY}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ models: [], recommendedModel: null, recommendedVisionModel: null });
    });

    it('saves a valid key once, then serves free models from the saved key', async () => {
      expect(await (await fetch(`${runnerUrl}/api/ai/openrouter/key`)).json()).toEqual({
        configured: false,
        model: null,
        visionModel: null,
      });

      const rejected = await post('/api/ai/openrouter/key', { apiKey: 'sk-or-v1-revoked' });
      expect(rejected.status).toBe(400);
      expect(store.secrets.size).toBe(0);

      // Nothing is free at this moment: the key is kept, with no model yet.
      const saved = await post('/api/ai/openrouter/key', { apiKey: GOOD_KEY });
      expect(await saved.json()).toEqual({ saved: true, model: null, visionModel: null });
      expect(store.secrets.get('openrouter')).toBe(GOOD_KEY);

      const status = await (await fetch(`${runnerUrl}/api/ai/openrouter/key`)).text();
      expect(JSON.parse(status)).toEqual({ configured: true, model: null, visionModel: null });
      expect(status).not.toContain(GOOD_KEY);

      openRouter.state.models = [freeModel('vendor/a:free')];
      const models = await fetch(`${runnerUrl}/api/ai/openrouter/free-models`);
      expect((await models.json()).recommendedModel).toBe('vendor/a:free');
    });

    it('chooses one fixed model and keeps it while it stays free', async () => {
      openRouter.state.models = [freeModel('vendor/a:free')];
      expect(await (await post('/api/ai/openrouter/key', { apiKey: GOOD_KEY })).json()).toMatchObject({ model: 'vendor/a:free' });

      // A newer free model appears first in the list; runs stay on the chosen one.
      openRouter.state.models = [freeModel('vendor/newer:free'), freeModel('vendor/a:free')];
      expect(await (await post('/api/ai/openrouter/key', { apiKey: GOOD_KEY })).json()).toMatchObject({ model: 'vendor/a:free' });
      expect(await (await fetch(`${runnerUrl}/api/ai/openrouter/key`)).json()).toMatchObject({ model: 'vendor/a:free' });

      // It stops being free: the next best one takes over.
      openRouter.state.models = [freeModel('vendor/newer:free')];
      expect(await (await post('/api/ai/openrouter/key', { apiKey: GOOD_KEY })).json()).toMatchObject({ model: 'vendor/newer:free' });
    });
  });

  describe('Pre-flight check', () => {
    it('reports reachable, unreachable and invalid URLs', async () => {
      expect(await (await post('/api/runner/preflight', { targetUrl: siteUrl })).json()).toMatchObject({ reachable: true });

      const down = await (await post('/api/runner/preflight', { targetUrl: 'http://localhost:3299' })).json();
      expect(down).toMatchObject({ reachable: false, reason: 'unreachable' });

      const invalid = await post('/api/runner/preflight', { targetUrl: 'not a url' });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ reachable: false, reason: 'invalid-url' });
    });

    it('rewrites localhost targets when running in a container', async () => {
      const containerRunner = new RunnerServer({ port: 3289, outputDir, dataDir: `${outputDir}-data`, localhostAlias: 'host-alias.invalid' });
      await containerRunner.start();
      try {
        const res = await fetch('http://localhost:3289/api/runner/preflight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUrl: siteUrl }),
        });
        // The same URL that is reachable above now points at the (nonexistent) alias host
        expect(await res.json()).toMatchObject({ reachable: false });
      } finally {
        await containerRunner.stop();
      }
    });
  });

  describe('Task 5.2: safe-public runs', () => {
    it('scans read-only: no discovery, no orchestrator, no mutating requests', async () => {
      const discover = vi.spyOn(DiscoveryAgent.prototype, 'discover');
      const orchestrate = vi.spyOn(FlowTestOrchestrator.prototype, 'run');
      site.requests.length = 0;

      const res = await post('/api/runner/run', { targetUrl: siteUrl, mode: 'safe-public', useAI: true });
      expect(res.status).toBe(202);
      const status = await waitForIdle(runnerUrl);
      expect(status.lastRunError).toBeNull();

      expect(discover).not.toHaveBeenCalled();
      expect(orchestrate).not.toHaveBeenCalled();
      expect(site.requests.filter((r) => !r.startsWith('GET'))).toEqual([]);
      expect(site.requests.some((r) => r.includes('/order'))).toBe(false);

      const report = await (await fetch(`${runnerUrl}/api/report`)).json();
      expect(report.scanMode).toBe('safe-public');
      expect(report.findings.some((f: { title: string }) => f.title.includes('button-name'))).toBe(true);
    }, 60000);

    it('serves report.md and findings.json byte-for-byte, including for a run with zero findings', async () => {
      await post('/api/runner/run', { targetUrl: `${siteUrl}/clean/`, mode: 'safe-public' });
      await waitForIdle(runnerUrl);
      const report = await (await fetch(`${runnerUrl}/api/report`)).json();
      expect(report.findings.map((f: { title: string }) => f.title)).toEqual([]);

      for (const file of ['report.md', 'findings.json']) {
        const res = await fetch(`${runnerUrl}/api/report/download/${file}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-disposition')).toContain(file);
        const served = Buffer.from(await res.arrayBuffer());
        expect(served.equals(await fs.readFile(path.join(outputDir, file)))).toBe(true);
      }

      expect((await fetch(`${runnerUrl}/api/report/download/..%2F..%2Fpackage.json`)).status).toBe(404);
    }, 60000);
  });
});
