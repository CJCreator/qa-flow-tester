import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import os from 'os';
import { promises as fs, mkdtempSync } from 'fs';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { PreFlightChecker, SignInFailedError, type PreFlightResult } from '../src/preflight.js';
import { BrowserManager } from '../src/browser.js';
import { PermissionMatrixChecker } from '@qa/checkers';
import type { TestCase, ProductProfile } from '@qa/types';

describe('Orchestrator session awareness (T-114)', () => {
  let port: number;
  let fixtureUrl: string;
  // A new folder per run, outside the repository: inside OneDrive the sync client picks up every file a run
  // writes, competes with Chromium for the CPU and holds files open so the clean-up fails.
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'qa-test-orchestrator-session-'));

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      fixtureServer.listen(0, () => {
        const addr = fixtureServer.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
          fixtureUrl = `http://localhost:${port}`;
        }
        resolve();
      });
    });
    await fs.mkdir(outputDir, { recursive: true });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  });

  const testProfile: ProductProfile = {
    name: 'Fixture App',
    productId: 'fixture-app',
    roles: [
      {
        role: 'manager',
        username: 'manager@example.com',
        password: 'manager-password',
        loginPath: '/signin',
        postLoginUrl: '/account',
      },
    ],
  };

  const testFor = (id: string, startPage: string, role = 'manager'): TestCase => ({
    id,
    requirementId: `REQ-${id}`,
    flowId: `flow-${id}`,
    name: `Test for ${startPage}`,
    role,
    startPage,
    steps: [{ action: 'wait', name: 'Wait for page load' }],
    expectations: {},
  });

  it('with preflight supplied and valid, stats.signIns stays 0 from the run itself (no second sign-in)', async () => {
    // 1. Initial sign-in via preflight checker with browserManager
    const authDir = path.join(outputDir, 'auth-preflight');
    const browserManager = new BrowserManager();
    const preflightChecker = new PreFlightChecker();
    let preflight: PreFlightResult;
    try {
      preflight = await preflightChecker.runPreFlight(fixtureUrl, testProfile, undefined, {
        browserManager,
        authDir,
      });
    } finally {
      await browserManager.close().catch(() => {});
    }
    expect(preflight.ok).toBe(true);

    // 2. Reset server stats
    await fetch(`${fixtureUrl}/lab/reset`, { method: 'POST' });
    const statsBefore = await (await fetch(`${fixtureUrl}/lab/stats`)).json();
    expect(statsBefore.signIns).toBe(0);

    // 3. Run orchestrator passing preflight
    const orchestrator = new FlowTestOrchestrator();
    const report = await orchestrator.run({
      targetUrl: fixtureUrl,
      productId: 'fixture-app',
      specTestCases: [testFor('TC-1', '/account')],
      profile: testProfile,
      preflight,
      authDir,
      outputDir: path.join(outputDir, 'run-preflight'),
      breakpoints: ['1440px'],
      enableA11y: false,
      recordVideo: false,
    });

    // 4. Verify no second sign-in occurred during run
    const statsAfter = await (await fetch(`${fixtureUrl}/lab/stats`)).json();
    expect(statsAfter.signIns).toBe(0);
    const tc1 = report.results.find((r) => r.testCaseId === 'TC-1');
    expect(tc1?.status).not.toBe('Skipped');
  });

  it('/lab/expiring: signed-in point after session died is Skipped and attempts 1 re-login (stats.signIns = 2)', async () => {
    delete process.env.QA_RELOGIN;
    await fetch(`${fixtureUrl}/lab/reset`, { method: 'POST' });

    const authDir = path.join(outputDir, 'auth-expiring');
    const orchestrator = new FlowTestOrchestrator();

    // Set max requests to 1 before expiration
    await fetch(`${fixtureUrl}/lab/expiring/start?n=1`, { method: 'POST' });

    // Run 3 test cases: TC-EXP-1 loads /lab/expiring (request 1, ok).
    // TC-EXP-2 loads /lab/expiring (request 2, expires -> bounces to /signin).
    // Re-login is attempted (stats.signIns becomes 2).
    // In TC-EXP-2 retry, /lab/expiring is requested (request 1 of new session, ok).
    // Then TC-EXP-3 loads /lab/expiring (request 2 -> expires again).
    // Since re-login was already used, TC-EXP-3 is skipped with 'Signed out part-way: the session stopped working'.
    const report = await orchestrator.run({
      targetUrl: fixtureUrl,
      productId: 'fixture-app',
      specTestCases: [
        testFor('TC-EXP-1', '/lab/expiring'),
        testFor('TC-EXP-2', '/lab/expiring'),
        testFor('TC-EXP-3', '/lab/expiring'),
      ],
      profile: testProfile,
      authDir,
      outputDir: path.join(outputDir, 'run-expiring'),
      breakpoints: ['1440px'],
      enableA11y: false,
      recordVideo: false,
    });

    const stats = await (await fetch(`${fixtureUrl}/lab/stats`)).json();
    expect(stats.signIns).toBe(2);

    const tc3 = report.results.find((r) => r.testCaseId === 'TC-EXP-3');
    expect(tc3?.status).toBe('Skipped');
    expect(tc3?.skipReason).toBe('Signed out part-way: the session stopped working');
  });

  it('QA_RELOGIN=0: no re-login attempted, points skipped', async () => {
    process.env.QA_RELOGIN = '0';
    try {
      await fetch(`${fixtureUrl}/lab/reset`, { method: 'POST' });
      await fetch(`${fixtureUrl}/lab/expiring/start?n=1`, { method: 'POST' });

      const authDir = path.join(outputDir, 'auth-no-relogin');
      const orchestrator = new FlowTestOrchestrator();

      const report = await orchestrator.run({
        targetUrl: fixtureUrl,
        productId: 'fixture-app',
        specTestCases: [testFor('TC-NOREL-1', '/lab/expiring'), testFor('TC-NOREL-2', '/lab/expiring')],
        profile: testProfile,
        authDir,
        outputDir: path.join(outputDir, 'run-no-relogin'),
        breakpoints: ['1440px'],
        enableA11y: false,
        recordVideo: false,
      });

      const stats = await (await fetch(`${fixtureUrl}/lab/stats`)).json();
      expect(stats.signIns).toBe(1); // Only initial preflight sign-in

      const tc2 = report.results.find((r) => r.testCaseId === 'TC-NOREL-2');
      expect(tc2?.status).toBe('Skipped');
      expect(tc2?.skipReason).toBe('Signed out part-way: the session stopped working');
    } finally {
      delete process.env.QA_RELOGIN;
    }
  });

  it('under requireSignIn a lost session throws SignInFailedError with reason session-expired', async () => {
    process.env.QA_RELOGIN = '0';
    try {
      await fetch(`${fixtureUrl}/lab/reset`, { method: 'POST' });
      await fetch(`${fixtureUrl}/lab/expiring/start?n=1`, { method: 'POST' });

      const authDir = path.join(outputDir, 'auth-require-sign-in');
      const orchestrator = new FlowTestOrchestrator();

      await expect(
        orchestrator.run({
          targetUrl: fixtureUrl,
          productId: 'fixture-app',
          specTestCases: [testFor('TC-REQ-1', '/lab/expiring'), testFor('TC-REQ-2', '/lab/expiring')],
          profile: testProfile,
          authDir,
          outputDir: path.join(outputDir, 'run-require-sign-in'),
          breakpoints: ['1440px'],
          enableA11y: false,
          recordVideo: false,
          requireSignIn: true,
        })
      ).rejects.toThrowError(SignInFailedError);
    } finally {
      delete process.env.QA_RELOGIN;
    }
  });

  it('/lab/forbidden as a role with an expected-denied rule: Permission Matrix receives status 403', async () => {
    await fetch(`${fixtureUrl}/lab/reset`, { method: 'POST' });

    // The rule the CSV `Target,manager\n/lab/forbidden,deny` parses to: the profile holds a parsed matrix.
    const profileWithMatrix: ProductProfile = {
      ...testProfile,
      permissionMatrix: [{ target: '/lab/forbidden', roles: { manager: 'deny' } }],
    };

    const spy = vi.spyOn(PermissionMatrixChecker.prototype, 'checkAccess');
    try {
      const authDir = path.join(outputDir, 'auth-perm');
      const orchestrator = new FlowTestOrchestrator();

      await orchestrator.run({
        targetUrl: fixtureUrl,
        productId: 'fixture-app',
        specTestCases: [testFor('TC-PERM-1', '/lab/forbidden')],
        profile: profileWithMatrix,
        authDir,
        outputDir: path.join(outputDir, 'run-perm'),
        breakpoints: ['1440px'],
        enableA11y: false,
        recordVideo: false,
      });

      expect(spy).toHaveBeenCalled();
      const lastCall = spy.mock.calls.find((c) => c[0].target === '/lab/forbidden');
      expect(lastCall).toBeDefined();
      expect(lastCall![0].statusCode).toBe(403);
      expect(lastCall![0].redirectedToLogin).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('G-008: when session expired, points are not run or passed against the login page', async () => {
    process.env.QA_RELOGIN = '0';
    try {
      await fetch(`${fixtureUrl}/lab/reset`, { method: 'POST' });
      await fetch(`${fixtureUrl}/lab/expiring/start?n=1`, { method: 'POST' });

      const authDir = path.join(outputDir, 'auth-g008');
      const orchestrator = new FlowTestOrchestrator();

      // TC-G-2 has a step that would pass if run on /signin (e.g. input exists)
      const tc2: TestCase = {
        id: 'TC-G-2',
        requirementId: 'REQ-G-2',
        flowId: 'flow-g-2',
        name: 'Expect protected content',
        role: 'manager',
        startPage: '/lab/expiring',
        steps: [{ action: 'wait', name: 'Look around' }],
        expectations: {},
      };

      const report = await orchestrator.run({
        targetUrl: fixtureUrl,
        productId: 'fixture-app',
        specTestCases: [testFor('TC-G-1', '/lab/expiring'), tc2],
        profile: testProfile,
        authDir,
        outputDir: path.join(outputDir, 'run-g008'),
        breakpoints: ['1440px'],
        enableA11y: false,
        recordVideo: false,
      });

      const r2 = report.results.find((r) => r.testCaseId === 'TC-G-2')!;
      expect(r2.status).toBe('Skipped');
      expect(r2.status).not.toBe('Passed');
      expect(r2.skipReason).toBe('Signed out part-way: the session stopped working');
    } finally {
      delete process.env.QA_RELOGIN;
    }
  });
});
