import type {
  AspectGrade,
  AspectScore,
  AspectType,
  CheckerType,
  Finding,
  FindingSeverity,
  SiteAspectGrades,
} from '@qa/types';
import { ASPECT_CHECKERS, SEVERITY_ORDER, aspectOfFinding, problemKey } from '@qa/types';

export { ASPECT_CHECKERS };

/** The most the AI's visual review can take off an area's score on its own (from 100 to a C). */
const MAX_OPINION_DEDUCTION = 25;

const SEVERITY_DEDUCTIONS: Record<FindingSeverity, number> = {
  Blocker: 50,
  Major: 20,
  Minor: 5,
  Suggestion: 2,
};

const FLAKY_STABILITY_PENALTY = 3;

function getSpreadMultiplier(affectedPagesCount: number): number {
  if (affectedPagesCount <= 1) return 1.0;
  if (affectedPagesCount <= 4) return 1.25;
  return 1.5;
}

/**
 * Deterministic Area Grade Scale per PRD FR-8.1:
 * - A: 90–100 (0 Blockers, 0 Majors)
 * - B: 75–89 (0 Blockers, <= 1 Major)
 * - C: 60–74 (0 Blockers)
 * - D: 40–59 (Critical defects present)
 * - F: < 40 points, OR >= 1 unhandled first-party HTTP 500 (`is5xx`)
 */
