/**
 * Saved sessions are memory only (ADR 0021): the cookie value never shows in the plan, the events,
 * the plan file, the report files, the log or an error, and the session is gone when the run ends.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIMessage, AIProviderType } from '@qa/types';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

const FIXTURE_PORT = 3722;
const RUNNER_PORT = 3723;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-session-secrecy');
const dataDir = `${outputDir}-data`;
const SENTINEL = 'SENTINEL-session-cookie-7f3a9c21';
const target = `http://localhost:${FIXTURE_PORT}/`;

class QuietAI {
  readonly providerType: AIProviderType = 'mock';
  async generateText(_messages: AIMessage[]): Promise<string> {
    return '{}';
  }
}

const session = (domain: string) => ({
  cookies: [{ name: 'sid', value: SENTINEL, domain, path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
  origins: [],
});
const post = (route: string, body: unknown = {}) =>
  fetch(`${runnerUrl}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function waitForPhase(wanted: string[], seconds = 240): Promise<void> {
  for (let i = 0; i < seconds * 2; i++) {
    const s = (await (await fetch(`${runnerUrl}/api/runner/status`)).json()) as { phase: string; lastRunError: string };
    if (wanted.includes(s.phase)) return;
    if (s.phase === 'failed') throw new Error(`run failed: ${s.lastRunError}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timed out');
}

async function allText(dir: string): Promise<string> {
  let out = '';
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out += await allText(p);
    else if (/\.(json|md|html|txt|log)$/.test(entry.name)) out += await fs.readFile(p, 'utf8').catch(() => '');
  }
  return out;
}

describe('Saved sessions stay in memory', () => {
  let runner: RunnerServer;
  const logged: string[] = [];

  beforeAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    for (const level of ['log', 'warn', 'error', 'info'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    runner = new RunnerServer({ port: RUNNER_PORT, outputDir, dataDir, createAIProvider: () => new QuietAI() });
    await runner.start();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await runner.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('refuses a cookie for another site, and an oversize session, without echoing them', async () => {
    const foreign = await post('/api/runner/run', { targetUrl: target, savedSessions: { member: session('evil.example.com') } });
    expect(foreign.status).toBe(400);
    expect(await foreign.text()).not.toContain(SENTINEL);
    const huge = session('localhost');
    huge.cookies[0].value = SENTINEL + 'x'.repeat(300 * 1024);
    const big = await post('/api/runner/run', { targetUrl: target, savedSessions: { member: huge } });
    expect(big.status).toBe(400);
    expect(await big.text()).not.toContain(SENTINEL);
  });

  it('never shows the session in the plan, events, files, report or log, and drops it when the run ends', async () => {
    const events = new AbortController();
    let streamed = '';
    fetch(`${runnerUrl}/api/runner/stream`, { signal: events.signal })
      .then(async (res) => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          streamed += decoder.decode(value);
        }
      })
      .catch(() => {});

    const res = await post('/api/runner/run', {
      targetUrl: target,
      owner: true,
      useAI: true,
      aiProvider: 'mock',
      skipReview: false,
      breakpoints: ['1440px'],
      savedSessions: { member: session('localhost') },
    });
    expect(res.status).toBe(202);
    await waitForPhase(['awaiting-review']);

    const planText = await (await fetch(`${runnerUrl}/api/runner/plan`)).text();
    expect(planText).not.toContain(SENTINEL);
    const planFile = await fs.readFile(path.join(dataDir, '.qa-plan.json'), 'utf8');
    expect(planFile).not.toContain(SENTINEL);
    // The file only says which roles need their session sent again.
    expect(JSON.parse(planFile).context.sessionNotSaved).toEqual(['member']);

    expect((await post('/api/runner/plan/approve')).status).toBe(200);
    await waitForPhase(['done']);
    events.abort();

    expect(streamed).not.toContain(SENTINEL);
    expect(await (await fetch(`${runnerUrl}/api/report`)).text()).not.toContain(SENTINEL);
    expect(await allText(outputDir)).not.toContain(SENTINEL);
    expect(await allText(dataDir)).not.toContain(SENTINEL);
    expect(logged.join('\n')).not.toContain(SENTINEL);
    expect((runner as unknown as { savedSessions: Map<string, unknown> }).savedSessions.size).toBe(0);
  }, 300000);
});
