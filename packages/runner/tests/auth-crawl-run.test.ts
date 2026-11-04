import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';
import { promises as fs, mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';

describe('T-117 Runner auth crawl SSE and report (auth-crawl-run.test.ts)', () => {
  let fixturePort: number;
  let fixtureBase: string;
  let runnerBase: string;
  // A new folder per run, outside the repository: inside OneDrive the sync client picks up every file a run
  // writes (screenshots, videos), competes with Chromium for the CPU and holds files open so the clean-up fails.
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'qa-test-auth-crawl-run-'));
  const outputDir = path.join(scratch, 'report');
  const dataDir = path.join(scratch, 'data');

  let runner: RunnerServer;

  beforeAll(async () => {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });

    await new Promise<void>((resolve) => {
      fixtureServer.listen(0, () => {
        const addr = fixtureServer.address();
        if (addr && typeof addr === 'object') {
          fixturePort = addr.port;
          fixtureBase = `http://localhost:${fixturePort}`;
        }
        resolve();
      });
    });

    runner = new RunnerServer({
      port: 0,
      outputDir,
      dataDir,
    });
    // start() resolves to the bound address (http://<host>:<port>).
    runnerBase = await runner.start();
  });

  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  });

  beforeEach(async () => {
    await fetch(`${fixtureBase}/lab/reset`, { method: 'POST' });
  });

  afterEach(async () => {
    try {
      let status = await (await fetch(`${runnerBase}/api/runner/status`)).json();
      for (let attempt = 0; attempt < 3 && status.isRunning; attempt++) {
        await fetch(`${runnerBase}/api/runner/stop`, { method: 'POST' });
        status = await (await fetch(`${runnerBase}/api/runner/status`)).json();
      }
    } catch {}
  }, 30000);

  it('streams DISCOVERY_PROGRESS with optional fields and serves report with pageCoverage', async () => {
    const events: any[] = [];
    const streamController = new AbortController();
    const streamRes = await fetch(`${runnerBase}/api/runner/stream`, {
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
        // closed
      }
    })();

    await new Promise((r) => setTimeout(r, 200));

    // Launch a run with single breakpoint and 1 maxPage so it finishes quickly
    const runRes = await fetch(`${runnerBase}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: `${fixtureBase}/about`,
        skipReview: true,
        maxPages: 1,
        breakpoints: ['1440px'],
        owner: true,
        signInConsent: true,
        roles: [
          {
            role: 'manager',
            username: 'manager@example.com',
            password: 'manager-password',
            loginPath: '/signin',
          },
        ],
        customHeaders: {
          'x-qa-bypass-token': 'runner-bypass-test-token',
        },
      }),
    });

    expect(runRes.status).toBe(202);
    const { runId } = await runRes.json();
    expect(runId).toBeTruthy();

    // Poll until run completes
    let isRunning = true;
    for (let i = 0; i < 300 && isRunning; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const statusRes = await fetch(`${runnerBase}/api/runner/status`);
      const status = await statusRes.json();
      isRunning = status.isRunning;
    }
    expect(isRunning).toBe(false);

    streamController.abort();
    await pump;

    // Check DISCOVERY_PROGRESS events
    const progressEvents = events.filter((e) => e.type === 'DISCOVERY_PROGRESS');
    expect(progressEvents.length).toBeGreaterThan(0);
    // Assert optional fields
    const withOptional = progressEvents.find((e) => e.pagesVisited !== undefined || e.pagesFound !== undefined);
    expect(withOptional).toBeTruthy();

    // Check /api/report
    const reportRes = await fetch(`${runnerBase}/api/report`);
    expect(reportRes.status).toBe(200);
    const report = await reportRes.json();

    expect(report.runId).toBe(runId);
    expect(report.pageCoverage).toBeTruthy();
    expect(report.pageCoverage.reached).toBeGreaterThan(0);
    expect(Array.isArray(report.pageCoverage.skipped)).toBe(true);
  }, 120000);

  // T-309: the same crawl through the runner finishes, and the report's page coverage carries the
  // signed-in area — including the page that only shows a password field (LC-002), which must not be
  // dropped as a sign-in wall.
  it(
    'runs the fixture signed in and reports the covered pages',
    async () => {
      const runRes = await fetch(`${runnerBase}/api/runner/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: `${fixtureBase}/account`,
          skipReview: true,
          // Enough pages to reach /account/security (the seventh the signed-in crawl visits), and no more: every page
          // adds planned tests, and the run times out on a shared runner otherwise.
          maxPages: 10,
          breakpoints: ['1440px'],
          owner: true,
          signInConsent: true,
          roles: [
            {
              role: 'manager',
              username: 'manager@example.com',
              password: 'manager-password',
              loginPath: '/signin',
            },
          ],
        }),
      });
      expect(runRes.status).toBe(202);

      // A full run (crawl, then every planned test as the signed-in role) takes about 7 minutes on a shared runner
      // and more than 10 minutes on the developer's 4-core laptop with the repository inside OneDrive (EV-0006).
      // The report's page coverage only exists once the whole run has finished. Budget agreed with the developer
      // (2026-10-31): about 25 minutes for the run, with no cap on the number of test points.
      const runDeadline = Date.now() + 24 * 60_000;
      let isRunning = true;
      while (isRunning && Date.now() < runDeadline) {
        await new Promise((r) => setTimeout(r, 500));
        const status = await (await fetch(`${runnerBase}/api/runner/status`)).json();
        isRunning = status.isRunning;
      }
      expect(isRunning).toBe(false);

      const report = await (await fetch(`${runnerBase}/api/report`)).json();
      expect(report.pageCoverage.reached).toBeGreaterThan(0);
      const skippedPaths = (report.pageCoverage.skipped ?? []).map((s: { urlPath: string }) => s.urlPath);
      // A page with a password field that is not the sign-in page is reached, not skipped as a wall.
      expect(skippedPaths).not.toContain('/account/security');
      // 25 minutes: the 24-minute run budget above plus the report fetch (see the comment at the poll loop).
    },
    25 * 60_000
  );

  it('asserts RUN_FAILED event carries signInReason when credentials fail under consent', async () => {
    const events: any[] = [];
    const streamController = new AbortController();
    const streamRes = await fetch(`${runnerBase}/api/runner/stream`, {
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
        // closed
      }
    })();

    await new Promise((r) => setTimeout(r, 200));

    // Wrong password under consent
    const runRes = await fetch(`${runnerBase}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: `${fixtureBase}/`,
        skipReview: true,
        maxPages: 3,
        breakpoints: ['1440px'],
        owner: true,
        signInConsent: true,
        roles: [
          {
            role: 'manager',
            username: 'manager@example.com',
            password: 'wrong-password-here',
            loginPath: '/signin',
          },
        ],
      }),
    });

    expect(runRes.status).toBe(202);

    // Poll until run completes or fails
    let isRunning = true;
    for (let i = 0; i < 100 && isRunning; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const statusRes = await fetch(`${runnerBase}/api/runner/status`);
      const status = await statusRes.json();
      isRunning = status.isRunning;
    }
    expect(isRunning).toBe(false);

    streamController.abort();
    await pump;

    const failedEvent = events.find((e) => e.type === 'RUN_FAILED');
    expect(failedEvent).toBeTruthy();
    expect(failedEvent.signInReason).toBe('wrong-details');
  }, 90000);
});
