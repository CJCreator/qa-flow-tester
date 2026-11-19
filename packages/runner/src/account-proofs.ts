import type { AuditStoreBackend } from '@qa/core';
import { accountHash } from './account-usage.js';

/**
 * Verified Domain proof that follows the account (ADR 0050, T-435): once an account has shown it controls a
 * site (ADR 0014), `{account, host, verifiedAt}` is saved at `proofs/<account hash>/<host>.json` in the audit
 * store, so a cold start does not lose it. After 30 days the proof is checked live again. The saved record
 * never replaces the rules of ADR 0014 (public address, marked, exact origin); it replaces only the fetch.
 */

export const PROOF_VALID_DAYS = 30;

/** What is saved. `account` is the hash, never the email. */
export interface ProofRecord {
  account: string;
  host: string;
  verifiedAt: string;
}

/** A host as a store-safe file name: only [A-Za-z0-9._-]. */
export function proofFileHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '_');
}

export function proofKey(email: string, host: string): string {
  return `proofs/${accountHash(email)}/${proofFileHost(host)}.json`;
}

export class AccountProofs {
  constructor(
    private readonly backend: Pick<AuditStoreBackend, 'getJson' | 'putJson'>,
    private readonly now: () => number = Date.now
  ) {}

  /** Has this account proved this host within the last 30 days? Unreadable or malformed means no. */
  async valid(email: string, host: string): Promise<boolean> {
    try {
      const record = await this.backend.getJson<unknown>(proofKey(email, host));
      if (typeof record !== 'object' || record === null) return false;
      const r = record as Record<string, unknown>;
      if (r.account !== accountHash(email) || r.host !== proofFileHost(host) || typeof r.verifiedAt !== 'string') {
        return false;
      }
      const at = Date.parse(r.verifiedAt);
      if (!Number.isFinite(at)) return false;
      const age = this.now() - at;
      return age >= 0 && age < PROOF_VALID_DAYS * 86_400_000;
    } catch {
      return false;
    }
  }

  /** Saves a proof that just passed. A failure is logged with fixed text and never thrown. */
  async save(email: string, host: string): Promise<void> {
    const record: ProofRecord = {
      account: accountHash(email),
      host: proofFileHost(host),
      verifiedAt: new Date(this.now()).toISOString(),
    };
    try {
      await this.backend.putJson(proofKey(email, host), record);
    } catch {
      console.error('[Release check-up] Couldn’t save a Verified Domain proof.');
    }
  }
}
