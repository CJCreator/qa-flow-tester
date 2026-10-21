import type { AspectGrade, AspectType, Finding, FindingSeverity, RunCoverage, SiteAspectGrades } from './index.js';
import { groupIntoProblems, isDismissed } from './problems.js';

export interface ReleaseGateCriteria {
  maxBlockers?: number;
  maxMajors?: number;
  maxMinors?: number;
  strictAccessibility?: boolean;
  minAreaScore?: number;
  minAreaGrade?: AspectGrade;
  /** An area nothing checked fails the gate. Without it, the area is only listed as "not checked". */
  enforceAllAreas?: boolean;
  advisoryAreas?: AspectType[];
}

/**
 * The one definition of "ready to release" (PRD FR-8.2, DEMO-READINESS-PLAN decision 1). It is
 * applied only by `releaseVerdict`; the screens, report.html, report.md, the stamp and the CLI exit
 * code all call it.
 * - standard (the default): 0 Blockers and every area checked and at C or better. Majors do not block on
 *   their own, but they lower the area grade (see scoring.ts).
 * - strict: 0 Blockers, 0 Majors, every area checked and at A (score 90+), Accessible at A.
 * - lenient: 0 Blockers; area grades are not checked.
 * An area nothing checked (grade null) is never counted as a pass. Where `enforceAllAreas` is set
 * (standard and strict) it fails the gate; otherwise it is listed as "not checked" in the verdict.
 * A run where nothing was checked is never ready.
 */
export const DEFAULT_RELEASE_GATES: Record<'strict' | 'standard' | 'lenient', ReleaseGateCriteria> = {
  strict: {
    maxBlockers: 0,
    maxMajors: 0,
    strictAccessibility: true,
    minAreaScore: 90,
    minAreaGrade: 'A',
    enforceAllAreas: true,
  },
  standard: {
    maxBlockers: 0,
    minAreaScore: 60,
    minAreaGrade: 'C',
    enforceAllAreas: true,
  },
  lenient: {
    maxBlockers: 0,
    advisoryAreas: ['Accessible', 'Fast and mobile', 'Findable', 'Looks and reads well'],
  },
};

/**
 * The one verdict a report gives: ready to release, or not yet, and why. The screens, report.html
 * and report.md all use it, so they never disagree. It counts problems as a person reads them (the
 * same problem on ten pages is one problem; see problems.ts). Findings someone marked as intended
 * or a false positive don't count, and neither do unconfirmed AI guesses (they're listed as "to confirm").
 */
export interface ReleaseVerdict {
  ready: boolean;
  /** The words on the stamp. */
  stamp: 'Ready to release' | 'Not ready yet';
  /** Why, in one sentence, e.g. "2 problems must be fixed first." */
  reason: string;
  /** Problems that count, by how serious they are. */
  counts: Record<FindingSeverity, number>;
  /** Blocker and Major problems: what must be fixed before release. */
  mustFix: number;
  /** Every problem that counts. */
  total: number;
  /** Unconfirmed AI guesses the site didn't match, as problems. */
  toConfirm: number;
  /** The findings behind the problems, for the developer details. */
  findings: number;
  /** Configurable criteria used to evaluate this verdict. */
  gate?: ReleaseGateCriteria;
  /** Specific criteria that failed, if any. */
  breaches?: string[];
  /** Areas nothing checked this time. Shown as "Not checked", never counted as a pass. */
  notChecked?: AspectType[];
  /** Tests that were planned but did not run (skipped, blocked), when the caller passed coverage. */
  skippedTests?: number;
}

export function countsTowardVerdict(
  f: Pick<Finding, 'triageStatus' | 'needsConfirmation'> & Partial<Finding>
): boolean {
  return !isDismissed(f) && !f.needsConfirmation && !f.advisory && f.checker !== 'ai-review';
}

/**
 * True when no check ran: no findings, and every area is unchecked. With no grades given, only the
 * findings can say, so no findings means nothing ran.
 */
export function nothingWasChecked(findings?: readonly unknown[] | null, grades?: SiteAspectGrades): boolean {
  if ((findings ?? []).length > 0) return false;
  if (!grades) return true;
  const areas: Array<SiteAspectGrades['aspects'][AspectType] | undefined> = Object.values(grades.aspects ?? {});
  return areas.every((a) => !a || a.checked === false || a.grade === null);
}

