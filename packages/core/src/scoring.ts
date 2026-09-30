import type {
  AspectGrade,
  AspectScore,
  AspectType,
  CheckerType,
  Finding,
  FindingSeverity,
  SiteAspectGrades,
} from '@qa/types';

export const ASPECT_CHECKERS: Record<AspectType, CheckerType[]> = {
  Works: ['bug-detection', 'spec-conformance'],
  Accessible: ['ux-quality'],
  'Fast and mobile': ['performance'],
  Findable: ['seo'],
  Secure: ['security', 'permission-matrix'],
  'Looks and reads well': ['design-standards', 'ai-review'],
};

const SEVERITY_DEDUCTIONS: Record<FindingSeverity, number> = {
  Blocker: 30,
  Major: 15,
  Minor: 5,
  Suggestion: 2,
};

function getSpreadMultiplier(affectedPagesCount: number): number {
  if (affectedPagesCount <= 1) return 1.0;
  if (affectedPagesCount <= 4) return 1.25;
  return 1.5;
}

export function scoreToGrade(score: number, blockerCount: number = 0): AspectGrade {
  if (blockerCount >= 2 || score < 60) return 'F';
  if (blockerCount === 1) return score >= 70 ? 'D' : scoreToGrade(score, 0); // single blocker caps at D
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * Deterministically computes A–F grades for all six aspects based on findings.
 * Same findings will always produce the exact same grades.
 *
 * With `checkersRun`, an aspect none of whose checkers ran is marked `checked: false` and left out
 * of the overall score: an aspect that was never looked at isn't an A. A checker that found
 * something always counts as having run.
 */
export function calculateSiteAspectGrades(findings: Finding[], options: { checkersRun?: Iterable<CheckerType> } = {}): SiteAspectGrades {
  const aspects: Record<AspectType, AspectScore> = {
    Works: { grade: 'A', score: 100, findings: [] },
    Accessible: { grade: 'A', score: 100, findings: [] },
    'Fast and mobile': { grade: 'A', score: 100, findings: [] },
    Findable: { grade: 'A', score: 100, findings: [] },
    Secure: { grade: 'A', score: 100, findings: [] },
    'Looks and reads well': { grade: 'A', score: 100, findings: [] },
  };

  const aspectList: AspectType[] = [
    'Works',
    'Accessible',
    'Fast and mobile',
    'Findable',
    'Secure',
    'Looks and reads well',
  ];
  const ran = options.checkersRun ? new Set(options.checkersRun) : undefined;

  for (const aspect of aspectList) {
    const relevantCheckers = new Set(ASPECT_CHECKERS[aspect]);
    // Group findings by finding title/category to evaluate spread across pages
    const aspectFindings = findings.filter(
      (f) => relevantCheckers.has(f.checker) && !f.needsConfirmation && f.triageStatus !== 'False Positive' && f.triageStatus !== 'Intended'
    );

    let totalDeduction = 0;
    let blockerCount = 0;
    const findingIds: string[] = [];

    // Group duplicate findings by title/code to avoid double penalizing the same recurring bug
    const grouped = new Map<string, { severity: FindingSeverity; pages: Set<string>; ids: string[] }>();
    for (const f of aspectFindings) {
      findingIds.push(f.id);
      const key = f.title;
      if (!grouped.has(key)) {
        grouped.set(key, { severity: f.severity, pages: new Set(), ids: [] });
      }
      const entry = grouped.get(key)!;
      entry.pages.add(f.where.urlPath);
      entry.ids.push(f.id);
      if (f.severity === 'Blocker') {
        blockerCount++;
      }
    }

    for (const [, group] of grouped.entries()) {
      const baseDeduction = SEVERITY_DEDUCTIONS[group.severity] || 5;
      const multiplier = getSpreadMultiplier(group.pages.size);
      totalDeduction += baseDeduction * multiplier;
    }

    let finalScore = Math.max(0, Math.round(100 - totalDeduction));
    // Blocker caps
    if (blockerCount === 1 && finalScore > 65) {
      finalScore = 65;
    } else if (blockerCount >= 2 && finalScore > 50) {
      finalScore = 50;
    }

    const grade = scoreToGrade(finalScore, blockerCount);
    aspects[aspect] = {
      grade,
      score: finalScore,
      findings: findingIds,
      ...(ran ? { checked: [...relevantCheckers].some((c) => ran.has(c)) || findingIds.length > 0 } : {}),
    };
  }

  // Calculate overall score & grade, over the aspects that were checked
  const counted = Object.values(aspects).filter((a) => a.checked !== false);
  const totalScore = counted.reduce((sum, a) => sum + a.score, 0);
  const overallScore = counted.length > 0 ? Math.round(totalScore / counted.length) : 100;
  const hasF = counted.some((a) => a.grade === 'F');
  let overallGrade = scoreToGrade(overallScore);
  if (hasF && (overallGrade === 'A' || overallGrade === 'B')) {
    overallGrade = 'C'; // Failing an aspect caps overall grade at C
  }

  return {
    aspects,
    overallGrade,
    overallScore,
  };
}
