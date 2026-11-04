import type { AuditProgressEvent } from '@qa/types';

/** Gets every event of one Website Audit run, starting with the last one sent before it subscribed. */
export type AuditRunListener = (event: AuditProgressEvent) => void;

function isTerminal(event: AuditProgressEvent): boolean {
  return event.type === 'done' || event.type === 'failed';
}

/**
 * One Website Audit version while it runs, and for a while after: its stop control, its last progress event
 * and the streams following it. A late subscriber first gets the last event (REQ-003). After 'done' or
 * 'failed' nothing more is sent.
 */
export class AuditRun {
  readonly auditId: string;
  readonly version: number;
  readonly controller = new AbortController();
  private last: AuditProgressEvent;
  private readonly listeners = new Set<AuditRunListener>();
  private ended = false;

  constructor(auditId: string, version: number) {
    this.auditId = auditId;
    this.version = version;
    // The address check passed before the run exists; this is where a stream opened right after 202 starts.
    this.last = {
      type: 'progress',
      auditId,
      version,
      stage: 'checking-address',
      pagesFound: 0,
      pagesRecorded: 0,
      pagesSkipped: 0,
    };
  }

  get lastEvent(): AuditProgressEvent {
    return this.last;
  }

  /** True once 'done' or 'failed' was sent. */
  get finished(): boolean {
    return this.ended;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Records the event as the last one and sends it to every subscriber. Ignored once the run has ended. */
  emit(event: AuditProgressEvent): void {
    if (this.ended) return;
    this.last = event;
    if (isTerminal(event)) this.ended = true;
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // One broken stream must not stop the others.
      }
    }
    if (this.ended) this.listeners.clear();
  }

  /** Sends the last event now, then every later one. Returns the unsubscribe function. */
  subscribe(listener: AuditRunListener): () => void {
    listener(this.last);
    if (this.ended) return () => undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Asks the run to stop; the run itself records the outcome. */
  stop(): void {
    this.controller.abort();
  }
}

/** Finished runs kept for late subscribers. One run at a time holds the RunSlot, so this stays small. */
export const KEEP_FINISHED_AUDIT_RUNS = 20;

/** The Website Audit runs this runner started, by audit id: the running one and the last few that ended. */
export class AuditRuns {
  private readonly runs = new Map<string, AuditRun>();

  constructor(private readonly keepFinished: number = KEEP_FINISHED_AUDIT_RUNS) {}

  /** Registers a new run of this audit's version; it replaces an earlier run of the same audit. */
  start(auditId: string, version: number): AuditRun {
    const run = new AuditRun(auditId, version);
    this.runs.delete(auditId);
    this.runs.set(auditId, run);
    this.prune();
    return run;
  }

  get(auditId: string): AuditRun | undefined {
    return this.runs.get(auditId);
  }

  /** The run that has not ended yet, if any. */
  get active(): AuditRun | undefined {
    for (const run of this.runs.values()) if (!run.finished) return run;
    return undefined;
  }

  private prune(): void {
    const finished = [...this.runs.values()].filter((r) => r.finished);
    // Map order is insertion order: the oldest finished runs go first.
    for (let i = 0; i < finished.length - this.keepFinished; i++) this.runs.delete(finished[i].auditId);
  }
}