export function releaseVerdict(
  findings?: Array<
    Pick<Finding, 'severity' | 'triageStatus' | 'needsConfirmation' | 'title'> & Partial<Finding>
  > | null,
  gate?: ReleaseGateCriteria,
  grades?: SiteAspectGrades,
  coverage?: Pick<RunCoverage, 'skipped' | 'blocked'>
): ReleaseVerdict {
  gate = gate ?? DEFAULT_RELEASE_GATES.standard;
  const customGate = gate !== DEFAULT_RELEASE_GATES.standard;
  const nothingChecked = nothingWasChecked(findings, grades);
  // AI-written findings are advisory: they never change the verdict (ADR 0009).
  const safeFindings = (findings ?? []).filter((f) => !f.advisory && f.checker !== 'ai-review');
  const problems = groupIntoProblems(
    safeFindings.map(
      (f) =>
        ({ checker: 'bug-detection', id: '', where: { urlPath: '', role: '', breakpoint: '1440px' }, ...f }) as Finding
    )
  );
  const active = problems.filter((p) => !p.toConfirm);
  const counts: Record<FindingSeverity, number> = { Blocker: 0, Major: 0, Minor: 0, Suggestion: 0 };
  for (const p of active) counts[p.severity]++;

  const maxBlockers = gate.maxBlockers ?? 0;
  const maxMajors = gate.maxMajors;
  const maxMinors = gate.maxMinors;

  const blockersBreached = counts.Blocker > maxBlockers;
  const majorsBreached = maxMajors !== undefined && counts.Major > maxMajors;
  const minorsBreached = maxMinors !== undefined && counts.Minor > maxMinors;

  const breaches: string[] = [];
  if (blockersBreached)
    breaches.push(
      `${counts.Blocker} blocker ${counts.Blocker === 1 ? 'problem' : 'problems'} (${maxBlockers} allowed)`
    );
  if (majorsBreached)
    breaches.push(`${counts.Major} major ${counts.Major === 1 ? 'problem' : 'problems'} (${maxMajors} allowed)`);
  if (minorsBreached)
    breaches.push(`${counts.Minor} minor ${counts.Minor === 1 ? 'problem' : 'problems'} (${maxMinors} allowed)`);

  // Area score and grade evaluations per PRD FR-8.2
  const notChecked: AspectType[] = [];
  if (grades) {
    const aspects = grades.aspects;
    const gradeRanks: Record<AspectGrade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
    const minRank = gate.minAreaGrade ? gradeRanks[gate.minAreaGrade] : undefined;

    for (const [name, scoreInfo] of Object.entries(aspects || {}) as Array<
      [AspectType, (typeof aspects)[AspectType]]
    >) {
      if (!scoreInfo || scoreInfo.checked === false || scoreInfo.grade === null) {
        notChecked.push(name);
        continue;
      }
      if (gate.advisoryAreas?.includes(name)) continue;

      if (gate.minAreaScore !== undefined && scoreInfo.score < gate.minAreaScore) {
        breaches.push(`${name} score is ${scoreInfo.score} (minimum ${gate.minAreaScore} required)`);
      }
      if (minRank !== undefined && gradeRanks[scoreInfo.grade] < minRank) {
        breaches.push(`${name} grade is ${scoreInfo.grade} (minimum Grade ${gate.minAreaGrade} required)`);
      }
    }

    if (
      gate.strictAccessibility &&
      aspects?.Accessible &&
      aspects.Accessible.checked !== false &&
      aspects.Accessible.grade !== null
    ) {
      if (aspects.Accessible.grade !== 'A' || aspects.Accessible.score < 90) {
        breaches.push(`Accessible area must achieve Grade A under strict accessibility gating`);
      }
    }
  }
  if (gate.enforceAllAreas && notChecked.length > 0) {
    breaches.push(
      `${notChecked.length} ${notChecked.length === 1 ? 'area' : 'areas'} not checked (every area must be checked)`
    );
  }

  const ready =
    !nothingChecked && !blockersBreached && !majorsBreached && !minorsBreached && breaches.length === 0;
  const mustFix = counts.Blocker + counts.Major;
  const others = counts.Minor + counts.Suggestion;

  const skippedTests = coverage ? coverage.skipped + coverage.blocked : undefined;
  const notRun: string[] = [];
  if (notChecked.length > 0)
    notRun.push(`${notChecked.length} ${notChecked.length === 1 ? 'area' : 'areas'} not checked`);
  if (skippedTests) notRun.push(`${skippedTests} ${skippedTests === 1 ? 'test' : 'tests'} did not run`);
  const notRunText = notRun.length > 0 ? ` Not checked: ${notRun.join(', ')}.` : '';

  let reason = '';
  if (nothingChecked) {
    reason = 'No checks ran.';
  } else if (ready) {
    reason =
      others === 0
        ? 'No problems found.'
        : `Nothing blocks release under active quality gates. ${others} smaller ${others === 1 ? 'problem is' : 'problems are'} worth fixing.`;
  } else {
    reason =
      !customGate && breaches.length === 1 && blockersBreached
        ? `${mustFix} ${mustFix === 1 ? 'problem must' : 'problems must'} be fixed first.`
        : `Quality gate breached: ${breaches.join(' and ')} must be fixed first.`;
  }
  if (!nothingChecked) reason += notRunText;

  return {
    ready,
    stamp: ready ? 'Ready to release' : 'Not ready yet',
    reason,
    counts,
    mustFix,
    total: active.length,
    toConfirm: problems.length - active.length,
    findings: safeFindings.filter(countsTowardVerdict).length,
    gate,
    breaches: breaches.length > 0 ? breaches : undefined,
    notChecked: notChecked.length > 0 ? notChecked : undefined,
    skippedTests: skippedTests || undefined,
  };
}
