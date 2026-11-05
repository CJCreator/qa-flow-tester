/**
 * Replay cap: the newest 200 events of a run are kept for a reconnecting page (M9). The server used to carry an
 * unused 5000 that suggested a larger log; it is gone.
 */
export const MAX_RUN_EVENTS = 200;

export interface RunEvents {
  /** This run's events, oldest first, capped at MAX_RUN_EVENTS; replayed to a reconnecting page. */
  readonly log: ReadonlyArray<Record<string, unknown>>;
  /** Append, drop the oldest past the cap, and notify subscribers (today's `recordRunEvent` + broadcast). */
  publish(event: Record<string, unknown>): void;
  /** Subscribe a transport (the SSE branch) to new events; returns the unsubscribe function. */
  subscribe(listener: (event: Record<string, unknown>) => void): () => void;
  /** Forget the run's events (reset when a run starts). */
  clear(): void;
}

export class DefaultRunEvents implements RunEvents {
  private _log: Array<Record<string, unknown>> = [];
  private readonly listeners = new Set<(event: Record<string, unknown>) => void>();

  get log(): ReadonlyArray<Record<string, unknown>> {
    return this._log;
  }

  publish(event: Record<string, unknown>): void {
    this._log.push(event);
    if (this._log.length > MAX_RUN_EVENTS) {
      this._log.shift();
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // transport listeners should not crash event publishing
      }
    }
  }

  subscribe(listener: (event: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this._log = [];
  }
}
