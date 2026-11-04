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
}

interface Lane {
  busy: boolean;
  /** When the last task on this host finished; undefined before the first. */
  lastEndAt?: number;
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
 * One request at a time per host, with a pause between them (ADR 0015: robots.txt Crawl-delay honoured).
 * `run(host, task)` waits until no other task for that host is running and the gap since the last one
 * ended has passed, then runs `task`. Hosts are independent. A task already holding a host's turn that
 * calls `run` for the same host again (a paced fetch inside a paced page load) runs straight away instead
 * of waiting for itself.
 */
export class HostPacer {
  /** max(minGapMs, crawlDelayMs): the pause between one task on a host ending and the next starting. */
  readonly gapMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly lanes = new Map<string, Lane>();
  private readonly held = new AsyncLocalStorage<Set<string>>();

  constructor(opts: HostPacerOptions = {}) {
    this.gapMs = Math.max(0, opts.minGapMs ?? 0, opts.crawlDelayMs ?? 0);
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
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
      // The clock is read again after each sleep, so a timer that fires early never shortens the gap.
      for (;;) {
        const waitMs = lane.lastEndAt === undefined ? 0 : lane.lastEndAt + this.gapMs - this.now();
        if (waitMs <= 0) break;
        await this.sleep(waitMs, signal);
      }
      if (signal?.aborted) throw abortReason(signal);
      started = true;
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
      lane = { busy: false, waiters: [] };
      this.lanes.set(key, lane);
    }
    return lane;
  }

  private acquire(lane: Lane, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (!lane.busy) {
      lane.busy = true;
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

  /** Hands the turn straight to the next waiter, or frees the lane. */
  private release(lane: Lane): void {
    const next = lane.waiters.shift();
    if (next) next();
    else lane.busy = false;
  }
}
