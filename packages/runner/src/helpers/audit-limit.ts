/**
 * Daily limit of audit starts per owner email per UTC day (T-86, ADR 0042).
 * Unset means unlimited. When set, exceeding it answers 429 ERR_BETA_LIMIT.
 */
import { createHash } from 'crypto';

/** The key an owner email is counted (and stored) under: SHA-256 of the trimmed, lower-cased email. */
export function ownerKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

export interface AuditLimitOutcome {
  allowed: boolean;
  error?: string;
  resetsAt?: string;
}

export class AuditDailyLimiter {
  private limit?: number;
  private usage = new Map<string, { day: string; count: number }>();
  private readonly now: () => number;

  constructor(options: { limit?: number; now?: () => number } = {}) {
    this.limit = options.limit !== undefined && options.limit > 0 ? options.limit : undefined;
    this.now = options.now ?? Date.now;
  }

  claim(email?: string): AuditLimitOutcome {
    if (!this.limit) return { allowed: true };
    if (!email) return { allowed: true };
    const key = ownerKey(email);
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    let record = this.usage.get(key);
    if (!record || record.day !== day) {
      record = { day, count: 0 };
      this.usage.set(key, record);
    }
    if (record.count >= this.limit) {
      const reset = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
      const hours = Math.max(1, Math.ceil((reset - now) / 3_600_000));
      const inAbout = `in about ${hours} hour${hours === 1 ? '' : 's'}`;
      return {
        allowed: false,
        resetsAt: new Date(reset).toISOString(),
        error: `You have used your ${this.limit} audit starts for today on this shared copy. The limit resets at 00:00 UTC (${inAbout}).`,
      };
    }
    record.count++;
    return { allowed: true };
  }

  /** Today's counts per owner key, for the usage ledger (T-301). */
  snapshot(day: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, record] of this.usage) if (record.day === day) out[key] = record.count;
    return out;
  }

  /** Puts back stored counts for `day`; a count already higher in memory is kept. */
  restore(day: string, counts: Record<string, number>): void {
    for (const [key, count] of Object.entries(counts)) {
      const known = this.usage.get(key);
      if (!known || known.day !== day || known.count < count) this.usage.set(key, { day, count });
    }
  }
}
