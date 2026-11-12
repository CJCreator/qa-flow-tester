import type { Finding } from './index.js';

/** Version of the findings.json contract (docs/adr/0017-findings-contract.md). A file without it is version 0. */
export const FINDINGS_SCHEMA_VERSION = 2;

/**
 * A finding that counts: not an unconfirmed guess, not triaged Intended or False Positive, not advisory,
 * and not from the AI review. The same rule as `countsTowardVerdict` (verdict.ts), so the CI counts and
 * the fix list agree with the Release Verdict.
 */
export function isActiveFinding(
  f: Pick<Finding, 'needsConfirmation' | 'triageStatus'> & Partial<Pick<Finding, 'advisory' | 'checker'>>
): boolean {
  return (
    !f.needsConfirmation &&
    f.triageStatus !== 'Intended' &&
    f.triageStatus !== 'False Positive' &&
    !f.advisory &&
    f.checker !== 'ai-review'
  );
}
