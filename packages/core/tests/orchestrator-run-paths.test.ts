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

  it('T-409: by default a test that always fails runs twice, and only the retry records video', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-run-paths-retry-'));
    const tc: TestCase = {
      id: 'TC-ALWAYS-FAILS',
      flowId: 'flow-always-fails',
      name: 'Always Fails',
      role: 'visitor',
      startPage: '/start',
      kind: 'page-test',
      steps: [{ action: 'navigate', value: '/broken', name: 'Broken navigation' }],
      expectations: {},
    };
    let starts = 0;
    currentRouteHandler = async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/broken') return route.abort('failed');
      if (url.pathname === '/start') starts++;
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Start</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>Start</h1></main></body></html>',
      });
    };
    const openPage = vi.spyOn(BrowserManager.prototype, 'openPage');

    const report = await new FlowTestOrchestrator().run({
      targetUrl: 'http://test.local',
      productId: 'test-retry-default',
      specTestCases: [tc],
      preflight,
      outputDir: tmpDir,
      breakpoints: ['1440px'],
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
      // flakyReruns and recordVideo left unset: the defaults are under test.
    });

    expect(starts).toBe(2);
    expect(report.results[0].status).toBe('Failed');
    const videoDirs = openPage.mock.calls.map(([o]) => o?.recordVideoDir);
    expect(videoDirs).toHaveLength(2);
    expect(videoDirs[0]).toBeUndefined();
    expect(videoDirs[1]).toBeDefined();
    expect(report.results[0].videoPath?.endsWith('.webm')).toBe(true);
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

  it("Video: with recordVideo: 'always', passing test leaves no .webm in evidence folder; failing one keeps one", async () => {
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
      recordVideo: 'always',
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

  describe('parallel test workers (T-408, ADR 0048)', () => {
    const quiet = {
      enableA11y: false,
      enablePerformance: false,
      enableSecurity: false,
      enableSeo: false,
      searchChecks: false,
      recordVideo: false,
    } as const;
    const html = (title: string) =>
      `<!doctype html><html><head><title>${title}</title></head><body><header><nav><a href="/">Home</a></nav></header><main><h1>${title}</h1></main></body></html>`;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /** Counts open test contexts, overall and per Role (from the start page /r/<role>/<n>). */
    function watchContexts(onOpen?: (active: number) => void) {
      const seen = new WeakSet<object>();
      const active = new Map<string, number>();
      const most = new Map<string, number>();
      let total = 0;
      let mostTotal = 0;
      const track = (route: Route) => {
        const m = /^\/r\/([^/]+)\//.exec(new URL(route.request().url()).pathname);
        if (!m || !route.request().isNavigationRequest()) return;
        const ctx = route.request().frame().page().context();
        if (seen.has(ctx)) return;
        seen.add(ctx);
        const role = m[1];
        active.set(role, (active.get(role) ?? 0) + 1);
        most.set(role, Math.max(most.get(role) ?? 0, active.get(role)!));
        total++;
        mostTotal = Math.max(mostTotal, total);
        onOpen?.(total);
        ctx.on('close', () => {
          active.set(role, active.get(role)! - 1);
          total--;
        });
      };
      return { track, most, mostTotal: () => mostTotal };
    }

    const cases = (roles: string[], perRole: number, failing = new Set<number>()): TestCase[] =>
      roles.flatMap((role, r) =>
        Array.from({ length: perRole }, (_, n): TestCase => {
          const i = r * perRole + n;
          return {
            id: `TC-${role}-${n}`,
            flowId: `flow-${role}-${n}`,
            name: `${role} ${n}`,
            role,
            startPage: `/r/${role}/${n}`,
            kind: 'page-test',
            steps: [{ action: 'navigate', value: failing.has(i) ? '/broken' : `/ok/${i}`, name: `Step ${i}` }],
            expectations: {},
          };
        })
      );

    const serve = (watch?: ReturnType<typeof watchContexts>) => {
      currentRouteHandler = async (route) => {
        watch?.track(route);
        const url = new URL(route.request().url());
        if (url.pathname === '/broken') return route.abort('failed');
        if (url.pathname.startsWith('/r/')) await sleep(150);
        return route.fulfill({ status: 200, contentType: 'text/html', body: html(url.pathname) });
      };
    };

    it('12 Test points on 4 workers give the same results and findings as 1 worker, and run side by side', async () => {
      const specTestCases = cases(['visitor'], 12, new Set([2, 7, 11]));
      const runWith = async (testWorkers: number) => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `orch-workers-${testWorkers}-`));
        const watch = watchContexts();
        serve(watch);
        const report = await new FlowTestOrchestrator().run({
          targetUrl: 'http://test.local',
          productId: 'test-workers',
          specTestCases,
          preflight,
          outputDir: tmpDir,
          breakpoints: ['1440px'],
          testWorkers,
          ...quiet,
        });
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        tmpDir = undefined;
        return {
          most: watch.mostTotal(),
          results: report.results.map((r) => [r.testCaseId, r.breakpoint, r.status]),
          findings: report.findings.map((f) => [f.testCaseId, f.title, f.severity, f.where.urlPath, f.checker]),
        };
      };
      const one = await runWith(1);
      const four = await runWith(4);
      expect(one.results).toHaveLength(12);
      expect(four.results).toEqual(one.results);
      expect(four.findings).toEqual(one.findings);
      expect(one.findings.length).toBeGreaterThan(0);
      expect(one.most).toBe(1);
      expect(four.most).toBeGreaterThan(1);
    }, 120_000);

    it('Role journeys never overlap: one Role runs on one worker, in Plan order', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-workers-roles-'));
      const watch = watchContexts();
      serve(watch);
      const started: Array<{ role: string; id: string }> = [];
      // Signed-in Roles: each has a (blank) saved session.
      const state = path.join(tmpDir, 'state.json');
      await fs.writeFile(state, JSON.stringify({ cookies: [], origins: [] }), 'utf8');
      const report = await new FlowTestOrchestrator().run({
        targetUrl: 'http://test.local',
        productId: 'test-workers-roles',
        specTestCases: cases(['admin', 'editor', 'visitor'], 3),
        preflight: { ...preflight, roleStorageStates: { admin: state, editor: state } },
        outputDir: tmpDir,
        breakpoints: ['1440px'],
        testWorkers: 4,
        onEvent: (e: OrchestratorEvent) => {
          if (e.type === 'TEST_POINT_STARTED') started.push({ role: e.role, id: e.testCaseId });
        },
        ...quiet,
      });
      expect(watch.most.get('admin')).toBe(1);
      expect(watch.most.get('editor')).toBe(1);
      expect(watch.mostTotal()).toBeGreaterThan(1);
      for (const role of ['admin', 'editor']) {
        expect(started.filter((s) => s.role === role).map((s) => s.id)).toEqual(
          [0, 1, 2].map((n) => `TC-${role}-${n}`)
        );
      }
      // The report keeps Plan order whatever finished first.
      expect(report.results.map((r) => r.testCaseId)).toEqual(
        cases(['admin', 'editor', 'visitor'], 3).map((c) => c.id)
      );
    });

    it('a Stop ends every worker: no Test starts afterwards and the browser is not opened again', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-workers-stop-'));
      const controller = new AbortController();
      let startsAfterStop = 0;
      const launches = vi.spyOn(BrowserManager.prototype as never, 'launchNew' as never);
      const watch = watchContexts((active) => {
        if (active >= 2 && !controller.signal.aborted) controller.abort();
      });
      serve(watch);
      await expect(
        new FlowTestOrchestrator().run({
          targetUrl: 'http://test.local',
          productId: 'test-workers-stop',
          specTestCases: cases(['visitor'], 12),
          preflight,
          outputDir: tmpDir,
          breakpoints: ['1440px'],
          testWorkers: 4,
          signal: controller.signal,
          onEvent: (e: OrchestratorEvent) => {
            if (e.type === 'TEST_POINT_STARTED' && controller.signal.aborted) startsAfterStop++;
          },
          ...quiet,
        })
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(controller.signal.aborted).toBe(true);
      expect(startsAfterStop).toBe(0);
      expect(launches).toHaveBeenCalledTimes(1);
    });
  });
});