export function scoreToGrade(
  score: number,
  blockerCount: number = 0,
  majorCount: number = 0,
  hasFirstPartyCrash: boolean = false
): AspectGrade {
  if (hasFirstPartyCrash || score < 40) return 'F';
  if (blockerCount > 0) {
    // 0 tolerance for Blockers in Grade A, B, or C; capped at D (or F if < 40)
    return score >= 40 ? 'D' : 'F';
  }
  if (majorCount > 1) {
    // Grade A requires 0 Majors; Grade B allows <= 1 Major; > 1 Major caps at C
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }
  if (majorCount === 1) {
    // 1 Major caps at Grade B
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }
  // 0 Blockers, 0 Majors
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export interface ScoringOptions {
  checkersRun?: Iterable<CheckerType>;
  /** False when the home page was never read, so the marketing basics weren't looked at: shown as "Not checked", not 100%. */
  marketingChecked?: boolean;
  /** Flaky passed tests count (execution stability penalty: -3 points per occurrence) */
  flakyCount?: number;
}

/**
 * Deterministically computes A–F grades for all six aspects based on findings.
 * Same findings will always produce the exact same grades.
 *
 * With `checkersRun`, an aspect none of whose checkers ran is marked `checked: false` and left out
 * of the overall score: an aspect that was never looked at isn't an A. A checker that found
 * something always counts as having run.
 */
export function calculateSiteAspectGrades(findings: Finding[], options: ScoringOptions = {}): SiteAspectGrades {
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
    // A finding counts toward its own area when it names one (a missing viewport tag is about phones).
    const aspectFindings = findings.filter(
      (f) =>
        aspectOfFinding(f) === aspect &&
        !f.needsConfirmation &&
        f.triageStatus !== 'False Positive' &&
        f.triageStatus !== 'Intended'
    );

    let totalDeduction = 0;
    let blockerCount = 0;
    let majorCount = 0;
    const findingIds: string[] = [];

    // Group duplicate findings by problem key to avoid double penalizing the same recurring bug
    const grouped = new Map<
      string,
      { severity: FindingSeverity; pages: Set<string>; ids: string[]; opinion: boolean }
    >();
    for (const f of aspectFindings) {
      findingIds.push(f.id);
      const key = problemKey(f);
      if (!grouped.has(key)) {
        grouped.set(key, { severity: 'Suggestion', pages: new Set(), ids: [], opinion: true });
      }
      const entry = grouped.get(key)!;
      // A merged finding lists the other pages it was seen on in seenAt.
      for (const page of [f.where.urlPath, ...(f.seenAt?.pages ?? [])]) entry.pages.add(page);
      entry.ids.push(f.id);
      // AI-advisory findings never feed the grade caps.
      if (f.advisory || f.checker === 'ai-review') continue;
      entry.opinion = false;
      if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(entry.severity)) entry.severity = f.severity;
    }

    // AI visual review operates strictly as non-graded advisory commentary per PRD FR-8.1 / ADR 0009
    for (const [, group] of grouped.entries()) {
      if (group.opinion) continue; // Non-graded advisory commentary
      // One problem counts once toward the grade caps, however many pages it is on.
      if (group.severity === 'Blocker') {
        blockerCount++;
      } else if (group.severity === 'Major') {
        majorCount++;
      }
      const baseDeduction = SEVERITY_DEDUCTIONS[group.severity] || 5;
      const multiplier = getSpreadMultiplier(group.pages.size);
      totalDeduction += baseDeduction * multiplier;
    }

    // Flaky tests stability penalty (-3 per occurrence) applied to Works aspect
    if (aspect === 'Works' && options.flakyCount && options.flakyCount > 0) {
      totalDeduction += options.flakyCount * FLAKY_STABILITY_PENALTY;
    }

    // Unhandled first-party 500s trigger automatic Grade F per PRD FR-8.1. Read from the structured
    // status, never the title: a step called "Trigger uncaught exception" is not a crash.
    const hasFirstPartyCrash =
      aspect === 'Works' && aspectFindings.some((f) => !f.thirdParty && f.is5xx === true);

    const finalScore = Math.max(0, Math.round(100 - totalDeduction));
    const checked = ran ? [...relevantCheckers].some((c) => ran.has(c)) || findingIds.length > 0 : true;
    // An area nothing checked has no grade: it is "Not checked", never an A.
    const grade = checked ? scoreToGrade(finalScore, blockerCount, majorCount, hasFirstPartyCrash) : null;
    aspects[aspect] = {
      grade,
      score: checked ? finalScore : 0,
      findings: findingIds,
      ...(ran ? { checked } : {}),
    };

    if (aspect === 'Findable') {
      const seoFindings = aspectFindings.filter(
        (f) => f.categoryTag === 'SEO' || (!f.categoryTag && f.checker === 'seo')
      );
      const aeoFindings = aspectFindings.filter((f) => f.categoryTag === 'AEO');
      const geoFindings = aspectFindings.filter((f) => f.categoryTag === 'GEO');
      const marketingFindings = aspectFindings.filter((f) => f.categoryTag === 'MKT');

      const calcSub = (subF: Finding[]) => {
        let ded = 0;
        for (const f of subF) {
          ded += SEVERITY_DEDUCTIONS[f.severity] || 5;
        }
        const sc = Math.max(0, Math.round(100 - ded));
        const status: 'Clean' | 'Warning' | 'Failing' = sc >= 90 ? 'Clean' : sc >= 70 ? 'Warning' : 'Failing';
        return { score: sc, issueCount: subF.length, status };
      };

      aspects.Findable.subBreakdown = {
        seo: calcSub(seoFindings),
        aeo: calcSub(aeoFindings),
        geo: calcSub(geoFindings),
        marketing: { ...calcSub(marketingFindings), ...(options.marketingChecked === false ? { checked: false } : {}) },
      };
    }
  }

  // Calculate overall score & grade, over the aspects that were checked
  const counted = Object.values(aspects).filter((a) => a.checked !== false);
  const totalScore = counted.reduce((sum, a) => sum + a.score, 0);
  const overallScore = counted.length > 0 ? Math.round(totalScore / counted.length) : 0;
  // The overall grade can never be better than the worst area grade, so it cannot contradict the verdict.
  const rank: Record<AspectGrade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  const order: AspectGrade[] = ['F', 'D', 'C', 'B', 'A'];
  let overallGrade: AspectGrade | null = null;
  if (counted.length > 0) {
    overallGrade = scoreToGrade(overallScore);
    for (const a of counted) {
      if (a.grade && rank[a.grade] < rank[overallGrade]) overallGrade = order[rank[a.grade]];
    }
  }

  return {
    aspects,
    overallGrade,
    overallScore,
  };
}
