import { createHash } from 'crypto';
import type { AuditStoreBackend } from '@qa/core';

/**
 * Per-account daily Check-up counts (ADR 0050, T-435), kept through the audit store backend like the usage
 * ledger so a cold start does not reset them. One object per account per UTC day:
 * `usage/accounts/<day>/<hash>.json`, where the hash is a SHA-256 of the lower-cased email (never the email).
 * The counts are cached in memory after the first read; a write follows every change, one at a time.
 */

export const ACCOUNT_USAGE_PREFIX = 'usage/accounts';

/** The hashed, store-safe name of an account: 32 hex characters of SHA-256 of the lower-cased email. */
export function accountHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex').slice(0, 32);
}

export function accountUsageKey(day: string, email: string): string {
  return `${ACCOUNT_USAGE_PREFIX}/${day}/${accountHash(email)}.json`;
}

const isWhole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export class AccountUsage {
  private readonly counts = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly backend: Pick<AuditStoreBackend, 'getJson' | 'putJson'>) {}

  /** Reads the account's count for `day` from the store into the cache (once). Unreadable counts as zero. */
  async load(day: string, email: string): Promise<void> {
    const key = accountUsageKey(day, email);
    if (this.counts.has(key)) return;
    let count = 0;
    try {
      const stored = await this.backend.getJson<unknown>(key);
      if (typeof stored === 'object' && stored !== null) {
        const v = stored as Record<string, unknown>;
        if (v.day === day && isWhole(v.count)) count = v.count;
      }
    } catch {
      console.error('[Release check-up] Couldn’t read an account’s saved usage; starting from zero.');
    }
    // A count added while the read was in flight is kept.
    this.counts.set(key, Math.max(count, this.counts.get(key) ?? 0));
  }

  /** The cached count; call `load` first. */
  count(day: string, email: string): number {
    return this.counts.get(accountUsageKey(day, email)) ?? 0;
  }

  /** Adds one start to the cache and queues a write. Synchronous, so a check and its count cannot be split. */
  increment(day: string, email: string): void {
    const key = accountUsageKey(day, email);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    this.queue = this.queue
      .then(() => this.backend.putJson(key, { day, count }))
      .catch(() => {
        console.error('[Release check-up] Couldn’t save an account’s usage.');
      });
  }

  /** Forgets cached counts of other days, so the cache stays small. */
  dropOtherDays(day: string): void {
    for (const key of this.counts.keys())
      if (!key.startsWith(`${ACCOUNT_USAGE_PREFIX}/${day}/`)) this.counts.delete(key);
  }

  flush(): Promise<void> {
    return this.queue;
  }
}
