import type { AuditStoreBackend } from '@qa/core';

/** Where the counts that must survive a restart are kept in the audit store (T-301). */
export const USAGE_KEY = 'limits/usage.json';

/** Today's copy-wide check-up starts and Website Audit starts per owner key (ownerKey, a hash, never an email). */
export interface StoredUsage {
  day: string;
  copyStarts: number;
  auditStarts: Record<string, number>;
}

const isWhole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function isStoredUsage(value: unknown, day: string): value is StoredUsage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.day !== day || !isWhole(v.copyStarts)) return false;
  if (typeof v.auditStarts !== 'object' || v.auditStarts === null || Array.isArray(v.auditStarts)) return false;
  return Object.values(v.auditStarts as Record<string, unknown>).every(isWhole);
}

export class UsageLedger {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly backend: Pick<AuditStoreBackend, 'getJson' | 'putJson'>) {}

  /** The stored counts for `day`, or null when there are none for that day, or they cannot be read. */
  async load(day: string): Promise<StoredUsage | null> {
    try {
      const stored = await this.backend.getJson<unknown>(USAGE_KEY);
      return isStoredUsage(stored, day) ? stored : null;
    } catch {
      console.error('[Release check-up] Couldn’t read the saved usage counts; starting from zero.');
      return null;
    }
  }

  /** Queues a write of the latest counts, one write at a time. A failure is logged with fixed text, never thrown. */
  save(usage: StoredUsage): Promise<void> {
    this.queue = this.queue
      .then(() => this.backend.putJson(USAGE_KEY, usage))
      .catch(() => {
        console.error('[Release check-up] Couldn’t save the usage counts.');
      });
    return this.queue;
  }

  /** Resolves when every queued write has finished (tests, shutdown). */
  flush(): Promise<void> {
    return this.queue;
  }
}
