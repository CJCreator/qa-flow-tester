import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Route } from 'playwright';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { BrowserManager } from '../src/browser.js';
import type { PreFlightResult } from '../src/preflight.js';
import { findingFingerprint, type ProductProfile, type ReleaseReport, type TestCase } from '@qa/types';

// Test lanes (ADR 0046): a Test Copy run with two Roles gives the same report with a pool of 1 and of 2.
const TARGET = 'http://test.local';
const PRODUCT = 'test-lanes';

/** A stored sign-in state per Role: a cookie the Role's pages need before they show their button. */
const session = (who: string) => ({
  cookies: [
    { name: 'who', value: who, domain: 'test.local', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
  ],
  origins: [],
});

// A fresh object per run: a re-sign-in would write into roleStorageStates.
const preflightFor = () =>
  ({
    ok: true,
    url: TARGET,
    roleAuthResults: { admin: true, member: true },
    roleStorageStates: { admin: session('admin'), member: session('member') },
    roleLandingPaths: { admin: '/a/home', member: '/b/home' },
    roleFailures: {},
    roleDiagnostics: {},
    // A partial fixture: the paths under test never read the fields left out.
  }) as PreFlightResult;

const tc = (id: string, role: string, startPage: string, steps: TestCase['steps']): TestCase => ({
  id,
  flowId: `flow-${id}`,
  name: `Test ${id}`,
  role,
  startPage,
  kind: 'page-test',
  steps,
  expectations: {},
});

// Roles interleaved in Plan order, so lanes that finish out of order would show in the results.
const PLAN: TestCase[] = [
  tc('TC-A1', 'admin', '/a/broken', [{ action: 'wait', name: 'Wait' }]),
  tc('TC-B1', 'member', '/b/broken', [{ action: 'wait', name: 'Wait' }]),
  tc('TC-A2', 'admin', '/a/home', [{ action: 'click', selector: '#go-admin', name: 'Continue as admin' }]),
  tc('TC-B2', 'member', '/b/home', [{ action: 'click', selector: '#go-member', name: 'Continue as member' }]),
];

const pageHtml = (title: string, extra: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>${title}</h1></main>${extra}</body></html>`;

describe('test lanes: pool of 1 and pool of 2 give the same report', () => {
  let tmpDir: string | undefined;
  const origCreateContext = BrowserManager.prototype.createContext;

  const serve = async (route: Route) => {
    const p = new URL(route.request().url()).pathname;
    const who = p.startsWith('/a/') ? 'admin' : p.startsWith('/b/') ? 'member' : '';
    // The admin pages answer later, so the admin lane is the slower one.
    if (who === 'admin') await new Promise((r) => setTimeout(r, 150));
    const gate = who
      ? `<script>if (document.cookie.includes('who=${who}')) document.querySelector('main').insertAdjacentHTML('beforeend', '<button id="go-${who}">Continue</button>')</script>`
      : '';
    // The visible result per Role: a console error on its own page, a bug-detection finding.
    const broken = p.endsWith('/broken') ? `<script>console.error('${who} widget broke')</script>` : '';
    await route.fulfill({ status: 200, contentType: 'text/html', body: pageHtml(`Page ${p}`, gate + broken) });
  };

  beforeEach(() => {
    vi.spyOn(BrowserManager.prototype, 'createContext').mockImplementation(async function (
      this: BrowserManager,
      options
    ) {
      const context = await origCreateContext.call(this, options);
      await context.route('**/*', serve);
      return context;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      tmpDir = undefined;
    }
  });

  const runWith = async (parallelRoles: number): Promise<ReleaseReport> => {
    const dir = path.join(tmpDir!, `pool-${parallelRoles}`);
    await fs.mkdir(dir, { recursive: true });
    const profile: ProductProfile = {
      name: 'Lanes',
      productId: PRODUCT,
      roles: [
        { role: 'admin', username: 'lane-admin-user@test.local', loginPath: '/login' },
        { role: 'member', username: 'lane-member-user@test.local', loginPath: '/login' },
      ],
      visualBaselineDir: path.join(dir, 'baselines'),
    };
    return new FlowTestOrchestrator().run({
      targetUrl: TARGET,
      productId: PRODUCT,
      specTestCases: PLAN,
      profile,
      preflight: preflightFor(),
      outputDir: dir,
      dataDir: path.join(dir, 'data'),
      testCopy: true,
      parallelRoles,
      breakpoints: ['1440px'],
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
      recordVideo: false,
      flakyReruns: 0,
      stepTimeoutMs: 3000,
    });
  };

  const fingerprints = (report: ReleaseReport) =>
    [...new Set(report.findings.map((f) => f.fingerprint ?? findingFingerprint(f, report.productId)))].sort();
  const statuses = (report: ReleaseReport) => Object.fromEntries(report.results.map((r) => [r.testCaseId, r.status]));

  it('same fingerprints, same status per test, results in Plan order', { timeout: 60_000 }, async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-lanes-'));

    const serial = await runWith(1);
    const parallel = await runWith(2);

    // Pinned, so two runs that both went wrong the same way cannot pass.
    const expectedStatus = { 'TC-A1': 'Failed', 'TC-B1': 'Failed', 'TC-A2': 'Passed', 'TC-B2': 'Passed' };
    const planOrder = PLAN.map((t) => t.id);
    expect(statuses(serial)).toEqual(expectedStatus);
    expect(serial.results.map((r) => r.testCaseId)).toEqual(planOrder);
    for (const role of ['admin', 'member']) {
      expect(serial.findings.some((f) => f.where.role === role && f.checker === 'bug-detection')).toBe(true);
    }
    expect(fingerprints(serial).length).toBeGreaterThanOrEqual(2);

    // The pool of 2 completes and reports exactly what the pool of 1 did.
    expect(parallel.partial).toBeUndefined();
    expect(parallel.results.map((r) => r.testCaseId)).toEqual(planOrder);
    expect(statuses(parallel)).toEqual(statuses(serial));
    expect(fingerprints(parallel)).toEqual(fingerprints(serial));
    expect(parallel.grades?.overallGrade).toEqual(serial.grades?.overallGrade);
  });
});
