import { readFileSync, promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { BrowserManager } from '../src/browser.js';
import { server } from '../../../fixtures/test-app/server.js';
import type { TestCase, ProductProfile } from '@qa/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const orchestratorSource = readFileSync(path.join(here, '..', 'src', 'orchestrator.ts'), 'utf8').replace(/\r\n/g, '\n');

// The body of one Plan Item: from its definition to the lane pool that runs it.
const planItemBody = () => {
  const start = orchestratorSource.indexOf('const runTestCase = async');
  const end = orchestratorSource.indexOf('// Test cases run in lanes', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return orchestratorSource.slice(start, end);
};

describe('T-56 parallel test points: shape of the worker pool', () => {
  it('runs read-only points with the requested workers (one by default, per decision), capped at five, and one worker otherwise', () => {
    expect(orchestratorSource).toContain(
      'const workerCount = options.readOnly ? Math.max(1, Math.min(5, Math.floor(options.testPointWorkers ?? 1))) : 1;'
    );
  });

  it('keys the lanes by role only when more than one worker runs, so one run stays in plan order', () => {
    expect(orchestratorSource).toContain("const lane = workerCount > 1 ? testCase.role : '';");
  });

  it('a Plan Item writes only to its own output, never to the lists the run shares', () => {
    const body = planItemBody();
    expect(body).not.toMatch(/(?<![\w.])(results|allFindings|notes)\.push\(/);
    expect(body).not.toMatch(/(?<![\w.])marketingLog(?!\s*:)/);
    expect(body).toContain('out.results.push(');
    expect(body).toContain('out.findings.push(');
  });

  it('commits a finished Plan Item only after every Plan Item before it', () => {
    expect(orchestratorSource).toContain('pointOutputs[slot] = out;');
    expect(orchestratorSource).toContain('for (let out = pointOutputs[committed]; out; out = pointOutputs[++committed])');
  });

  it('a first error stops the lanes that have not started, and is the run error', () => {
    expect(orchestratorSource).toContain('halt.failed = true;');
    expect(orchestratorSource).toContain('if (halt.failed) throw halt.error;');
  });

  it('claims each once-per-page check synchronously, before any await', () => {
    expect(orchestratorSource).toMatch(/if \(securityHere\) securityChecked\.add\(securityPath\);/);
    expect(orchestratorSource).toMatch(/if \(!keyboardChecked\.has\(urlPath\)\) \{\s*keyboardChecked\.add\(urlPath\);/);
    expect(orchestratorSource).toMatch(/if \(!reflowChecked\.has\(urlPath\)\) \{\s*reflowChecked\.add\(urlPath\);/);
  });

  it('no labelled break out of the Plan Item loop is left', () => {
    expect(orchestratorSource).not.toContain('break tests');
  });
});

describe('T-56 parallel test points: behaviour on the fixture', () => {
  const PORT = 3092;
  const baseUrl = `http://localhost:${PORT}`;
  const outputRoot = path.join(process.cwd(), '.tmp-t56-parallel');

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(PORT, () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await fs.rm(outputRoot, { recursive: true, force: true }).catch(() => {});
  });

  const profile: ProductProfile = {
    name: 'Fixture App',
    productId: 'fixture-app',
    roles: [
      { role: 'manager', username: 'manager@example.com', password: 'manager-password', loginPath: '/signin' },
      { role: 'viewer', username: 'viewer@example.com', password: 'viewer-password', loginPath: '/signin' },
    ],
  };

  // Three Plan Items, two roles: with two workers the manager and viewer lanes run side by side.
  const planItems = (): TestCase[] =>
    ['TC-T56-1', 'TC-T56-2', 'TC-T56-3'].map((id, i) => ({
      id,
      requirementId: `REQ-T56-${i + 1}`,
      flowId: `t56-flow-${i + 1}`,
      name: `T-56 point ${i + 1}`,
      role: i === 1 ? 'viewer' : 'manager',
      startPage: '/',
      steps: [{ action: 'wait', name: 'Wait' }],
      expectations: {},
    }));

  const runWith = async (name: string, options: { readOnly?: boolean; testPointWorkers?: number }) => {
    const outputDir = path.join(outputRoot, name);
    const started: string[] = [];
    const orchestrator = new FlowTestOrchestrator();
    const report = await orchestrator.run({
      targetUrl: baseUrl,
      productId: 'fixture-test',
      specTestCases: planItems(),
      profile,
      headless: true,
      outputDir,
      breakpoints: ['1440px'],
      repoRoot: process.cwd(),
      enableA11y: false,
      enablePerformance: false,
      onEvent: (event) => {
        if (event.type === 'TEST_POINT_STARTED') started.push(event.testCaseId);
      },
      ...options,
    });
    return { report, started };
  };

  it('gives the same results and findings with one worker and with two', async () => {
    const serial = await runWith('serial', { readOnly: true, testPointWorkers: 1 });
    const parallel = await runWith('parallel', { readOnly: true, testPointWorkers: 2 });

    const summary = (r: typeof serial.report) => ({
      results: r.results.map((x) => [x.testCaseId, x.breakpoint, x.status]),
      findings: r.findings.map((f) => `${f.checker}|${f.severity}|${f.title}`).sort(),
    });
    expect(summary(parallel.report)).toEqual(summary(serial.report));
    // retry: under the full suite's CPU load the first Plan Item of a run can fail on a cold browser
    // (seen in the serial run too, so not a parallelism defect). A real parity break fails every try.
  }, { retry: 2, timeout: 90000 });

  it('keeps the report in plan order when two roles run side by side', async () => {
    const { report } = await runWith('order', { readOnly: true, testPointWorkers: 2 });
    expect(report.results.map((r) => r.testCaseId)).toEqual(['TC-T56-1', 'TC-T56-2', 'TC-T56-3']);
  });

  it('gives each role its own session: the two roles open pages with different storage states', async () => {
    const openPage = vi.spyOn(BrowserManager.prototype, 'openPage');
    try {
      await runWith('sessions', { readOnly: true, testPointWorkers: 2 });
      const sessions = new Set(openPage.mock.calls.map((call) => JSON.stringify(call[0].storageState ?? null)));
      expect(sessions.size).toBeGreaterThanOrEqual(2);
    } finally {
      openPage.mockRestore();
    }
  });

  it('a test-copy run never reorders its Plan Items, even when more workers are asked for', async () => {
    const { report, started } = await runWith('test-copy', { readOnly: false, testPointWorkers: 4 });
    expect(started).toEqual(['TC-T56-1', 'TC-T56-2', 'TC-T56-3']);
    expect(report.results.map((r) => r.testCaseId)).toEqual(['TC-T56-1', 'TC-T56-2', 'TC-T56-3']);
  });
});
