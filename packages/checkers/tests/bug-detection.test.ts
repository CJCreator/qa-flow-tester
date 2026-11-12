import { describe, it, expect } from 'vitest';
import { BugDetectionChecker, isUncaught, originOfConsoleEntry } from '../src/bug-detection.js';
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
            url: 'http://localhost:3000/app.js',
            text: 'TypeError: Cannot read properties of undefined',
            timestamp: Date.now(),
          },
          {
            type: 'error',
            url: 'http://localhost:3000/app.js',
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

  it('scores a console.error entry with no url as Minor', () => {
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
        ],
        failedRequests: [],
        durationMs: 50,
        passed: true,
      },
    ];

    const findings = checker.check(mockStepEvidence, {
      testCaseId: 'TC-003',
      role: 'member',
      breakpoint: '1440px',
      urlPath: '/app',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('Minor');
    expect(findings[0].title).toBe('Console Error in step "Click Button"');
    expect(findings[0].thirdParty).toBeUndefined();
  });

  it('scores an Uncaught Exception with a third-party stack address as Minor', () => {
    const mockStepEvidence: StepEvidence[] = [
      {
        stepIndex: 1,
        stepName: 'Load Widget',
        action: 'click',
        urlBefore: 'http://localhost:3000/',
        urlAfter: 'http://localhost:3000/',
        consoleErrors: [
          {
            type: 'error',
            text: 'Uncaught Exception: Widget crashed\n    at init (https://widget.example-chat.com/w.js:10:20)',
            timestamp: Date.now(),
          },
        ],
        failedRequests: [],
        durationMs: 50,
        passed: true,
      },
    ];

    const findings = checker.check(mockStepEvidence, {
      testCaseId: 'TC-004',
      role: 'visitor',
      breakpoint: '1440px',
      urlPath: '/',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('Minor');
    expect(findings[0].thirdParty).toBe(true);
    expect(findings[0].title).toBe('Uncaught Exception in step "Load Widget"');
    expect(findings[0].resolution).toContain('https://widget.example-chat.com');
  });

  it('scores an Uncaught Exception with a first-party stack address as Blocker', () => {
    const mockStepEvidence: StepEvidence[] = [
      {
        stepIndex: 1,
        stepName: 'Render Page',
        action: 'navigate',
        urlBefore: 'http://localhost:3000/app',
        urlAfter: 'http://localhost:3000/app',
        consoleErrors: [
          {
            type: 'error',
            text: 'Uncaught Exception: Crash in app\n    at render (http://localhost:3000/app.js:42:15)',
            timestamp: Date.now(),
          },
        ],
        failedRequests: [],
        durationMs: 50,
        passed: false,
      },
    ];

    const findings = checker.check(mockStepEvidence, {
      testCaseId: 'TC-005',
      role: 'member',
      breakpoint: '1440px',
      urlPath: '/app',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('Blocker');
    expect(findings[0].title).toBe('Uncaught Exception in step "Render Page"');
    expect(findings[0].thirdParty).toBeUndefined();
  });

  it('scores an Uncaught Exception with no address in its stack as Major', () => {
    const mockStepEvidence: StepEvidence[] = [
      {
        stepIndex: 1,
        stepName: 'Network Error',
        action: 'click',
        urlBefore: 'http://localhost:3000/app',
        urlAfter: 'http://localhost:3000/app',
        consoleErrors: [
          {
            type: 'error',
            text: 'Uncaught Exception: Network connection failed',
            timestamp: Date.now(),
          },
        ],
        failedRequests: [],
        durationMs: 50,
        passed: false,
      },
    ];

    const findings = checker.check(mockStepEvidence, {
      testCaseId: 'TC-006',
      role: 'member',
      breakpoint: '1440px',
      urlPath: '/app',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('Major');
    expect(findings[0].title).toBe('Uncaught Exception in step "Network Error"');
    expect(findings[0].resolution).toContain('address of the failing script could not be read');
    expect(findings[0].thirdParty).toBeUndefined();
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

  describe('originOfConsoleEntry & isUncaught helpers', () => {
    it('detects uncaught exceptions by prefix', () => {
      expect(isUncaught({ type: 'error', text: 'Uncaught Exception: foo', timestamp: 0 })).toBe(true);
      expect(isUncaught({ type: 'error', text: 'Error: Uncaught Exception in message', timestamp: 0 })).toBe(false);
      expect(isUncaught({ type: 'error', text: 'TypeError: bar', timestamp: 0 })).toBe(false);
    });

    it('determines origin from url when present', () => {
      expect(
        originOfConsoleEntry({
          type: 'error',
          url: 'https://cdn.example.com/lib.js',
          text: 'Error',
          timestamp: 0,
        })
      ).toBe('https://cdn.example.com');
    });

    it('determines origin from uncaught exception stack lines starting with "at "', () => {
      const entry = {
        type: 'error' as const,
        text: 'Uncaught Exception: Failed to load https://bad-example.com/asset\n    at init (https://widget.example-chat.com/w.js:10:20)\n    at http://localhost:3000/app.js:5:10',
        timestamp: 0,
      };
      expect(originOfConsoleEntry(entry)).toBe('https://widget.example-chat.com');
    });

    it('returns undefined for uncaught exception when stack has no http/https address', () => {
      const entry = {
        type: 'error' as const,
        text: 'Uncaught Exception: Internal error\n    at internalFunction (<anonymous>:1:1)',
        timestamp: 0,
      };
      expect(originOfConsoleEntry(entry)).toBeUndefined();
    });

    it('returns undefined for plain console error with no url', () => {
      const entry = {
        type: 'error' as const,
        text: 'TypeError: Cannot read properties of undefined\n    at http://localhost:3000/app.js:1:1',
        timestamp: 0,
      };
      expect(originOfConsoleEntry(entry)).toBeUndefined();
    });
  });
});
