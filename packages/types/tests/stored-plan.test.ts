import { describe, expect, it } from 'vitest';
import {
  isStoredPlanShape,
  isRunSummary,
  isBenchmarkJob,
  isReleaseReportShape,
  planPatchProblem,
} from '../src/stored-plan.js';

describe('stored-plan guards', () => {
  describe('isStoredPlanShape', () => {
    const validPlan = {
      plan: {
        runId: 'run-1',
        targetUrl: 'https://example.com',
        pages: [],
        flows: [],
        questions: [],
      },
      context: {
        targetUrl: 'https://example.com',
        runId: 'run-1',
      },
    };

    it('accepts a valid plan without planPages or draft', () => {
      expect(isStoredPlanShape(validPlan)).toBe(true);
    });

    it('accepts a valid plan with planPages and draft.plan.pages', () => {
      const fullPlan = {
        ...validPlan,
        plan: {
          ...validPlan.plan,
          planPages: [{ id: 'p1', tests: [{ id: 't1' }] }],
        },
        context: {
          ...validPlan.context,
          draft: {
            plan: {
              pages: [{ id: 'p2', tests: [] }],
            },
          },
        },
      };
      expect(isStoredPlanShape(fullPlan)).toBe(true);
    });

    it('accepts extra unknown fields', () => {
      expect(
        isStoredPlanShape({
          ...validPlan,
          extraTopLevel: 123,
          plan: { ...validPlan.plan, extraPlan: 'abc' },
        })
      ).toBe(true);
    });

    it('refuses non-object inputs', () => {
      expect(isStoredPlanShape(null)).toBe(false);
      expect(isStoredPlanShape('plan')).toBe(false);
      expect(isStoredPlanShape([validPlan])).toBe(false);
      expect(isStoredPlanShape(undefined)).toBe(false);
    });

    it('refuses when flows is a string', () => {
      const invalid = {
        ...validPlan,
        plan: { ...validPlan.plan, flows: 'not-an-array' },
      };
      expect(isStoredPlanShape(invalid)).toBe(false);
    });

    it('refuses when planPages has a page without tests array', () => {
      const invalid = {
        ...validPlan,
        plan: {
          ...validPlan.plan,
          planPages: [{ id: 'p1' }], // tests missing
        },
      };
      expect(isStoredPlanShape(invalid)).toBe(false);
    });

    it('refuses when draft.plan.pages has a page without tests array', () => {
      const invalid = {
        ...validPlan,
        context: {
          ...validPlan.context,
          draft: {
            plan: {
              pages: [{ id: 'p1' }], // tests missing
            },
          },
        },
      };
      expect(isStoredPlanShape(invalid)).toBe(false);
    });

    it('refuses missing required strings', () => {
      expect(isStoredPlanShape({ ...validPlan, plan: { ...validPlan.plan, runId: 123 } })).toBe(false);
      expect(isStoredPlanShape({ ...validPlan, context: { ...validPlan.context, targetUrl: undefined } })).toBe(false);
    });
  });

  describe('isRunSummary', () => {
    const validSummary = {
      runId: 'run-1',
      targetUrl: 'https://example.com',
      host: 'example.com',
      timestamp: '2026-11-12T00:00:00Z',
      stamp: 'Ready to release',
      durationMs: 1200,
      ready: true,
      counts: {
        Blocker: 0,
        Major: 0,
        Minor: 1,
        Suggestion: 2,
      },
    };

    it('accepts a valid RunSummary', () => {
      expect(isRunSummary(validSummary)).toBe(true);
    });

    it('accepts extra unknown fields', () => {
      expect(isRunSummary({ ...validSummary, reason: 'Passed', extra: 'field' })).toBe(true);
    });

    it('refuses non-object inputs', () => {
      expect(isRunSummary(null)).toBe(false);
      expect(isRunSummary('summary')).toBe(false);
      expect(isRunSummary([])).toBe(false);
    });

    it('refuses when counts is not an object of numbers, and accepts a missing severity', () => {
      expect(isRunSummary({ ...validSummary, counts: { Blocker: 0, Major: 0, Minor: 1 } })).toBe(true);
      expect(
        isRunSummary({
          ...validSummary,
          counts: { Blocker: 0, Major: 0, Minor: 1, Suggestion: 'none' },
        })
      ).toBe(false);
    });

    it('refuses missing required fields', () => {
      expect(isRunSummary({ ...validSummary, runId: undefined })).toBe(false);
      expect(isRunSummary({ ...validSummary, ready: 'true' })).toBe(false);
      expect(isRunSummary({ ...validSummary, durationMs: '1200' })).toBe(false);
    });
  });

  describe('isBenchmarkJob', () => {
    const validJob = {
      id: 'bench-1',
      status: 'done' as const,
      stage: 'Finished analysis',
      startedAt: '2026-11-12T00:00:00Z',
    };

    it('accepts a valid BenchmarkJob', () => {
      expect(isBenchmarkJob(validJob)).toBe(true);
      expect(isBenchmarkJob({ ...validJob, status: 'running' })).toBe(true);
      expect(isBenchmarkJob({ ...validJob, status: 'failed' })).toBe(true);
    });

    it('accepts extra unknown fields', () => {
      expect(isBenchmarkJob({ ...validJob, ourUrl: 'https://a.com', refUrl: 'https://b.com' })).toBe(true);
    });

    it('refuses non-object inputs', () => {
      expect(isBenchmarkJob(null)).toBe(false);
      expect(isBenchmarkJob('job')).toBe(false);
      expect(isBenchmarkJob([validJob])).toBe(false);
    });

    it('refuses invalid status', () => {
      expect(isBenchmarkJob({ ...validJob, status: 'pending' })).toBe(false);
    });

    it('refuses missing fields', () => {
      expect(isBenchmarkJob({ ...validJob, id: undefined })).toBe(false);
      expect(isBenchmarkJob({ ...validJob, stage: 123 })).toBe(false);
    });
  });

  describe('isReleaseReportShape', () => {
    const validReport = {
      runId: 'run-1',
      findings: [],
    };

    it('accepts a valid report shape', () => {
      expect(isReleaseReportShape(validReport)).toBe(true);
    });

    it('accepts extra unknown fields', () => {
      expect(isReleaseReportShape({ ...validReport, targetUrl: 'https://example.com', grades: {} })).toBe(true);
    });

    it('refuses non-object inputs', () => {
      expect(isReleaseReportShape(null)).toBe(false);
      expect(isReleaseReportShape('report')).toBe(false);
      expect(isReleaseReportShape([])).toBe(false);
    });

    it('refuses when findings is not an array', () => {
      expect(isReleaseReportShape({ runId: 'run-1', findings: 'none' })).toBe(false);
    });

    it('refuses when runId is not a string', () => {
      expect(isReleaseReportShape({ runId: 123, findings: [] })).toBe(false);
    });
  });

  describe('planPatchProblem', () => {
    const validBody = {
      flows: [{ id: 'f1', steps: [] }],
      testCases: [{ id: 'tc1', steps: [] }],
      items: [{ id: 'item1', skipped: true }],
      screenSizes: ['1440px', '375px'],
    };

    it('returns null for a valid full body', () => {
      expect(planPatchProblem(validBody)).toBeNull();
    });

    it('returns null for empty body or partial valid body', () => {
      expect(planPatchProblem({})).toBeNull();
      expect(planPatchProblem({ items: [{ id: 'item1', skipped: false }] })).toBeNull();
      expect(planPatchProblem({ productContext: 'New context' })).toBeNull();
    });

    it('returns text problem for { testCases: [{}] }', () => {
      const problem = planPatchProblem({ testCases: [{}] });
      expect(typeof problem).toBe('string');
      expect(problem).toContain('test case');
    });

    it('returns text problem for invalid flows', () => {
      expect(typeof planPatchProblem({ flows: 'invalid' })).toBe('string');
      expect(typeof planPatchProblem({ flows: [{ id: 'f1' }] })).toBe('string');
    });

    it('returns text problem for invalid items', () => {
      expect(typeof planPatchProblem({ items: 'invalid' })).toBe('string');
      expect(typeof planPatchProblem({ items: [{ id: 'i1', skipped: 'yes' }] })).toBe('string');
      expect(typeof planPatchProblem({ items: [{ id: 123, skipped: true }] })).toBe('string');
    });

    it('returns text problem for invalid screenSizes', () => {
      expect(typeof planPatchProblem({ screenSizes: 'invalid' })).toBe('string');
      expect(typeof planPatchProblem({ screenSizes: [123] })).toBe('string');
    });

    it('returns text problem for non-object body', () => {
      expect(typeof planPatchProblem(null)).toBe('string');
      expect(typeof planPatchProblem('body')).toBe('string');
      expect(typeof planPatchProblem([])).toBe('string');
    });
  });
});
