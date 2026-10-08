import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import type { OrchestratorEvent } from '../src/orchestrator.js';
import type { TestCase, TestStep } from '@qa/types';

const PORT = 3541;
const outputDir = path.join(process.cwd(), '.tmp-missing-element-report');

const page = (body: string, script = ''): string =>
  `<html lang="en"><head><title>T</title></head><body><header><a href="/">Home</a></header><main><h1>T</h1>${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`;

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  const url = req.url || '/';
  if (url.startsWith('/empty')) {
    res.end(page('<p>Nothing here</p>'));
  } else if (url.startsWith('/late-button')) {
    res.end(
      page(
        '<p>Soon</p>',
        `setTimeout(function(){var b=document.createElement('button');b.setAttribute('data-testid','late');b.textContent='Late';document.querySelector('main').appendChild(b);},1500);`
      )
    );
  } else if (url.startsWith('/late-input')) {
    res.end(
      page(
        '<p>Soon</p>',
        `setTimeout(function(){var i=document.createElement('input');i.setAttribute('data-testid','late-in');document.querySelector('main').appendChild(i);},1500);`
      )
    );
  } else if (url.startsWith('/very-late')) {
    res.end(
      page(
        '<p>Later</p>',
        `setTimeout(function(){var b=document.createElement('button');b.setAttribute('data-testid','later');b.textContent='Later';document.querySelector('main').appendChild(b);},16000);`
      )
    );
  } else {
    res.end(page('ok'));
  }
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
});

async function runSteps(startPage: string, steps: TestStep[], stepTimeoutMs?: number) {
  const testCase: TestCase = {
    id: 'TC-MISSING-1',
    flowId: 'missing-flow',
    name: 'Missing element flow',
    role: 'anonymous',
    startPage,
    steps,
    expectations: {},
  };
  const events: OrchestratorEvent[] = [];
  const report = await new FlowTestOrchestrator().run({
    targetUrl: `http://localhost:${PORT}`,
    productId: 'missing-test',
    specTestCases: [testCase],
    outputDir,
    enableA11y: false,
    enableSecurity: false,
    enablePerformance: false,
    enableSeo: false,
    recordVideo: false,
    stepTimeoutMs,
    onEvent: (e) => events.push(e),
  });
  const completed = events.filter(
    (e): e is Extract<OrchestratorEvent, { type: 'STEP_COMPLETED' }> => e.type === 'STEP_COMPLETED'
  );
  return { report, completed };
}

describe('missing element step cap', () => {
  it('a missing element fails the step within the default cap', async () => {
    const { completed } = await runSteps('/empty', [
      { action: 'click', selector: '[data-testid="nope"]', name: 'Press Nope' },
    ]);
    const failed = completed.find((e) => !e.passed)!;
    expect(failed).toBeTruthy();
    expect(failed.durationMs).toBeLessThanOrEqual(10_000 + 4000); // still far under the 30 s Playwright default
    expect(failed.error).toMatch(/Timeout \d+ms exceeded/);
    expect(failed.error).toContain('waitFor');
  }, 60000);

  it('a missing element fails at a 2 s override', async () => {
    const { completed } = await runSteps(
      '/empty',
      [{ action: 'click', selector: '[data-testid="nope"]', name: 'Press Nope' }],
      2000
    );
    const failed = completed.find((e) => !e.passed)!;
    expect(failed.durationMs).toBeLessThanOrEqual(3500);
    expect(failed.durationMs).toBeGreaterThanOrEqual(1500);
  }, 60000);

  it('a missing element waits out a larger override', async () => {
    const { completed } = await runSteps(
      '/very-late',
      [{ action: 'click', selector: '[data-testid="later"]', name: 'Press Later' }],
      25_000
    );
    expect(completed.every((e) => e.passed)).toBe(true);
  }, 60000);

  it('a missing element on a failing flow retries within twice the cap', async () => {
    const { report, completed } = await runSteps(
      '/empty',
      [{ action: 'click', selector: '[data-testid="nope"]', name: 'Press Nope' }],
      3000
    );
    const failures = completed.filter((e) => !e.passed);
    expect(failures).toHaveLength(2);
    const total = failures.reduce((sum, e) => sum + e.durationMs, 0);
    expect(total).toBeLessThanOrEqual(6000 + 2000);
    const point = report.results.find((r) => r.testCaseId === 'TC-MISSING-1')!;
    expect(point.status).toBe('Failed');
    expect(point.retry?.status).not.toBe('FLAKY_PASSED');
  }, 60000);

  it('a missing element that appears late is still clicked', async () => {
    const { completed } = await runSteps('/late-button', [
      { action: 'click', selector: '[data-testid="late"]', name: 'Press Late' },
    ]);
    expect(completed.every((e) => e.passed)).toBe(true);
  }, 60000);

  it('a missing field that appears late is still filled', async () => {
    const { completed } = await runSteps('/late-input', [
      { action: 'fill', selector: '[data-testid="late-in"]', value: 'hello', name: 'Type Late' },
    ]);
    expect(completed.every((e) => e.passed)).toBe(true);
  }, 60000);

  it('a missing optional element is skipped at about 1.5 s', async () => {
    const { report, completed } = await runSteps('/empty', [
      { action: 'click', selector: '[data-testid="nope"]', name: 'Open menu', optional: true },
    ]);
    const step = completed[0];
    expect(step.durationMs).toBeLessThanOrEqual(3000);
    expect(step.error?.startsWith('Skipped:')).toBe(true);
    const point = report.results.find((r) => r.testCaseId === 'TC-MISSING-1')!;
    expect(point.status).not.toBe('Failed');
  }, 60000);
});
