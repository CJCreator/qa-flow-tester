import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';
import { promises as fs } from 'fs';
import path from 'path';

describe('RunnerServer', () => {
  const FIXTURE_PORT = 3186;
  const RUNNER_PORT = 3187;
  const fixtureBaseUrl = `http://localhost:${FIXTURE_PORT}`;
  const runnerBaseUrl = `http://localhost:${RUNNER_PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-runner-report');

  let runner: RunnerServer;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      fixtureServer.listen(FIXTURE_PORT, () => resolve());
    });
    runner = new RunnerServer({ port: RUNNER_PORT, outputDir, dataDir: `${outputDir}-data` });
    await runner.start();
  });

  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => {
      fixtureServer.close(() => resolve());
    });
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(`${outputDir}-data`, { recursive: true, force: true }).catch(() => {});
  });

  it('rejects a missing targetUrl with 400', async () => {
    const res = await fetch(`${runnerBaseUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 from /api/report before any run has completed', async () => {
    const res = await fetch(`${runnerBaseUrl}/api/report`);
    expect(res.status).toBe(404);
  });

  it('accepts a POST /api/runner/run, streams events over SSE, and exposes the finished report', async () => {
    const events: any[] = [];
    const streamController = new AbortController();
    const streamRes = await fetch(`${runnerBaseUrl}/api/runner/stream`, {
      signal: streamController.signal,
    });
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const pump = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';
          for (const chunk of lines) {
            const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (dataLine) {
              try {
                events.push(JSON.parse(dataLine.slice(6)));
              } catch {
                // ignore
              }
            }
          }
        }
      } catch {
        // aborted/closed — expected during teardown
      }
    })();

    // give the SSE connection a beat to establish before triggering the run
    await new Promise((r) => setTimeout(r, 200));

    const runRes = await fetch(`${runnerBaseUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: fixtureBaseUrl, productId: 'runner-test' }),
    });
    expect(runRes.status).toBe(202);
    const { runId } = await runRes.json();
    expect(runId).toBeTruthy();

    // Second concurrent trigger must be rejected (single-flight).
    const concurrentRes = await fetch(`${runnerBaseUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: fixtureBaseUrl }),
    });
    expect(concurrentRes.status).toBe(409);

    // Poll status until the run finishes.
    let isRunning = true;
    for (let i = 0; i < 60 && isRunning; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const statusRes = await fetch(`${runnerBaseUrl}/api/runner/status`);
      const status = await statusRes.json();
      isRunning = status.isRunning;
    }
    expect(isRunning).toBe(false);

    const reportRes = await fetch(`${runnerBaseUrl}/api/report`);
    expect(reportRes.status).toBe(200);
    const report = await reportRes.json();
    expect(report.productId).toBe('runner-test');
    expect(report.results.length).toBeGreaterThan(0);

    streamController.abort();
    await pump.catch(() => {});

    expect(events.some((e) => e.type === 'RUN_STARTED')).toBe(true);
    expect(events.some((e) => e.type === 'STEP_STARTED')).toBe(true);
    expect(events.some((e) => e.type === 'STEP_COMPLETED')).toBe(true);
    expect(events.some((e) => e.type === 'RUN_COMPLETED')).toBe(true);
  }, 45000);

  it('never serves saved sign-in sessions, which hold live session cookies', async () => {
    await fs.mkdir(path.join(outputDir, 'auth'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'auth', 'manager.json'), '{"cookies":[{"name":"session","value":"secret"}]}');
    await fs.writeFile(path.join(outputDir, 'visible.json'), '{}');

    expect((await fetch(`${runnerBaseUrl}/api/evidence/auth/manager.json`)).status).toBe(403);
    expect((await fetch(`${runnerBaseUrl}/api/evidence/auth%2Fmanager.json`)).status).toBe(403);
    expect((await fetch(`${runnerBaseUrl}/api/evidence/visible.json`)).status).toBe(200);
  });
});
