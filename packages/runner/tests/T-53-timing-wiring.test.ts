import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import { DiscoveryAgent, FlowTestOrchestrator, KeyResolver, MockAIProvider, OpenRouterClient, type SecretStore } from '@qa/core';
import type { DiscoveryDraft, TimingEntry } from '@qa/types';

/** The runner passes timing to discovery and the orchestrator only when QA_DEBUG is set (T-53). */
const RUNNER_PORT = 3297;
const SITE_PORT = 3298;

class MemoryStore implements SecretStore {
  secrets = new Map<string, string>();
  async get(account: string) {
    return this.secrets.get(account) ?? null;
  }
  async set(account: string, secret: string) {
    this.secrets.set(account, secret);
  }
}

const emptyOpenRouter = () => {
  const fetchImpl = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  return new OpenRouterClient(fetchImpl);
};

function startSite(port: number) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html lang="en"><head><title>Clean</title></head><body><main><h1>Hello</h1></main></body></html>');
  });
  return new Promise<http.Server>((resolve) => server.listen(port, () => resolve(server)));
}

async function waitForIdle(baseUrl: string) {
  for (let i = 0; i < 120; i++) {
    const status = await (await fetch(`${baseUrl}/api/runner/status`)).json();
    if (!status.isRunning) return status;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('run did not finish');
}

describe('T-53 timing wiring in the runner', () => {
  const runnerUrl = `http://localhost:${RUNNER_PORT}`;
  const siteUrl = `http://localhost:${SITE_PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-runner-timing-wiring');
  let runner: RunnerServer;
  let site: http.Server;
  let savedQaDebug: string | undefined;

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

  const post = (route: string, body: unknown) =>
    fetch(`${runnerUrl}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    site = await startSite(SITE_PORT);
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir: `${outputDir}-data`,
      keyResolver: new KeyResolver(outputDir, new MemoryStore()),
      openRouter: emptyOpenRouter(),
      createAIProvider: () => new MockAIProvider(),
    });
    await runner.start();
  });

  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => site.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(`${outputDir}-data`, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(() => {
    savedQaDebug = process.env.QA_DEBUG;
    delete process.env.QA_DEBUG;
  });

  afterEach(() => {
    if (savedQaDebug === undefined) delete process.env.QA_DEBUG;
    else process.env.QA_DEBUG = savedQaDebug;
    vi.restoreAllMocks();
  });

  it('turns timing on and hands discovery timing to the orchestrator when QA_DEBUG is set', async () => {
    process.env.QA_DEBUG = '1';
    const entry: TimingEntry = { phase: 'crawl', name: '/', durationMs: 12 };
    const discover = vi
      .spyOn(DiscoveryAgent.prototype, 'discoverWithSession')
      .mockImplementation(async (o) => ({ draft: emptyDraft(o.targetUrl), preflight: undefined, timing: [entry] }));
    const orchestrate = vi.spyOn(FlowTestOrchestrator.prototype, 'run');

    const res = await post('/api/runner/run', { targetUrl: `${siteUrl}/`, useAI: true, aiProvider: 'mock' });
    expect(res.status).toBe(202);
    await waitForIdle(runnerUrl);

    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover.mock.calls[0][0].timing).toBe(true);
    expect(orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrate.mock.calls[0][0]).toMatchObject({ timing: true, discoveryTiming: [entry] });

    const report = await (await fetch(`${runnerUrl}/api/report`)).json();
    expect(report.timing).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'crawl', name: '/' })]));
  }, 60000);

  it('sends no timing and writes no timing key to the report when QA_DEBUG is unset', async () => {
    const discover = vi
      .spyOn(DiscoveryAgent.prototype, 'discoverWithSession')
      .mockImplementation(async (o) => ({ draft: emptyDraft(o.targetUrl), preflight: undefined }));
    const orchestrate = vi.spyOn(FlowTestOrchestrator.prototype, 'run');

    const res = await post('/api/runner/run', { targetUrl: `${siteUrl}/`, useAI: true, aiProvider: 'mock' });
    expect(res.status).toBe(202);
    await waitForIdle(runnerUrl);

    expect(discover.mock.calls[0][0].timing).toBe(false);
    expect(orchestrate.mock.calls[0][0].timing).toBe(false);
    expect(orchestrate.mock.calls[0][0].discoveryTiming).toBeUndefined();

    const report = await (await fetch(`${runnerUrl}/api/report`)).json();
    expect(report).not.toHaveProperty('timing');
  }, 60000);
});
