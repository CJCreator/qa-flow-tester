/**
 * The docs address on a run: a public-looking site never reads a private docs address (the guard),
 * a failure becomes a plan note and not a failed run, and the page limit is 20.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIMessage, AIProviderType, ReviewPlan } from '@qa/types';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

const FIXTURE_PORT = 3724;
const RUNNER_PORT = 3725;
const DOCS_PORT = 3726;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-docs-url');
const dataDir = `${outputDir}-data`;

class QuietAI {
  readonly providerType: AIProviderType = 'mock';
  async generateText(_messages: AIMessage[]): Promise<string> {
    return '{}';
  }
}

/** A docs site of 30 pages, each linking to the next, plus one link to another host. */
const docsServer = http.createServer((req, res) => {
  const n = Number(/\/page(\d+)/.exec(req.url || '')?.[1] ?? 0);
  if (req.url === '/robots.txt') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(
    `<html><body><h1>Page ${n}</h1><p>Admins can do thing ${n}.</p><a href="/page${n + 1}">next</a><a href="http://other.example.net/x">off</a></body></html>`
  );
});

const post = (body: unknown) =>
  fetch(`${runnerUrl}/api/runner/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function waitForPhase(wanted: string[], seconds = 240): Promise<void> {
  for (let i = 0; i < seconds * 2; i++) {
    const s = (await (await fetch(`${runnerUrl}/api/runner/status`)).json()) as { phase: string; lastRunError: string };
    if (wanted.includes(s.phase)) return;
    if (s.phase === 'failed') throw new Error(`run failed: ${s.lastRunError}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timed out');
}
const plan = async (): Promise<ReviewPlan> => (await fetch(`${runnerUrl}/api/runner/plan`)).json();

describe('Docs address', () => {
  let runner: RunnerServer;
  beforeAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    await new Promise<void>((resolve) => docsServer.listen(DOCS_PORT, () => resolve()));
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir,
      hostAliases: { 'shop.example.com': 'localhost' },
      createAIProvider: () => new QuietAI(),
    });
    await runner.start();
  });
  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await new Promise<void>((resolve) => docsServer.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('a public-looking site does not read a private docs address; the run goes on with a note', async () => {
    const res = await post({
      targetUrl: `http://shop.example.com:${FIXTURE_PORT}/`,
      owner: true,
      useAI: true,
      aiProvider: 'mock',
      skipReview: false,
      breakpoints: ['1440px'],
      contextUrl: `http://localhost:${DOCS_PORT}/page1`,
    });
    expect(res.status).toBe(202);
    await waitForPhase(['awaiting-review']);
    const p = await plan();
    expect(p.contextDocuments ?? []).toEqual([]);
    expect((p.notes ?? []).join('\n')).toContain('No pages could be read from the docs address');
  }, 240000);

  it('a site on this machine reads the docs, stops at 20 pages and ignores the other host', async () => {
    await fetch(`${runnerUrl}/api/runner/abort`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    const res = await post({
      targetUrl: `http://localhost:${FIXTURE_PORT}/`,
      owner: true,
      useAI: true,
      aiProvider: 'mock',
      skipReview: false,
      breakpoints: ['1440px'],
      contextUrl: `http://localhost:${DOCS_PORT}/page1`,
    });
    expect(res.status).toBe(202);
    await waitForPhase(['awaiting-review']);
    const p = await plan();
    expect(p.contextDocuments?.length).toBe(20);
    expect(p.contextDocuments?.some((d) => d.name.includes('other.example.net'))).toBe(false);
  }, 240000);
});
