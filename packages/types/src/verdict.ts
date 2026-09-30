import type { Finding, FindingSeverity } from './index.js';

/**
 * The one verdict a report gives: ready to release, or not yet, and why. The screens, report.html
 * and report.md all use it, so they never disagree. Findings someone marked as intended or a false
 * positive don't count, and neither do unconfirmed AI guesses (they're listed as "to confirm").
 */
export interface ReleaseVerdict {
  ready: boolean;
  /** The words on the stamp. */
  stamp: 'Ready to release' | 'Not ready yet';
  /** Why, in one sentence, e.g. "2 problems must be fixed first." */
  reason: string;
  /** Problems that count, by how serious they are. */
  counts: Record<FindingSeverity, number>;
  /** Blockers and Majors: what must be fixed before release. */
  mustFix: number;
  /** Every problem that counts. */
  total: number;
  /** Unconfirmed AI guesses the site didn't match. */
  toConfirm: number;
}

export function countsTowardVerdict(f: Pick<Finding, 'triageStatus' | 'needsConfirmation'>): boolean {
  return f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive' && !f.needsConfirmation;
}

export function releaseVerdict(findings: Array<Pick<Finding, 'severity' | 'triageStatus' | 'needsConfirmation'>>): ReleaseVerdict {
  const untriaged = findings.filter((f) => f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive');
  const active = untriaged.filter((f) => !f.needsConfirmation);
  const counts: Record<FindingSeverity, number> = { Blocker: 0, Major: 0, Minor: 0, Suggestion: 0 };
  for (const f of active) counts[f.severity]++;
  const mustFix = counts.Blocker + counts.Major;
  const ready = mustFix === 0;
  const others = counts.Minor + counts.Suggestion;
  const reason = ready
    ? others === 0
      ? 'No problems found.'
      : `Nothing blocks release. ${others} smaller ${others === 1 ? 'problem is' : 'problems are'} worth fixing.`
    : `${mustFix} ${mustFix === 1 ? 'problem must' : 'problems must'} be fixed first.`;
  return {
    ready,
    stamp: ready ? 'Ready to release' : 'Not ready yet',
    reason,
    counts,
    mustFix,
    total: active.length,
    toConfirm: untriaged.length - active.length,
  };
}
