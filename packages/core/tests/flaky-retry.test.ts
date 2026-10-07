import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { RetryRunner } from '../src/retry-runner.js';
import type { TestCase } from '@qa/types';

describe('Clean flow retry', () => {
  const PORT = 3091;
  const outputDir = path.join(process.cwd(), '.tmp-flaky-report');
  let loads = 0;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url?.startsWith('/flaky')) {
      loads++;
      // The button is hidden the first time the page loads, as when a slow script loses a race.
      res.end(
        `<html lang="en"><head><title>Flaky</title></head><body><header><a href="/">Home</a></header><main><h1>Flaky</h1><button data-testid="go" ${loads > 1 ? '' : 'style="display:none"'}>Go</button></main></body></html>`
      );
      return;
    }
    res.end('<html lang="en"><head><title>x</title></head><body><main>ok</main></body></html>');
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('marks a flow that fails once and passes on a clean retry as flaky, still passed', async () => {
    const testCase: TestCase = {
      id: 'TC-FLAKY-1',
      flowId: 'flaky-flow',
      name: 'Flaky flow',
      role: 'anonymous',
      startPage: '/flaky',
      steps: [{ action: 'click', selector: '[data-testid="go"]', name: 'Press Go' }],
      expectations: {},
    };
    const report = await new FlowTestOrchestrator().run({
      targetUrl: `http://localhost:${PORT}`,
      productId: 'flaky-test',
      specTestCases: [testCase],
      outputDir,
      enableA11y: false,
      enableSecurity: false,
      enablePerformance: false,
      enableSeo: false,
      recordVideo: false,
    });

    const point = report.results.find((r) => r.testCaseId === 'TC-FLAKY-1')!;
    expect(point.retry?.status).toBe('FLAKY_PASSED');
    expect(point.retry?.retryCount).toBe(1);
    expect(point.retry?.errorMessage).toBeTruthy();
    expect(point.status).not.toBe('Failed');
    expect(report.coverage.flakyFlows).toBe(1);
    expect(loads).toBe(2);
  }, 60000);

  it('does not retry an error the caller says must stop the run', async () => {
    let calls = 0;
    const out = await RetryRunner.runWithCleanRetry(
      async () => {
        calls++;
        throw new Error('stopped');
      },
      { flowId: 'f', testCaseId: 't', maxRetries: 3, shouldRetry: () => false }
    );
    expect(out.outcome).toBe('FAILED');
    expect(calls).toBe(1);
  });
});
