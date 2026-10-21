import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { Finding, ReleaseReport, TestPointResult } from '@qa/types';
import { releaseVerdict } from '@qa/types';
import { RetryRunner } from '../src/retry-runner.js';
import { ReportGenerator } from '../src/reporter.js';

const tempDir = path.resolve(__dirname, './temp-flaky-rerun-test');
afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

const ids = { flowId: 'f', testCaseId: 'TC-1' };

describe('RetryRunner reruns', () => {
  it('reruns a failing test up to 3 times and stays FAILED after 1 + 3 attempts', async () => {
    let calls = 0;
    const out = await RetryRunner.runWithCleanRetry(
      async () => {
        calls++;
        throw new Error('Timeout 100ms exceeded');
      },
      { ...ids, maxRetries: 3 }
    );
    expect(calls).toBe(4);
    expect(out.outcome).toBe('FAILED');
    expect(out.telemetry?.status).toBe('FAILED');
    expect(out.telemetry?.passes).toBe(0);
    expect(out.telemetry?.attempts).toBe(4);
  });

  it('stops at the first pass and records 1 of 2 with the cause', async () => {
    let calls = 0;
    const out = await RetryRunner.runWithCleanRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error('Timeout 100ms exceeded waiting for button');
        return 'ok';
      },
      { ...ids, maxRetries: 3 }
    );
    expect(calls).toBe(2);
    expect(out.outcome).toBe('FLAKY_PASSED');
    expect(out.telemetry).toMatchObject({ passes: 1, attempts: 2, passRate: 0.5, likelyCause: 'timing' });
  });

  it('has no skip or quarantine field and never touches a timeout', async () => {
    const out = await RetryRunner.runWithCleanRetry(
      async (n) => {
        if (n === 1) throw new Error('x');
        return 1;
      },
      { ...ids, maxRetries: 1 }
    );
    const keys = JSON.stringify(Object.keys(out.telemetry ?? {}).concat(Object.keys(out)));
    expect(keys).not.toMatch(/quarantine|skip|timeout/i);
    const src = await fs.readFile(path.resolve(__dirname, '../src/retry-runner.ts'), 'utf8');
    expect(src).not.toMatch(/quarantine/i);
    expect(src).not.toMatch(/setTimeout|timeout\s*[:=]/i);
  });

  it('a sentinel secret in the error text is redacted in telemetry', async () => {
    const out = await RetryRunner.runWithCleanRetry(
      async (n) => {
        if (n === 1) throw new Error('GET /x?token=SENTINEL-SECRET-123 failed');
        return 1;
      },
      { ...ids, maxRetries: 1 }
    );
    expect(out.telemetry?.errorMessage).toBeTruthy();
    expect(out.telemetry?.errorMessage).not.toContain('SENTINEL-SECRET-123');
  });
});

function reportWith(result: TestPointResult, findings: Finding[] = []): ReleaseReport {
  return {
    runId: 'run-1',
    productId: 'p',
    targetUrl: 'http://localhost:4000',
    timestamp: '2026-10-08T10:00:00Z',
    durationMs: 1,
    coverage: {
      totalTestPoints: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      skipped: 0,
      couldNotVerify: 0,
      flakyFlows: 1,
      completionRate: 100,
    },
    results: [result],
    findings,
  };
}

describe('Flaky Passed in the report', () => {
  const flaky: TestPointResult = {
    testCaseId: 'TC-FLAKY',
    flowId: 'f',
    role: 'anonymous',
    status: 'Passed',
    durationMs: 1,
    findings: [],
    stepEvidence: [],
    retry: {
      flowId: 'f',
      testCaseId: 'TC-FLAKY',
      failedStepIndex: 0,
      retryCount: 1,
      status: 'FLAKY_PASSED',
      passes: 1,
      attempts: 2,
      passRate: 0.5,
      likelyCause: 'network',
    },
  };

  it('report line shows "1 of 2" and the likely cause', async () => {
    const out = await new ReportGenerator(tempDir).generate(reportWith(flaky));
    const md = await fs.readFile(out.mdPath, 'utf8');
    expect(md).toContain('TC-FLAKY: 1 of 2 passed; likely cause: network');
    expect(md).toContain('counted as passed');
  });

  it('adds no finding: the verdict is the same with and without it', () => {
    const base = releaseVerdict([]);
    const withFlaky = releaseVerdict(reportWith(flaky).findings);
    expect(withFlaky.ready).toBe(base.ready);
    expect(reportWith(flaky).findings).toHaveLength(0);
  });
});
