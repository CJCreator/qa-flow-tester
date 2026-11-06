/**
 * Replay cap: the newest 200 events of a run are kept for a reconnecting page (M9). The server used to carry an
 * unused 5000 that suggested a larger log; it is gone.
 */
export const MAX_RUN_EVENTS = 200;

/** One retained event with the id the SSE stream sends as `id:` (LAT-10). */
export interface RunEventEntry {
  readonly id: number;
  readonly event: Record<string, unknown>;
}

export interface RunEvents {
  /** This run's events, oldest first, capped at MAX_RUN_EVENTS; replayed to a reconnecting page. */
  readonly log: ReadonlyArray<Record<string, unknown>>;
  /** Append, drop the oldest past the cap, and notify subscribers (today's `recordRunEvent` + broadcast). Returns the event's id. */
  publish(event: Record<string, unknown>): number;
  /** The id `publish` gave this event object, or undefined when it was never published here. */
  idOf(event: object): number | undefined;
  /**
   * Retained events with an id after `afterId`, oldest first. If `afterId` is older than the cap, this returns
   * only what remains: the events that fell off the replay cap are gone, and the caller is not told about the gap.
   */
  since(afterId: number): ReadonlyArray<RunEventEntry>;
  /** The id of the newest event published in this process (0 before any). Never reset: ids stay unique per process. */
  readonly lastId: number;
  /** Subscribe a transport (the SSE branch) to new events; returns the unsubscribe function. */
  subscribe(listener: (event: Record<string, unknown>) => void): () => void;
  /** Forget the run's events (reset when a run starts). Ids keep counting up. */
  clear(): void;
}

export class DefaultRunEvents implements RunEvents {
  private _log: Array<Record<string, unknown>> = [];
  private _ids: number[] = [];
  private _lastId = 0;
  private readonly idByEvent = new WeakMap<object, number>();
  private readonly listeners = new Set<(event: Record<string, unknown>) => void>();

  get log(): ReadonlyArray<Record<string, unknown>> {
    return this._log;
  }

  get lastId(): number {
    return this._lastId;
  }

  publish(event: Record<string, unknown>): number {
    const id = ++this._lastId;
    this._log.push(event);
    this._ids.push(id);
    this.idByEvent.set(event, id);
    if (this._log.length > MAX_RUN_EVENTS) {
      this._log.shift();
      this._ids.shift();
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // transport listeners should not crash event publishing
      }
    }
    return id;
  }

  idOf(event: object): number | undefined {
    return this.idByEvent.get(event);
  }

  since(afterId: number): ReadonlyArray<RunEventEntry> {
    const out: RunEventEntry[] = [];
    for (let i = 0; i < this._log.length; i++) {
      if (this._ids[i] > afterId) out.push({ id: this._ids[i], event: this._log[i] });
    }
    return out;
  }

  subscribe(listener: (event: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this._log = [];
    this._ids = [];
  }
}
