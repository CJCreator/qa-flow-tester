import type { Finding } from './index.js';

/** Version of the findings.json contract (docs/adr/0017-findings-contract.md). A file without it is version 0. */
export const FINDINGS_SCHEMA_VERSION = 1;

/** A finding that counts: not an unconfirmed AI guess, and not triaged Intended or False Positive. */
export function isActiveFinding(f: Pick<Finding, 'needsConfirmation' | 'triageStatus'>): boolean {
  return !f.needsConfirmation && f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive';
}
