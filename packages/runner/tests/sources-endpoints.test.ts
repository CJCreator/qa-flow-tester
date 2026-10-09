/**
 * Sources on the run route: Product Context documents, a docs address, saved sessions and the AI
 * cap are checked before anything starts, and the documents survive a runner restart with the plan.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIMessage, AIProviderType, ReviewPlan } from '@qa/types';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

const FIXTURE_PORT = 3720;
const RUNNER_PORT = 3721;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-sources-endpoints');
const dataDir = `${outputDir}-data`;

class QuietAI {
  readonly providerType: AIProviderType = 'mock';
  async generateText(_messages: AIMessage[]): Promise<string> {
    return '{}';
  }
}

const post = (route: string, body: unknown = {}, method = 'POST') =>
  fetch(`${runnerUrl}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const target = `http://localhost:${FIXTURE_PORT}/`;

async function waitForPhase(wanted: string[], seconds = 200): Promise<void> {
  for (let i = 0; i < seconds * 2; i++) {
    const s = (await (await fetch(`${runnerUrl}/api/runner/status`)).json()) as { phase: string; lastRunError: string };
    if (wanted.includes(s.phase)) return;
    if (s.phase === 'failed') throw new Error(`run failed: ${s.lastRunError}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timed out');
}

describe('Sources on the run route', () => {
  let runner: RunnerServer;
  const start = async () => {
    runner = new RunnerServer({ port: RUNNER_PORT, outputDir, dataDir, createAIProvider: () => new QuietAI() });
    await runner.start();
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    await start();
  });
  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('refuses a PDF with a plain message', async () => {
    const res = await post('/api/runner/run', { targetUrl: target, contextDocuments: [{ name: 'spec.pdf', text: 'x' }] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('ERR_INVALID_CONTEXT');
    expect(body.error).toContain('PDF and Word files are not supported yet');
  });

  it('refuses more than 10 documents and a document over 500 KB', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ name: `d${i}.md`, text: '# a' }));
    expect((await post('/api/runner/run', { targetUrl: target, contextDocuments: many })).status).toBe(400);
    const big = [{ name: 'big.md', text: 'a'.repeat(500 * 1024 + 1) }];
    expect((await post('/api/runner/run', { targetUrl: target, contextDocuments: big })).status).toBe(400);
  });

  it('refuses a bad docs address and a bad cap', async () => {
    const url = await post('/api/runner/run', { targetUrl: target, contextUrl: 'file:///etc/passwd' });
    expect(url.status).toBe(400);
    expect(((await url.json()) as { code: string }).code).toBe('ERR_INVALID_CONTEXT_URL');
    const cap = await post('/api/runner/run', { targetUrl: target, aiCap: { requests: 0 } });
    expect(((await cap.json()) as { code: string }).code).toBe('ERR_INVALID_CAP');
  });

  it('keeps the documents and their names in the waiting plan after a restart', async () => {
    const res = await post('/api/runner/run', {
      targetUrl: target,
      owner: true,
      useAI: true,
      aiProvider: 'mock',
      skipReview: false,
      breakpoints: ['1440px'],
      contextDocuments: [
        { name: 'admin-guide.md', text: '# Admin\n## Users\nAdmins can create users.' },
        { name: 'notes.txt', text: 'Viewers can only read.' },
      ],
    });
    expect(res.status).toBe(202);
    await waitForPhase(['awaiting-review']);
    const before = (await (await fetch(`${runnerUrl}/api/runner/plan`)).json()) as ReviewPlan;
    expect(before.contextDocuments?.map((d) => d.name)).toEqual(['admin-guide.md', 'notes.txt']);
    expect(before.contextDocuments?.[0]).not.toHaveProperty('text');

    // Edits to a Source or a Not-found entry that is not there change nothing and do not fail.
    const patched = await post(
      '/api/runner/plan',
      { sourceEdits: [{ itemId: 'nope', confirm: true }], notFoundEdits: [{ id: 'nope', remove: true }] },
      'PATCH'
    );
    expect(patched.status).toBe(200);

    await runner.stop();
    await start();
    const after = (await (await fetch(`${runnerUrl}/api/runner/plan`)).json()) as ReviewPlan;
    expect(after.contextDocuments?.map((d) => d.name)).toEqual(['admin-guide.md', 'notes.txt']);
  }, 240000);
});
