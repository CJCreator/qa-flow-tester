import type { Finding, ReleaseReport } from '@qa/types';

export function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: 'F-1',
    severity: 'Major',
    checker: 'bug-detection',
    title: 'Checkout crashes',
    where: { urlPath: '/checkout', role: 'member', breakpoint: '1440px' },
    expectedVsActual: { expected: 'ok', actual: 'crash' },
    stepsToReproduce: ['Open /checkout'],
    evidence: {},
    resolution: 'Fix the endpoint',
    ...over,
  };
}

export function report(findings: Finding[], over: Partial<ReleaseReport> = {}): ReleaseReport {
  return {
    runId: 'run-1',
    productId: 'shop',
    targetUrl: 'http://localhost:4000',
    timestamp: '2026-10-08T10:00:00Z',
    durationMs: 100,
    coverage: {
      totalTestPoints: 1,
      passed: 1,
      failed: 0,
      blocked: 0,
      skipped: 0,
      couldNotVerify: 0,
      completionRate: 100,
    },
    results: [],
    findings,
    ...over,
  };
}
