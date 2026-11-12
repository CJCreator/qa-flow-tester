import { describe, it, expect } from 'vitest';
import { calculateSiteAspectGrades } from '@qa/core';
import type { Finding, ReleaseReport } from '@qa/types';
import { regradeReport } from '../src/regrade.js';

const findings: Finding[] = [];
const results = [
  { testCaseId: 't1', checks: [{ checker: 'bug-detection', name: 'x', outcome: 'passed' }] },
] as unknown as ReleaseReport['results'];

function firstReport(): ReleaseReport {
  const grades = calculateSiteAspectGrades(findings, {
    checkersRun: ['bug-detection'],
    marketingChecked: false,
    flakyCount: 2,
  });
  return { findings, results, coverage: { flakyFlows: 2 }, grades } as unknown as ReleaseReport;
}

describe('regradeReport', () => {
  it('regradeReport keeps the flaky-test penalty', () => {
    const report = firstReport();
    const before = report.grades!.aspects.Works.score;
    regradeReport(report);
    expect(report.grades!.aspects.Works.score).toBe(before);
    expect(before).toBeLessThan(100);
  });

  it('regradeReport keeps the marketing part marked not checked', () => {
    const report = firstReport();
    regradeReport(report);
    expect(report.grades!.aspects.Findable.subBreakdown?.marketing?.checked).toBe(false);
  });

  it('regradeReport treats a report with no recorded flag as checked', () => {
    const report = { findings, results, coverage: { flakyFlows: 0 } } as unknown as ReleaseReport;
    regradeReport(report);
    expect(report.grades!.aspects.Findable.subBreakdown?.marketing?.checked).toBeUndefined();
  });

  it('regradeReport counts checks that ran later', () => {
    const report = firstReport();
    regradeReport(report, ['ai-review']);
    expect(report.grades!.aspects['Looks and reads well'].checked).toBe(true);
  });

  it('regradeReport rewrites the recommendations', () => {
    const report = firstReport();
    report.recommendations = [] as any;
    regradeReport(report);
    expect(Array.isArray(report.recommendations)).toBe(true);
  });
});
