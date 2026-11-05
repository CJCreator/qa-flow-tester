import { AsyncLocalStorage } from 'async_hooks';

export interface HostPacerOptions {
  /** Least pause between one request to a host and the next (default 0). */
  minGapMs?: number;
  /** The site's robots.txt Crawl-delay (RobotsPolicy.crawlDelayMs); the larger of the two is used. */
  crawlDelayMs?: number;
  /** Clock seam for tests (default Date.now). */
  now?: () => number;
  /** Timer seam for tests: resolves after `ms`, rejects once `signal` aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Tasks one host may run at once (default 1: ADR 0015's one at a time). Above 1 (the Website Audit, ADR 0043)
   * the gap spaces task starts instead of end-to-start. A robots Crawl-delay, or `slowDown`, keeps the host at 1.
   */
  maxInFlight?: number;
}

/** The longest `Retry-After` waited out (ADR 0043). */
export const MAX_RETRY_AFTER_MS = 60_000;
/** A host that says it is busy again gets twice the gap, up to this (ADR 0043). */
export const MAX_SLOWED_GAP_MS = 10_000;

interface Lane {
  /** Tasks running now. */
  active: number;
  /** Tasks allowed at once; drops to 1 for good once the host says it is busy. */
  max: number;
  /** The pause for this host; grows when the host says it is busy more than once. */
  gapMs: number;
  /** When the last task on this host finished; undefined before the first. */
  lastEndAt?: number;
  /** When the last task started (or is booked to start): spaces starts while several may run. */
  lastStartAt?: number;
  /** No task starts before this (a host's Retry-After). */
  notBefore?: number;
  /** How often the host said it was busy. */
  slowDowns: number;
  waiters: Array<() => void>;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Requests to a host take turns, with a pause between them (ADR 0015: robots.txt Crawl-delay honoured).
 * By default one at a time: `run(host, task)` waits until no other task for that host is running and the gap
 * since the last one ended has passed, then runs `task`. With `maxInFlight` above 1 (ADR 0043) up to that many
 * run at once and the gap spaces their starts. Hosts are independent. A task already holding a host's turn
 * that calls `run` for the same host again (a paced fetch inside a paced page load) runs straight away
 * instead of waiting for itself.
 */
export class HostPacer {
  /** max(minGapMs, crawlDelayMs): the pause between one task on a host and the next. */
  readonly gapMs: number;
  /** Tasks one host may run at once before any `slowDown`: 1 when robots.txt sets a Crawl-delay. */
  readonly maxInFlight: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly lanes = new Map<string, Lane>();
  private readonly held = new AsyncLocalStorage<Set<string>>();

  constructor(opts: HostPacerOptions = {}) {
    this.gapMs = Math.max(0, opts.minGapMs ?? 0, opts.crawlDelayMs ?? 0);
    const wanted = Math.max(1, Math.floor(opts.maxInFlight ?? 1));
    // A site that asks for a Crawl-delay is read one page at a time (ADR 0043).
    this.maxInFlight = (opts.crawlDelayMs ?? 0) > 0 ? 1 : wanted;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /**
   * The host answered 429 or 503 (ADR 0043): from now on one task at a time, nothing starts before its
   * `Retry-After` (capped at 60 s), and a second time doubles the gap (capped at 10 s).
   */
  slowDown(host: string, retryAfterMs?: number): void {
    const lane = this.laneFor(host.toLowerCase());
    lane.max = 1;
    lane.slowDowns++;
    if (lane.slowDowns > 1) lane.gapMs = Math.min(MAX_SLOWED_GAP_MS, Math.max(lane.gapMs * 2, this.gapMs, 1));
    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      const until = this.now() + Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
      lane.notBefore = Math.max(lane.notBefore ?? 0, until);
    }
  }

  /** How many tasks the host may run at once now (tests and progress). */
  inFlightLimit(host: string): number {
    return this.lanes.get(host.toLowerCase())?.max ?? this.maxInFlight;
  }

  /**
   * Runs `task` in `host`'s turn. Rejects with the signal's reason when `signal` aborts while waiting
   * (the task is then never started); a task that throws still releases the turn.
   */
  async run<T>(host: string, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const key = host.toLowerCase();
    const outer = this.held.getStore();
    if (outer?.has(key)) return task();

    const lane = this.laneFor(key);
    await this.acquire(lane, signal);
    const mine = new Set(outer ?? []);
    mine.add(key);
    let started = false;
    try {
      // One at a time: the gap runs from the last task's end. Several at once: each start is booked a gap
      // after the previous start, before sleeping, so tasks that got a slot together still start apart.
      const startAt =
        lane.max <= 1
          ? Math.max(lane.lastEndAt === undefined ? 0 : lane.lastEndAt + lane.gapMs, lane.notBefore ?? 0)
          : Math.max(
              this.now(),
              lane.lastStartAt === undefined ? 0 : lane.lastStartAt + lane.gapMs,
              lane.notBefore ?? 0
            );
      if (lane.max > 1) lane.lastStartAt = startAt;
      // The clock is read again after each sleep, so a timer that fires early never shortens the gap.
      for (;;) {
        const waitMs = startAt - this.now();
        if (waitMs <= 0) break;
        await this.sleep(waitMs, signal);
      }
      if (signal?.aborted) throw abortReason(signal);
      started = true;
      lane.lastStartAt = Math.max(lane.lastStartAt ?? 0, this.now());
      return await this.held.run(mine, task);
    } finally {
      // Work the task left running after it settled no longer counts as holding the turn.
      mine.delete(key);
      if (started) lane.lastEndAt = this.now();
      this.release(lane);
    }
  }

  private laneFor(key: string): Lane {
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { active: 0, max: this.maxInFlight, gapMs: this.gapMs, slowDowns: 0, waiters: [] };
      this.lanes.set(key, lane);
    }
    return lane;
  }

  private acquire(lane: Lane, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (lane.active < lane.max && lane.waiters.length === 0) {
      lane.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        lane.waiters = lane.waiters.filter((w) => w !== wake);
        reject(abortReason(signal!));
      };
      const wake = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      lane.waiters.push(wake);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Frees the slot and hands free slots straight to the next waiters (fewer once the host was slowed down). */
  private release(lane: Lane): void {
    lane.active--;
    while (lane.active < lane.max && lane.waiters.length > 0) {
      lane.active++;
      lane.waiters.shift()!();
    }
  }
}
