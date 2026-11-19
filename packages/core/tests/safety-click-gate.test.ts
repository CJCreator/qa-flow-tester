import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Route } from 'playwright';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { BrowserManager } from '../src/browser.js';
import type { PreFlightResult } from '../src/preflight.js';
import { SENSITIVE_PAUSED } from '../src/discovery/click-gate.js';
import type { TestCase } from '@qa/types';

// T-421: the Safety Filter at click time. Pages are routed (ADR 0040): no real site is reached.
describe('click-time Sensitive Action gate (T-421)', () => {
  let tmpDir: string | undefined;
  const origCreateContext = BrowserManager.prototype.createContext;
  const posts: string[] = [];

  const preflight = {
    ok: true,
    roleAuthResults: {},
    roleStorageStates: {},
    roleLandingPaths: {},
    roleFailures: {},
    roleDiagnostics: {},
  } as PreFlightResult;

  const page = (label: string, action: string) =>
    `<!doctype html><html><head><title>Account</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Account</h1>
     <button id="act" onclick="fetch('/${action}', { method: 'POST', body: 'x' })">${label}</button>
     </main></body></html>`;

  let body = '';

  beforeEach(() => {
    posts.length = 0;
    vi.spyOn(BrowserManager.prototype, 'createContext').mockImplementation(async function (
      this: BrowserManager,
      options
    ) {
      const context = await origCreateContext.call(this, options);
      await context.route('**/*', async (route: Route) => {
        const req = route.request();
        if (req.method() === 'POST') {
          posts.push(new URL(req.url()).pathname);
          await route.fulfill({ status: 204, body: '' });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body });
      });
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

  const testCase = (stepName: string, approved?: boolean): TestCase => ({
    id: 'TC-GATE',
    flowId: 'flow-gate',
    name: 'Account button',
    role: 'visitor',
    startPage: '/account',
    kind: 'page-test',
    steps: [
      {
        action: 'click',
        selector: '#act',
        name: stepName,
        ...(approved ? { sensitiveApproved: true } : {}),
      },
    ],
    expectations: {},
  });

  const run = async (tc: TestCase, readOnly = false) => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safety-click-gate-'));
    return new FlowTestOrchestrator().run({
      targetUrl: 'http://test.local',
      productId: 'gate',
      specTestCases: [tc],
      preflight,
      outputDir: tmpDir,
      breakpoints: ['1440px'],
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
      recordVideo: false,
      readOnly,
      testCopy: !readOnly,
    });
  };

  it('a "Delete account" click is not done: the step is skipped with the reason and a run note', async () => {
    body = page('Delete account', 'deleted');
    // The Plan's own name for the step is harmless: the gate reads the live element.
    const report = await run(testCase('Click the account button'));
    expect(posts).toEqual([]);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe('Skipped');
    expect(report.results[0].skipReason).toContain(SENSITIVE_PAUSED);
    expect((report.notes ?? []).join('\n')).toContain(SENSITIVE_PAUSED);
  }, 60_000);

  it('the same item, approved in Plan Review on a Test Copy, is clicked', async () => {
    body = page('Delete account', 'deleted');
    const report = await run(testCase('Click “Delete account”', true));
    expect(posts).toEqual(['/deleted']);
    expect(report.results[0].status).not.toBe('Skipped');
  }, 60_000);

  it('an approval does not count on a run that is not a Test Copy', async () => {
    body = page('Delete account', 'deleted');
    const report = await run(testCase('Click “Delete account”', true), true);
    expect(report.results[0].status).toBe('Skipped');
    expect(report.results[0].skipReason).toContain(SENSITIVE_PAUSED);
  }, 60_000);

  it('a "Save" button is clicked as before', async () => {
    body = page('Save', 'saved');
    const report = await run(testCase('Click “Save”'));
    expect(posts).toEqual(['/saved']);
    expect(report.results[0].status).toBe('Passed');
  }, 60_000);
});
