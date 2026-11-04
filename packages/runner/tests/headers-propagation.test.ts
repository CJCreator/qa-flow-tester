import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { promises as fs, mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

describe('headers propagation & per-run auth isolation', () => {
  const FIXTURE_PORT = 3620;
  const RUNNER_PORT = 3621;
  const fixtureUrl = `http://localhost:${FIXTURE_PORT}`;
  const runnerUrl = `http://localhost:${RUNNER_PORT}`;
  // A new folder per run, outside the repository: inside OneDrive the sync client picks up every file a run
  // writes, competes with Chromium for the CPU and holds files open so the clean-up fails.
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'qa-test-headers-propagation-'));
  const outputDir = path.join(scratch, 'report');
  const dataDir = `${outputDir}-data`;
  const authDir = `${outputDir}-auth`;
  const BYPASS_TOKEN = 'bypass-secret-test-token-777';

  let runner: RunnerServer;

  beforeAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(authDir, { recursive: true, force: true }).catch(() => {});

    await new Promise<void>((resolve) => fixtureServer.listen(FIXTURE_PORT, () => resolve()));
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir,
      authDir,
    });
    await runner.start();
  });

  afterAll(async () => {
    await runner.stop();
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  });

  // A test that fails or times out must not leave its run going: the next test's start would be refused (one
  // run at a time) and it would fail for a reason that is not its own.
  afterEach(async ({ task }) => {
    if (task.result?.state !== 'fail') return;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await (await fetch(`${runnerUrl}/api/runner/status`)).json()).isRunning) break;
        await fetch(`${runnerUrl}/api/runner/abort`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ discard: true }),
        });
      }
    } catch {
      // Runner not reachable: nothing to stop.
    }
  }, 30000);

  it('rejects invalid roles and cross-origin loginPath with 400', async () => {
    // Empty role name
    const res1 = await fetch(`${runnerUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: fixtureUrl,
        roles: [{ role: '' }],
      }),
    });
    expect(res1.status).toBe(400);
    const json1 = await res1.json();
    expect(json1.code).toBe('ERR_INVALID_ROLES');

    // Duplicate role names
    const res2 = await fetch(`${runnerUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: fixtureUrl,
        roles: [
          { role: 'admin', username: 'admin' },
          { role: 'admin', username: 'admin2' },
        ],
      }),
    });
    expect(res2.status).toBe(400);
    const json2 = await res2.json();
    expect(json2.code).toBe('ERR_INVALID_ROLES');

    // Cross-origin loginPath
    const res3 = await fetch(`${runnerUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: fixtureUrl,
        roles: [{ role: 'admin', username: 'admin', loginPath: 'https://evil.com/login' }],
      }),
    });
    expect(res3.status).toBe(400);
    const json3 = await res3.json();
    expect(json3.code).toBe('ERR_INVALID_LOGIN_PATH');
  });

  it('propagates custom headers across sign-in, discovery, and test phases, cleanly cleans authDir, and leaks zero secrets', async () => {
    // Reset lab stats on fixture
    await fetch(`${fixtureUrl}/lab/stats/reset`, { method: 'POST' });

    // Trigger run with custom bypass header and sign-in credentials
    const triggerRes = await fetch(`${runnerUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: fixtureUrl,
        owner: true,
        signInConsent: true,
        roles: [
          {
            role: 'admin',
            username: 'admin@example.com',
            password: 'admin-password',
            loginPath: '/signin',
          },
        ],
        customHeaders: {
          'x-qa-bypass-token': BYPASS_TOKEN,
        },
        breakpoints: ['1440px'],
        mode: 'product',
        maxPages: 1,
        testCap: 2,
        skipReview: true,
        replacePlan: true,
        useAI: false,
      }),
    });

    expect(triggerRes.status).toBe(202);
    const { runId } = await triggerRes.json();
    expect(runId).toBeTruthy();

    // Poll until run completes
    let phase = 'scanning';
    for (let i = 0; i < 240; i++) {
      const statusRes = await (await fetch(`${runnerUrl}/api/runner/status`)).json();
      phase = statusRes.phase;
      if (phase === 'done' || phase === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(phase).toBe('done');

    // Verify /lab/stats recorded header hits across routes
    const statsRes = await (await fetch(`${fixtureUrl}/lab/stats`)).json();
    expect(statsRes.headerHits).toBeDefined();
    // Verify sign-in page received header
    expect(statsRes.headerHits['/signin'] ?? 0).toBeGreaterThanOrEqual(1);
    // Verify home page or account page received header
    expect(statsRes.headerHits['/'] ?? 0).toBeGreaterThanOrEqual(1);

    // Verify per-run auth directory was cleaned up and does not linger
    const runAuthFolder = runner.runAuthDir(runId);
    const authDirExists = await fs.stat(runAuthFolder).then(
      () => true,
      () => false
    );
    expect(authDirExists).toBe(false);

    // Verify zero secret leak in run directory
    async function walk(dir: string): Promise<string[]> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      const files = await Promise.all(
        entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : Promise.resolve([path.join(dir, e.name)])))
      );
      return files.flat();
    }

    const runDir = path.join(outputDir, 'runs', runId);
    const allFiles = await walk(runDir);
    expect(allFiles.length).toBeGreaterThan(0);

    for (const f of allFiles) {
      if (f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')) continue;
      const content = await fs.readFile(f, 'utf8').catch(() => '');
      expect(content).not.toContain(BYPASS_TOKEN);
      expect(content).not.toContain('admin-password');
    }
  }, 180000);

  it('omits headers from disk plan and requires re-approval with ERR_HEADERS_NOT_SAVED after restart', async () => {
    // Start run with skipReview: false
    const triggerRes = await fetch(`${runnerUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: fixtureUrl,
        owner: true,
        customHeaders: {
          'x-qa-bypass-token': BYPASS_TOKEN,
        },
        breakpoints: ['1440px'],
        mode: 'product',
        maxPages: 1,
        testCap: 2,
        skipReview: false,
        replacePlan: true,
        useAI: false,
      }),
    });

    expect(triggerRes.status).toBe(202);
    const { runId } = await triggerRes.json();

    // Wait for awaiting-review
    let phase = 'scanning';
    for (let i = 0; i < 80; i++) {
      const statusRes = await (await fetch(`${runnerUrl}/api/runner/status`)).json();
      phase = statusRes.phase;
      if (phase === 'awaiting-review' || phase === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(phase).toBe('awaiting-review');

    // Verify .qa-plan.json exists on disk
    const planFile = path.join(dataDir, '.qa-plan.json');
    const planContent = JSON.parse(await fs.readFile(planFile, 'utf8'));

    // customHeaders must be omitted on disk
    expect(planContent.context.customHeaders).toBeUndefined();
    // customHeaderNames must record the names
    expect(planContent.context.customHeaderNames).toContain('x-qa-bypass-token');
    // raw header value must not appear anywhere in .qa-plan.json
    expect(JSON.stringify(planContent)).not.toContain(BYPASS_TOKEN);

    // Stop runner and start a new instance (simulated restart)
    await runner.stop();

    const restartedRunner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir,
      authDir,
    });
    await restartedRunner.start();
    runner = restartedRunner;

    // Approve plan without sending customHeaders
    const approveMissing = await fetch(`${runnerUrl}/api/runner/plan/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(approveMissing.status).toBe(409);
    const errMissing = await approveMissing.json();
    expect(errMissing.code).toBe('ERR_HEADERS_NOT_SAVED');
    expect(errMissing.needsHeaders).toContain('x-qa-bypass-token');

    // Approve plan providing customHeaders
    const approveOk = await fetch(`${runnerUrl}/api/runner/plan/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customHeaders: {
          'x-qa-bypass-token': BYPASS_TOKEN,
        },
      }),
    });
    expect(approveOk.status).toBe(200);

    // Wait for testing to finish
    phase = 'testing';
    for (let i = 0; i < 240; i++) {
      const statusRes = await (await fetch(`${runnerUrl}/api/runner/status`)).json();
      phase = statusRes.phase;
      if (phase === 'done' || phase === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(phase).toBe('done');

    // Verify authDir/<runId> is cleaned up after testing finishes
    const runAuthFolder = runner.runAuthDir(runId);
    const authDirExists = await fs.stat(runAuthFolder).then(
      () => true,
      () => false
    );
    expect(authDirExists).toBe(false);
  }, 180000);
});
