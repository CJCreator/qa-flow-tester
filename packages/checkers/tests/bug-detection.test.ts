import { describe, it, expect } from 'vitest';
import { BugDetectionChecker } from '../src/bug-detection.js';
import type { StepEvidence } from '@qa/types';

describe('BugDetectionChecker', () => {
  const checker = new BugDetectionChecker();

  it('detects console errors and unhandled exceptions with appropriate severities', () => {
    const mockStepEvidence: StepEvidence[] = [
      {
        stepIndex: 1,
        stepName: 'Click Button',
        action: 'click',
        urlBefore: 'http://localhost:3000/app',
        urlAfter: 'http://localhost:3000/app',
        consoleErrors: [
          {
            type: 'error',
            text: 'TypeError: Cannot read properties of undefined',
            timestamp: Date.now(),
          },
          {
            type: 'error',
            text: 'Uncaught Exception: Network connection failed',
            timestamp: Date.now(),
          },
        ],
        failedRequests: [],
        durationMs: 120,
        passed: false,
      },
    ];

    const findings = checker.check(mockStepEvidence, {
      testCaseId: 'TC-001',
      flowId: 'test-flow',
      role: 'member',
      breakpoint: '1440px',
      urlPath: '/app',
    });

    expect(findings.length).toBe(2);
    expect(findings[0].severity).toBe('Major');
    expect(findings[0].checker).toBe('bug-detection');
    expect(findings[0].expectedVsActual.actual).toContain('TypeError');

    expect(findings[1].severity).toBe('Blocker');
    expect(findings[1].title).toContain('Uncaught Exception');
  });

  it('flags 4xx and 5xx failed HTTP requests', () => {
    const mockStepEvidence: StepEvidence[] = [
      {
        stepIndex: 1,
        stepName: 'Save Form',
        action: 'click',
        urlBefore: 'http://localhost:3000/form',
        urlAfter: 'http://localhost:3000/form',
        consoleErrors: [],
        failedRequests: [
          {
            url: 'http://localhost:3000/api/save',
            method: 'POST',
            status: 500,
            timestamp: Date.now(),
          },
          {
            url: 'http://localhost:3000/api/missing',
            method: 'GET',
            status: 404,
            timestamp: Date.now(),
          },
        ],
        durationMs: 250,
        passed: false,
      },
    ];

    const findings = checker.check(mockStepEvidence, {
      testCaseId: 'TC-002',
      flowId: 'form-submit',
      role: 'admin',
      breakpoint: '1440px',
      urlPath: '/form',
    });

    expect(findings.length).toBe(2);
    expect(findings[0].severity).toBe('Blocker'); // 500 is Blocker
    expect(findings[0].title).toContain('HTTP 500 on POST');

    expect(findings[1].severity).toBe('Major'); // 404 is Major
    expect(findings[1].title).toContain('HTTP 404 on GET');
  });

  it('returns empty array when there are no errors or failures', () => {
    const mockStepEvidence: StepEvidence[] = [
      {
        stepIndex: 1,
        stepName: 'Navigate Home',
        action: 'navigate',
        urlBefore: 'http://localhost:3000/',
        urlAfter: 'http://localhost:3000/',
        consoleErrors: [],
        failedRequests: [],
        durationMs: 80,
        passed: true,
      },
    ];

    const findings = checker.check(mockStepEvidence, {
      role: 'anonymous',
      breakpoint: '1440px',
      urlPath: '/',
    });

    expect(findings).toHaveLength(0);
  });
});
