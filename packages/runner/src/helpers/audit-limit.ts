/**
 * Daily limit of audit starts per owner email per UTC day (T-86, ADR 0042).
 * Unset means unlimited. When set, exceeding it answers 429 ERR_BETA_LIMIT.
 */

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
    const norm = email.trim().toLowerCase();
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    let record = this.usage.get(norm);
    if (!record || record.day !== day) {
      record = { day, count: 0 };
      this.usage.set(norm, record);
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
}
