import type { Finding } from './index.js';
import { groupIntoProblems, isDismissed, type Problem, type ProblemInput } from './problems.js';

/**
 * One count, live and final (T-389). The live Check-up screen, the report screen, the verdict and every
 * export count problems with this, so their numbers agree. Browser-safe: the wizard imports this file directly.
 *
 * Give it merged findings (core's `mergeDuplicateFindings`): each carries its `issueKey` and `occurrences`.
 */
export interface CountSummary {
  /** Findings as the checks raised them, one per Test point and screen size (the merged ones' occurrences). */
  raw: number;
  /** Findings after the same problem at several sizes, roles and Test points became one. */
  merged: number;
  /** Merged findings someone marked as intended or not a problem. Live: always 0, they are dismissed after the run. */
  dismissed: number;
  /** Merged findings the AI wrote (advisory or the AI review): notes, never counted. */
  advisory: number;
  /** Problems that are an AI guess the site didn't match: not counted until someone confirms them. */
  toConfirm: number;
  /** Problems that count: the verdict's total. */
  problems: number;
  /** The merged findings behind the problems that count. */
  findings: number;
}

export type CountableFinding = Pick<Finding, 'severity' | 'triageStatus' | 'needsConfirmation' | 'title'> &
  Partial<Finding>;

const isAdvisory = (f: Partial<Finding>): boolean => !!f.advisory || f.checker === 'ai-review';

/** The summary, and the problems that count (for the verdict's per-severity counts). */
export function summarizeFindings<F extends CountableFinding>(
  findings?: F[] | null
): { summary: CountSummary; active: Problem<ProblemInput>[] } {
  const all = findings ?? [];
  const safe = all.filter((f) => !isAdvisory(f));
  const grouped = groupIntoProblems(
    safe.map((f): ProblemInput => ({
      checker: 'bug-detection',
      where: { urlPath: '', role: '', breakpoint: '1440px' },
      ...f,
    }))
  );
  const active = grouped.filter((p) => !p.toConfirm);
  return {
    summary: {
      raw: all.reduce((n, f) => n + Math.max(1, f.occurrences ?? 1), 0),
      merged: all.length,
      dismissed: all.filter((f) => isDismissed(f)).length,
      advisory: all.filter((f) => !isDismissed(f) && isAdvisory(f)).length,
      toConfirm: grouped.length - active.length,
      problems: active.length,
      findings: safe.filter((f) => !isDismissed(f) && !f.needsConfirmation).length,
    },
    active,
  };
}

/** The counts from `findings` (merged): see `CountSummary`. */
export function countSummary(findings?: CountableFinding[] | null): CountSummary {
  return summarizeFindings(findings).summary;
}

/**
 * The breakdown line under "Problems that count": "142 raw → 61 merged → 9 dismissed, 4 AI notes, 3 to confirm → 45".
 * `live`: during the run, before suppressions are applied, so dismissals are named as coming after the run.
 */
export function countBreakdown(summary: CountSummary, options: { live?: boolean } = {}): string {
  const dismissed = options.live ? 'dismissed after the run' : `${summary.dismissed} dismissed`;
  return (
    `${summary.raw} raw → ${summary.merged} merged → ${dismissed}, ` +
    `${summary.advisory} AI ${summary.advisory === 1 ? 'note' : 'notes'}, ${summary.toConfirm} to confirm → ` +
    `${summary.problems}`
  );
}

/** The label every headline count uses. */
export const PROBLEMS_THAT_COUNT = 'Problems that count';

/** The one count line every export prints (T-391): "Problems that count: 45 (142 raw → … → 45)". */
export function problemsThatCountLine(summary: CountSummary): string {
  return `${PROBLEMS_THAT_COUNT}: ${summary.problems} (${countBreakdown(summary)})`;
}
