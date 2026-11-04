import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';
import { promises as fs, mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import net, { type AddressInfo } from 'net';

/**
 * Listens on a port the OS picks and rejects on a listen error. Fixed ports (3186/3187) collided with a vitest
 * worker left over from an earlier run still holding them: `listen` then emits 'error' instead of calling back,
 * and beforeAll hung until its 30 s timeout with every test skipped (QA-706).
 */
function listenOnFreePort(server: http.Server): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
      server.off('error', reject);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/** A port the OS reports free. RunnerServer reads port 0 as its default 3001, so the runner gets one picked here. */
function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Polls the runner's phase until it leaves 'scanning' or the deadline passes. A fixed count of polls ignored how
 * long each status request takes and gave the scan 30 to 45 s; on the developer's 4-core laptop the scan of the
 * fixture (Chromium crawl, sign-in and planning) runs past that, alone and more so beside other browser tests
 * (QA-706). The deadline stays well inside each test's own timeout.
 */
// Waits for the review itself (or a failure), not merely for 'scanning' to end: right after the 202 the status can
// still show the previous run's 'done' for a moment, which ended the old loop before this scan began.
async function waitWhileScanning(statusUrl: string, seconds: number): Promise<{ phase: string; elapsedMs: number }> {
  const started = Date.now();
  let phase = 'scanning';
  while (phase !== 'awaiting-review' && phase !== 'failed' && Date.now() - started < seconds * 1000) {
    await new Promise((r) => setTimeout(r, 500));
    phase = (await (await fetch(statusUrl)).json()).phase;
  }
  return { phase, elapsedMs: Date.now() - started };
}

describe('RunnerServer', () => {
  let fixtureBaseUrl = '';
  let runnerBaseUrl = '';
  // A new folder per run, outside the repository: inside OneDrive the sync client picks up every file a run
  // writes (screenshots, videos), competes with Chromium for the CPU and holds files open so the clean-up fails.
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'qa-test-runner-server-'));
  const outputDir = path.join(scratch, 'report');

  let runner: RunnerServer;
  let runnerPort = 0;
  // A restart reuses the same port, as a real restart of the runner would.
  const startRunner = async (): Promise<void> => {
    runner = new RunnerServer({ port: runnerPort, outputDir, dataDir: `${outputDir}-data` });
    await runner.start();
  };

  beforeAll(async () => {
    fixtureBaseUrl = `http://localhost:${await listenOnFreePort(fixtureServer)}`;
    runnerPort = await freePort();
    runnerBaseUrl = `http://localhost:${runnerPort}`;
    await startRunner();
  });

  afterAll(async () => {
    // Undefined only when beforeAll failed; its own error is the one to read.
    await runner?.stop();
    if (fixtureServer.listening) {
      await new Promise<void>((resolve) => {
        fixtureServer.close(() => resolve());
      });
    }
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  });

  // A test that fails or times out must not leave its run active: the next test's POST would get
  // 409 (one run at a time) and fail for a reason that is not its own. Runs after the test body,
  // so the failing test stays failed.
  afterEach(async () => {
    try {
      let status = await (await fetch(`${runnerBaseUrl}/api/runner/status`)).json();
      // Stopping a run that is testing keeps the approved plan for re-approval and leaves the
      // runner "running" in awaiting-review; a second stop discards it. So stop until idle.
      for (let attempt = 0; attempt < 3 && status.isRunning; attempt++) {
        // discard: a plan waiting for review is otherwise kept by a stop.
        await fetch(`${runnerBaseUrl}/api/runner/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discard: true }),
        });
        status = await (await fetch(`${runnerBaseUrl}/api/runner/status`)).json();
      }
    } catch {
      // Server not reachable: nothing to stop.
    }
  }, 30000);

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

  it('starts one run when two starts arrive together, and answers the second with 409', async () => {
    const start = () =>
      fetch(`${runnerBaseUrl}/api/runner/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: fixtureBaseUrl, skipReview: true }),
      });
    const [a, b] = await Promise.all([start(), start()]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    const refused = a.status === 409 ? a : b;
    expect((await refused.json()).code).toBe('ERR_RUN_IN_PROGRESS');

    // Stop reports that the run was stopped.
    const stopped = await (await fetch(`${runnerBaseUrl}/api/runner/stop`, { method: 'POST' })).json();
    expect(stopped.aborted).toBe(true);
  }, 60000);

  it('refuses an address that is not http or https', async () => {
    for (const targetUrl of ['file:///etc/passwd', 'javascript:alert(1)']) {
      const res = await fetch(`${runnerBaseUrl}/api/runner/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl }),
      });
      expect(res.status, targetUrl).toBe(400);
    }
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
    for (let i = 0; i < 90 && isRunning; i++) {
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
  }, 60000);

  it('never serves saved sign-in sessions, which hold live session cookies', async () => {
    await fs.mkdir(path.join(outputDir, 'auth'), { recursive: true });
    await fs.writeFile(
      path.join(outputDir, 'auth', 'manager.json'),
      '{"cookies":[{"name":"session","value":"secret"}]}'
    );
    await fs.writeFile(path.join(outputDir, 'visible.json'), '{}');

    expect((await fetch(`${runnerBaseUrl}/api/evidence/auth/manager.json`)).status).toBe(403);
    expect((await fetch(`${runnerBaseUrl}/api/evidence/auth%2Fmanager.json`)).status).toBe(403);
    expect((await fetch(`${runnerBaseUrl}/api/evidence/visible.json`)).status).toBe(200);

    // Other spellings of the same folder: Windows and macOS open "AUTH" as "auth".
    for (const variant of ['AUTH/manager.json', 'Auth/manager.json', 'auth./manager.json', 'auth%2E/manager.json']) {
      const res = await fetch(`${runnerBaseUrl}/api/evidence/${variant}`);
      expect(res.status, variant).not.toBe(200);
      expect(await res.text(), variant).not.toContain('secret');
    }
  });

  it('pauses in awaiting-review when skipReview: false, survives runner reload, accepts PATCH edits, and resumes on approve', async () => {
    const runRes = await fetch(`${runnerBaseUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: fixtureBaseUrl,
        productId: 'pause-test',
        useAI: true,
        aiProvider: 'mock',
        skipReview: false,
        // Bounded: this test is about pausing and resuming, not how much of the site is crawled.
        maxPages: 10,
        breakpoints: ['375px'],
      }),
    });
    expect(runRes.status).toBe(202);
    const { runId } = await runRes.json();
    expect(runId).toBeTruthy();

    // Poll until discovery completes and runner pauses in awaiting-review
    const scan = await waitWhileScanning(`${runnerBaseUrl}/api/runner/status`, 150);
    expect(scan.phase, `phase after ${scan.elapsedMs} ms`).toBe('awaiting-review');

    // GET /api/runner/plan returns the formulated plan
    const planRes = await fetch(`${runnerBaseUrl}/api/runner/plan`);
    expect(planRes.status).toBe(200);
    const plan = await planRes.json();
    expect(plan.runId).toBe(runId);
    expect(plan.pages.length).toBeGreaterThan(0);
    expect(plan.flows.length).toBeGreaterThan(0);

    // plan export downloads a zip while the plan awaits review
    const exportRes = await fetch(`${runnerBaseUrl}/api/runner/plan/export`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers.get('content-type')).toBe('application/zip');
    expect(exportRes.headers.get('content-disposition')).toContain('playwright-export-');
    const exportBytes = Buffer.from(await exportRes.arrayBuffer());
    expect([...exportBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    // Plan survives runner reload
    await runner.stop();
    await startRunner();

    const reloadedPlanRes = await fetch(`${runnerBaseUrl}/api/runner/plan`);
    expect(reloadedPlanRes.status).toBe(200);
    const reloadedPlan = await reloadedPlanRes.json();
    expect(reloadedPlan.runId).toBe(runId);

    // An edited test aimed at something the scan never found is refused, and nothing changes.
    const refusedRes = await fetch(`${runnerBaseUrl}/api/runner/plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: { [reloadedPlan.questions[0]?.id ?? 'none']: 'Skip permanently' },
        testCases: [
          {
            id: 'TC-MADE-UP',
            flowId: 'made-up',
            role: 'anonymous',
            startPage: '/dashboard',
            steps: [
              { action: 'click', selector: '[data-testid="no-such-button"]', name: 'Press a button that is not there' },
            ],
            expectations: {},
          },
        ],
      }),
    });
    expect(refusedRes.status).toBe(422);
    expect((await refusedRes.json()).issues[0].message).toContain('no-such-button');
    const unchanged = await (await fetch(`${runnerBaseUrl}/api/runner/plan`)).json();
    expect(unchanged.testCases).toEqual(reloadedPlan.testCases);
    expect(unchanged.questions).toEqual(reloadedPlan.questions);

    // PATCH /api/runner/plan applies user edits
    const patchRes = await fetch(`${runnerBaseUrl}/api/runner/plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flows: [
          {
            id: 'FLOW-CUSTOM-001',
            name: 'Custom User Flow',
            role: 'anonymous',
            startPage: '/',
            steps: [{ action: 'wait', name: 'Wait on home page' }],
          },
        ],
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchedPlan = await patchRes.json();
    expect(patchedPlan.flows[0].id).toBe('FLOW-CUSTOM-001');

    // POST /api/runner/plan/approve starts testing
    const approveRes = await fetch(`${runnerBaseUrl}/api/runner/plan/approve`, {
      method: 'POST',
    });
    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.status).toBe('approved');

    // plan export answers 404 once the plan is no longer awaiting review
    const exportAfter = await fetch(`${runnerBaseUrl}/api/runner/plan/export`);
    expect(exportAfter.status).toBe(404);
    expect((await exportAfter.json()).error).toBe('No plan awaiting review');

    // Poll until run completes. A deadline, not a count of polls: on the 4-core laptop with url-first.test.ts
    // running beside it, testing these 24 items ran past 150 s and then past 240 s, still making progress (QA-706).
    const testingStarted = Date.now();
    let isRunning = true;
    while (isRunning && Date.now() - testingStarted < 400_000) {
      await new Promise((r) => setTimeout(r, 500));
      const statusRes = await fetch(`${runnerBaseUrl}/api/runner/status`);
      const status = await statusRes.json();
      isRunning = status.isRunning;
    }
    expect(isRunning, `still running after ${Date.now() - testingStarted} ms`).toBe(false);

    const reportRes = await fetch(`${runnerBaseUrl}/api/report`);
    expect(reportRes.status).toBe(200);
    const report = await reportRes.json();
    expect(report.runId).toBe(runId);

    // Once tested, the plan is gone: a restart doesn't bring it back for review.
    await runner.stop();
    await startRunner();
    const afterRestart = await (await fetch(`${runnerBaseUrl}/api/runner/status`)).json();
    expect(afterRestart).toMatchObject({ phase: 'idle', hasPlan: false, isRunning: false });
    expect((await fetch(`${runnerBaseUrl}/api/runner/plan`)).status).toBe(404);
    // Raised from 240 s (QA-706): up to 150 s of scanning plus up to 400 s of testing, as measured on the 4-core
    // laptop beside url-first.test.ts (testing alone ran past 240 s), with room for the two restarts.
  }, 600000);

  it('keeps sign-in details out of the saved plan, and asks for them again after a restart', async () => {
    const roles = [
      { role: 'manager', username: 'manager@example.com', password: 'manager-password', loginPath: '/signin' },
    ];
    const runRes = await fetch(`${runnerBaseUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: fixtureBaseUrl,
        productId: 'secrets-test',
        useAI: true,
        aiProvider: 'mock',
        skipReview: false,
        // Bounded: this test is about the saved plan's secrets, not how much of the site is crawled.
        maxPages: 10,
        breakpoints: ['375px'],
        roles,
      }),
    });
    expect(runRes.status).toBe(202);

    const scan = await waitWhileScanning(`${runnerBaseUrl}/api/runner/status`, 150);
    expect(scan.phase, `phase after ${scan.elapsedMs} ms`).toBe('awaiting-review');

    const saved = await fs.readFile(path.join(`${outputDir}-data`, '.qa-plan.json'), 'utf8');
    expect(saved).not.toContain('manager-password');
    expect(saved).not.toContain('manager@example.com');

    // After a restart the plan is still there, but approving needs the sign-in details again.
    await runner.stop();
    await startRunner();

    const withoutRes = await fetch(`${runnerBaseUrl}/api/runner/plan/approve`, { method: 'POST' });
    expect(withoutRes.status).toBe(409);
    expect((await withoutRes.json()).needsSignIn).toEqual(['manager']);
    expect((await (await fetch(`${runnerBaseUrl}/api/runner/status`)).json()).phase).toBe('awaiting-review');

    const withRes = await fetch(`${runnerBaseUrl}/api/runner/plan/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles }),
    });
    expect(withRes.status).toBe(200);

    // A deadline, not a count of polls (QA-706): the 700 polls of 500 ms also counted each status request's time.
    const testingStarted = Date.now();
    let isRunning = true;
    while (isRunning && Date.now() - testingStarted < 400_000) {
      await new Promise((r) => setTimeout(r, 500));
      isRunning = (await (await fetch(`${runnerBaseUrl}/api/runner/status`)).json()).isRunning;
    }
    expect(isRunning, `still running after ${Date.now() - testingStarted} ms`).toBe(false);

    // The details sent with the approval were used: the manager signed in.
    const report = await (await fetch(`${runnerBaseUrl}/api/report`)).json();
    expect(report.productId).toBe('secrets-test');
    expect((report.notes || []).filter((n: string) => n.includes('Signing in as'))).toEqual([]);
    // Raised from 420 s (QA-706): this test took 344 s alone on the 4-core laptop, close to the old limit; now up
    // to 150 s of scanning plus up to 400 s of testing, with room for the restart.
  }, 600000);

  it('runs straight through to completion when skipReview: true is provided', async () => {
    const runRes = await fetch(`${runnerBaseUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: fixtureBaseUrl,
        productId: 'skip-review-test',
        useAI: true,
        aiProvider: 'mock',
        skipReview: true,
        // Bounded: this test is about the run reaching done, not how much of the site is crawled.
        maxPages: 10,
        breakpoints: ['375px'],
      }),
    });
    expect(runRes.status).toBe(202);
    const { runId } = await runRes.json();

    let isRunning = true;
    for (let i = 0; i < 480 && isRunning; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const statusRes = await fetch(`${runnerBaseUrl}/api/runner/status`);
      const status = await statusRes.json();
      // Must never get stuck in awaiting-review
      expect(status.phase).not.toBe('awaiting-review');
      isRunning = status.isRunning;
    }
    expect(isRunning).toBe(false);

    const reportRes = await fetch(`${runnerBaseUrl}/api/report`);
    expect(reportRes.status).toBe(200);
    const report = await reportRes.json();
    expect(report.runId).toBe(runId);
  }, 270000);
});
