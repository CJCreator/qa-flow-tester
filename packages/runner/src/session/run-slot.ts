import type { RunnerPhase } from '@qa/types';

/** What holds the run slot: a Check-up, a Competitive Benchmark or a Website Audit. One at a time (DEC-002). */
export type RunKind = 'checkup' | 'benchmark' | 'audit';

export interface RunSlot {
  /** Which kind of run holds the slot; null when it is free. */
  readonly kind: RunKind | null;
  /** The Check-up's state: a benchmark or an audit holding the slot leaves it untouched. */
  readonly isRunning: boolean;
  readonly phase: RunnerPhase;
  readonly runId: string | null;
  readonly targetUrl: string | null;
  /** Bumped by every start; guards events that belong to a run that is over (today's `runGeneration`). */
  readonly generation: number;
  /**
   * Claim the slot for a run, synchronously. False when any run holds it; the one exception is a Check-up
   * awaiting Plan Review, which a new Check-up (and only a Check-up) may replace.
   */
  begin(runId: string, targetUrl: string, kind?: RunKind): boolean;
  /** Give the slot back. */
  release(): void;
  setPhase(phase: RunnerPhase): void;
  setRunId(runId: string | null): void;
  setTargetUrl(targetUrl: string | null): void;
  setGeneration(generation: number): void;
  setIsRunning(isRunning: boolean): void;
  abortController(): AbortController | null;
  setAbortController(controller: AbortController | null): void;
  finishController(): AbortController | null;
  setFinishController(controller: AbortController | null): void;
}

export class DefaultRunSlot implements RunSlot {
  private _isRunning = false;
  private _phase: RunnerPhase = 'idle';
  private _runId: string | null = null;
  private _targetUrl: string | null = null;
  private _generation = 0;
  private _abortController: AbortController | null = null;
  private _finishController: AbortController | null = null;
  /** A benchmark or audit holding the slot. */
  private _other: { kind: Exclude<RunKind, 'checkup'>; runId: string; targetUrl: string } | null = null;

  get isRunning(): boolean {
    return this._isRunning;
  }

  get phase(): RunnerPhase {
    return this._phase;
  }

  get runId(): string | null {
    return this._runId;
  }

  get targetUrl(): string | null {
    return this._targetUrl;
  }

  get generation(): number {
    return this._generation;
  }

  get kind(): RunKind | null {
    return this._other?.kind ?? (this._isRunning ? 'checkup' : null);
  }

  begin(runId: string, targetUrl: string, kind: RunKind = 'checkup'): boolean {
    if (this._other) return false;
    if (this._isRunning && (kind !== 'checkup' || this._phase !== 'awaiting-review')) return false;
    if (kind !== 'checkup') {
      // The Check-up's phase, run id and report stay as they are: status keeps describing the last Check-up.
      this._other = { kind, runId, targetUrl };
      return true;
    }
    this._isRunning = true;
    this._phase = 'scanning';
    this._runId = runId;
    this._targetUrl = targetUrl;
    this._generation++;
    this._abortController = null;
    this._finishController = null;
    return true;
  }

  release(): void {
    if (this._other) {
      this._other = null;
      return;
    }
    this._isRunning = false;
    this._phase = 'idle';
    this._runId = null;
    this._targetUrl = null;
    this._abortController = null;
    this._finishController = null;
  }

  setPhase(phase: RunnerPhase): void {
    this._phase = phase;
    if (phase === 'scanning' || phase === 'testing' || phase === 'awaiting-review') {
      this._isRunning = true;
    } else if (phase === 'idle' || phase === 'done' || phase === 'failed') {
      this._isRunning = false;
    }
  }

  setRunId(runId: string | null): void {
    this._runId = runId;
  }

  setTargetUrl(targetUrl: string | null): void {
    this._targetUrl = targetUrl;
  }

  setGeneration(generation: number): void {
    this._generation = generation;
  }

  setIsRunning(isRunning: boolean): void {
    this._isRunning = isRunning;
  }

  abortController(): AbortController | null {
    return this._abortController;
  }

  setAbortController(controller: AbortController | null): void {
    this._abortController = controller;
  }

  finishController(): AbortController | null {
    return this._finishController;
  }

  setFinishController(controller: AbortController | null): void {
    this._finishController = controller;
  }
}
