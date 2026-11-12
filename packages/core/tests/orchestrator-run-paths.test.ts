import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Route } from 'playwright';
import { FlowTestOrchestrator, type OrchestratorEvent } from '../src/orchestrator.js';
import { BrowserManager } from '../src/browser.js';
import type { PreFlightResult } from '../src/preflight.js';
import type { TestCase } from '@qa/types';

describe('orchestrator run paths', () => {
  let tmpDir: string | undefined;
  const origCreateContext = BrowserManager.prototype.createContext;
  let currentRouteHandler: ((route: Route) => Promise<void> | void) | undefined;

  const preflight = {
    ok: true,
    roleAuthResults: {},
    roleStorageStates: {},
    roleLandingPaths: {},
    roleFailures: {},
    roleDiagnostics: {},
    // A partial fixture: the orchestrator paths under test never read the fields left out.
  } as PreFlightResult;

  beforeEach(() => {
    currentRouteHandler = undefined;
    vi.spyOn(BrowserManager.prototype, 'createContext').mockImplementation(async function (
      this: BrowserManager,
      options
    ) {
      const context = await origCreateContext.call(this, options);
      await context.route('**/*', async (route) => {
        if (currentRouteHandler) {
          await currentRouteHandler(route);
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><head><title>Default</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Default</h1></main></body></html>',
          });
        }
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

  it('Stop: abort options.signal after the first test starts; run ends, report has no unrun test marked as passed, BrowserManager.prototype.close called', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-run-paths-stop-'));
    const closeSpy = vi.spyOn(BrowserManager.prototype, 'close');

    const tc1: TestCase = {
      id: 'TC-1',
      flowId: 'flow-1',
      name: 'First Test',
      role: 'visitor',
      startPage: '/page-1',
      kind: 'page-test',
      steps: [{ action: 'wait', name: 'Wait a bit' }],
      expectations: {},
    };
    const tc2: TestCase = {
      id: 'TC-2',
      flowId: 'flow-2',
      name: 'Second Test',
      role: 'visitor',
      startPage: '/page-2',
      kind: 'page-test',
      steps: [{ action: 'wait', name: 'Wait a bit' }],
      expectations: {},
    };

    const abortController = new AbortController();
    const seenEvents: OrchestratorEvent[] = [];

    currentRouteHandler = async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Test Page</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Page</h1></main></body></html>',
      });
    };

    const orchestrator = new FlowTestOrchestrator();
    await expect(
      orchestrator.run({
        targetUrl: 'http://test.local',
        productId: 'test-stop',
        specTestCases: [tc1, tc2],
        preflight,
        outputDir: tmpDir,
        signal: abortController.signal,
        breakpoints: ['1440px'],
        enableA11y: false,
        enablePerformance: false,
        enableSecurity: false,
        enableSeo: false,
        searchChecks: false,
        recordVideo: false,
        onEvent: (event) => {
          seenEvents.push(event);
          if (event.type === 'TEST_POINT_STARTED' && event.testCaseId === 'TC-1') {
            abortController.abort();
          }
        },
      })
    ).rejects.toThrow();

    expect(closeSpy).toHaveBeenCalled();
    const unrunPassed = seenEvents.filter((e) => e.type === 'STEP_COMPLETED' && e.testCaseId === 'TC-2' && e.passed);
    expect(unrunPassed).toHaveLength(0);
  });

  it('Make a report: abort options.finishSignal after first test; report is partial and keeps first test result', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-run-paths-finish-'));

    const tc1: TestCase = {
      id: 'TC-1',
      flowId: 'flow-1',
      name: 'First Test',
      role: 'visitor',
      startPage: '/page-1',
      kind: 'page-test',
      steps: [{ action: 'wait', name: 'Wait' }],
      expectations: {},
    };
    const tc2: TestCase = {
      id: 'TC-2',
      flowId: 'flow-2',
      name: 'Second Test',
      role: 'visitor',
      startPage: '/page-2',
      kind: 'page-test',
      steps: [{ action: 'wait', name: 'Wait' }],
      expectations: {},
    };

    const finishController = new AbortController();

    currentRouteHandler = async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Test Page</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Page</h1></main></body></html>',
      });
    };

    const orchestrator = new FlowTestOrchestrator();
    const report = await orchestrator.run({
      targetUrl: 'http://test.local',
      productId: 'test-finish',
      specTestCases: [tc1, tc2],
      preflight,
      outputDir: tmpDir,
      finishSignal: finishController.signal,
      breakpoints: ['1440px'],
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
      recordVideo: false,
      onEvent: (event) => {
        if (event.type === 'FINDINGS_UPDATED') {
          finishController.abort();
        }
      },
    });

    expect(report.partial).toBeDefined();
    expect(report.partial?.done).toBe(1);
    expect(report.partial?.planned).toBe(2);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].testCaseId).toBe('TC-1');
    expect(report.results[0].status).toBe('Passed');
  });

  it('Flaky: test whose first attempt fails and second passes is reported as flaky, not failed (flakyReruns: 1)', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-run-paths-flaky-'));

    const tc: TestCase = {
      id: 'TC-FLAKY',
      flowId: 'flow-flaky',
      name: 'Flaky Flow',
      role: 'visitor',
      startPage: '/flaky',
      kind: 'page-test',
      steps: [{ action: 'navigate', value: '/flaky-step', name: 'Flaky navigation step' }],
      expectations: {},
    };

    let flowAttempts = 0;
    currentRouteHandler = async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/flaky') {
        flowAttempts++;
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><title>Flaky Page</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Flaky Start Page</h1></main></body></html>',
        });
      }
      if (url.pathname === '/flaky-step') {
        if (flowAttempts === 1) {
          return route.abort('failed');
        }
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><head><title>Success</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Step Succeeded</h1></main></body></html>',
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>OK</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>OK</h1></main></body></html>',
      });
    };

    const orchestrator = new FlowTestOrchestrator();
    const report = await orchestrator.run({
      targetUrl: 'http://test.local',
      productId: 'test-flaky',
      specTestCases: [tc],
      preflight,
      outputDir: tmpDir,
      flakyReruns: 1,
      breakpoints: ['1440px'],
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
      recordVideo: false,
    });

    expect(flowAttempts).toBe(2);
    expect(report.coverage?.flakyFlows).toBe(1);
    expect(report.coverage?.failed).toBe(0);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe('Passed');
    expect(report.results[0].retry?.status).toBe('FLAKY_PASSED');
  });

  it('Sent form: test that sends a form (route sees POST) and then fails is not retried; route saw exactly one POST', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-run-paths-post-'));

    const tc: TestCase = {
      id: 'TC-POST',
      flowId: 'flow-post',
      name: 'Form Flow',
      role: 'visitor',
      startPage: '/form',
      kind: 'page-test',
      steps: [
        { action: 'click', selector: '#submit-btn', name: 'Submit form' },
        { action: 'navigate', value: '/fail-step', name: 'Fail after send' },
      ],
      expectations: {},
    };

    let postCount = 0;
    currentRouteHandler = async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'POST' && url.pathname === '/api/submit') {
        postCount++;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      }
      if (url.pathname === '/form') {
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><html><body>
            <button id="submit-btn" onclick="fetch('/api/submit', { method: 'POST' })">Submit</button>
          </body></html>`,
        });
      }
      if (url.pathname === '/fail-step') {
        return route.abort('failed');
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><h1>OK</h1></body></html>',
      });
    };

    const orchestrator = new FlowTestOrchestrator();
    const report = await orchestrator.run({
      targetUrl: 'http://test.local',
      productId: 'test-post',
      specTestCases: [tc],
      preflight,
      outputDir: tmpDir,
      flakyReruns: 3,
      breakpoints: ['1440px'],
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
      recordVideo: false,
    });

    expect(postCount).toBe(1);
    expect(report.results).toHaveLength(1);
    expect(report.results[0].status).toBe('Failed');
    expect(report.results[0].retry).toBeUndefined();
    expect(report.results[0].error).toContain('Not tried again: this test already sent a form');
  });

  it('Video: with recordVideo: true, passing test leaves no .webm in evidence folder; failing one keeps one', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-run-paths-video-'));

    const tcPass: TestCase = {
      id: 'TC-PASS-VID',
      flowId: 'flow-pass',
      name: 'Passing Video Test',
      role: 'visitor',
      startPage: '/pass',
      kind: 'page-test',
      steps: [{ action: 'wait', name: 'Wait' }],
      expectations: {},
    };
    const tcFail: TestCase = {
      id: 'TC-FAIL-VID',
      flowId: 'flow-fail',
      name: 'Failing Video Test',
      role: 'visitor',
      startPage: '/fail',
      kind: 'page-test',
      steps: [{ action: 'navigate', value: '/fail-step', name: 'Fail navigation' }],
      expectations: {},
    };

    currentRouteHandler = async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/fail-step') {
        return route.abort('failed');
      }
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Test Page</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Video Page</h1></main></body></html>',
      });
    };

    const orchestrator = new FlowTestOrchestrator();
    const report = await orchestrator.run({
      targetUrl: 'http://test.local',
      productId: 'test-video',
      specTestCases: [tcPass, tcFail],
      preflight,
      outputDir: tmpDir,
      recordVideo: true,
      flakyReruns: 0,
      breakpoints: ['1440px'],
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
    });

    const passEvidenceDir = path.join(tmpDir, 'evidence', 'TC-PASS-VID-1440px');
    const failEvidenceDir = path.join(tmpDir, 'evidence', 'TC-FAIL-VID-1440px');

    const passFiles = await fs.readdir(passEvidenceDir).catch(() => []);
    const passWebmFiles = passFiles.filter((f) => f.endsWith('.webm'));
    expect(passWebmFiles).toHaveLength(0);

    const failFiles = await fs.readdir(failEvidenceDir).catch(() => []);
    const failWebmFiles = failFiles.filter((f) => f.endsWith('.webm'));
    expect(failWebmFiles.length).toBeGreaterThanOrEqual(1);

    const failPoint = report.results.find((t) => t.testCaseId === 'TC-FAIL-VID');
    expect(failPoint?.videoPath).toBeDefined();
    expect(failPoint?.videoPath?.endsWith('.webm')).toBe(true);
  });
});
