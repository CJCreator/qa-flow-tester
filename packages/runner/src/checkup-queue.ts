/**
 * The waiting line for the single Check-up slot (ADR 0050, T-436). A signed-in account that starts a Check-up
 * while the slot is busy joins this first-in-first-out line instead of getting a 409. In memory only: it does
 * not survive a restart, like the slot itself. One place per account; a second start replaces the first.
 */

/** Most places in the line. */
export const QUEUE_MAX = 10;
/** An entry whose account has not asked the status for this long is dropped (the tab is gone). */
export const QUEUE_ABSENCE_MS = 10 * 60 * 1000;

export interface QueueEntry {
  /** Lower-cased account email. */
  account: string;
  /** The visitor session the start belongs to (holds the AI key); the run starts inside it. */
  sessionId: string | undefined;
  /** The run-start body as JSON text. */
  bodyText: string;
  /** The request's Cookie header, so the later start is the same signed-in visitor. */
  cookie: string | undefined;
  /** The caller's socket address, for the stand-in request. */
  remoteAddress: string | undefined;
  host: string | undefined;
  lastPoll: number;
}

export type JoinResult = { joined: true; position: number } | { joined: false; reason: 'full' };

export class CheckupQueue {
  private entries: QueueEntry[] = [];

  constructor(
    private readonly max: number = QUEUE_MAX,
    private readonly absenceMs: number = QUEUE_ABSENCE_MS
  ) {}

  get length(): number {
    return this.entries.length;
  }

  /** Joins the line, or replaces this account's entry in place (it keeps its place). */
  join(entry: QueueEntry): JoinResult {
    const at = this.entries.findIndex((e) => e.account === entry.account);
    if (at >= 0) {
      this.entries[at] = entry;
      return { joined: true, position: at + 1 };
    }
    if (this.entries.length >= this.max) return { joined: false, reason: 'full' };
    this.entries.push(entry);
    return { joined: true, position: this.entries.length };
  }

  /** The account's place (1 is next), or null when it is not in the line. */
  position(account: string): number | null {
    const at = this.entries.findIndex((e) => e.account === account);
    return at < 0 ? null : at + 1;
  }

  /** The account asked the status: it is still here. Returns its place, or null. */
  touch(account: string, now: number = Date.now()): number | null {
    const at = this.entries.findIndex((e) => e.account === account);
    if (at < 0) return null;
    this.entries[at].lastPoll = now;
    return at + 1;
  }

  /** Leaves the line. True when the account was in it. */
  leave(account: string): boolean {
    const at = this.entries.findIndex((e) => e.account === account);
    if (at < 0) return false;
    this.entries.splice(at, 1);
    return true;
  }

  /** Drops entries whose account has been away longer than the limit. Returns how many. */
  prune(now: number = Date.now()): number {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => now - e.lastPoll < this.absenceMs);
    return before - this.entries.length;
  }

  /** The next entry, without taking it. */
  peek(): QueueEntry | undefined {
    return this.entries[0];
  }

  /** Takes the next entry. */
  shift(): QueueEntry | undefined {
    return this.entries.shift();
  }

  /** Puts an entry back at the front (the slot was not free after all). */
  unshift(entry: QueueEntry): void {
    this.entries.unshift(entry);
  }

  clear(): void {
    this.entries = [];
  }
}
