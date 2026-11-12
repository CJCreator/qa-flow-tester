import { calculateSiteAspectGrades, generateRankedRecommendations } from '@qa/core';
import type { CheckerType, ReleaseReport } from '@qa/types';

/**
 * Grades and recommendations again after the findings changed (triage, a judged item, the AI visual review).
 * Uses the same inputs as the first grading: the checks that ran, the flaky count, and whether the marketing
 * basics were checked (read back from the saved grades, which record `checked: false` for them).
 * `alsoRan` adds checks that ran after the report was made, such as 'ai-review'.
 */
export function regradeReport(report: ReleaseReport, alsoRan: CheckerType[] = []): void {
  const ran = report.results.flatMap((r) => (r.checks || []).map((c) => c.checker));
  report.grades = calculateSiteAspectGrades(report.findings, {
    checkersRun: [...ran, ...alsoRan],
    marketingChecked: report.grades?.aspects.Findable?.subBreakdown?.marketing?.checked !== false,
    flakyCount: report.coverage?.flakyFlows,
  });
  report.recommendations = generateRankedRecommendations(report.findings);
}
