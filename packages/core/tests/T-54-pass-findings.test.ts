import { describe, it, expect } from 'vitest';
import { BugDetectionChecker } from '../../checkers/src/bug-detection.js';
import type { StepEvidence } from '@qa/types';

// T-54: a passing step writes no screenshot, so its readers get undefined. A finding then carries no
// screenshot reference (never an empty path), and a failing step still keeps its own.
describe('T-54 findings from steps without a screenshot', () => {
  const context = {
    testCaseId: 'TC-054',
    flowId: 'pass-flow',
    role: 'member',
    breakpoint: '1440px' as const,
    urlPath: '/app',
  };

  const base = {
    stepIndex: 1,
    stepName: 'Open Settings',
    action: 'click',
    urlBefore: 'http://localhost:3000/app',
    urlAfter: 'http://localhost:3000/app',
    consoleErrors: [],
    failedRequests: [],
    durationMs: 10,
  };

  it('bug detection on a passing step with a console error omits the screenshot reference', () => {
    const steps: StepEvidence[] = [
      {
        ...base,
        screenshotPath: undefined,
        domSnapshotPath: undefined,
        consoleErrors: [{ type: 'error', text: 'TypeError: x is undefined', timestamp: Date.now() }],
        passed: true,
      } as StepEvidence,
    ];

    const findings = new BugDetectionChecker().check(steps, context);

    expect(findings.length).toBe(1);
    expect(findings[0].evidence?.screenshotPath).toBeUndefined();
    expect(JSON.stringify(findings[0].evidence)).not.toContain('"screenshotPath"');
  });

  it('bug detection on a failing step keeps its screenshot', () => {
    const steps: StepEvidence[] = [
      {
        ...base,
        screenshotPath: '/evidence/step-1-Open_Settings.png',
        consoleErrors: [{ type: 'error', text: 'TypeError: x is undefined', timestamp: Date.now() }],
        passed: false,
        error: 'Element not found',
      } as StepEvidence,
    ];

    const findings = new BugDetectionChecker().check(steps, context);

    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.evidence?.screenshotPath).toBe('/evidence/step-1-Open_Settings.png');
    }
  });

  it('never writes an empty screenshot path', () => {
    const steps: StepEvidence[] = [
      {
        ...base,
        consoleErrors: [{ type: 'error', text: 'Boom', timestamp: Date.now() }],
        passed: true,
      } as StepEvidence,
    ];

    const findings = new BugDetectionChecker().check(steps, context);

    for (const f of findings) {
      expect(f.evidence?.screenshotPath).not.toBe('');
    }
  });
});
