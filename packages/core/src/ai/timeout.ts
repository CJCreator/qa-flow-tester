/**
 * Request deadline for AI Provider calls (RISK-005): a hung AI service must not hold the single run slot.
 * Every provider fetch gets a signal that aborts when the caller cancels or when the deadline passes.
 */

/** Default deadline for one AI request, in milliseconds. */
export const AI_REQUEST_TIMEOUT_MS = 120_000;

/** Largest delay setTimeout accepts; longer values would fire at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** The AI service did not answer within the deadline. */
export class AITimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = 'AITimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface RequestSignalOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RequestScope {
  signal: AbortSignal;
  /** Call when the request is finished (success or failure): clears the deadline timer and the caller-signal listener. */
  release: () => void;
}

function deadlineMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return AI_REQUEST_TIMEOUT_MS;
  }
  return Math.min(timeoutMs, MAX_TIMER_MS);
}

/**
 * One signal for a provider request: the caller's `signal` (if any) combined with the deadline
 * (`timeoutMs`, default AI_REQUEST_TIMEOUT_MS). When the deadline passes, the signal's reason is an
 * AITimeoutError.
 *
 * The deadline uses an unref'd setTimeout rather than AbortSignal.timeout: the effect is the same,
 * it does not keep the process alive, and it follows the test clock (fake timers).
 */
export function requestSignal(options: RequestSignalOptions = {}): RequestScope {
  const ms = deadlineMs(options.timeoutMs);
  const deadline = new AbortController();
  const timer = setTimeout(() => {
    deadline.abort(new AITimeoutError(`The AI service did not answer within ${ms} ms.`, ms));
  }, ms);
  (timer as { unref?: () => void }).unref?.();
  const caller = options.signal;
  if (!caller) return { signal: deadline.signal, release: () => clearTimeout(timer) };
  // Stop the deadline timer once the caller cancels; nothing is left waiting on it.
  const onCallerAbort = () => clearTimeout(timer);
  caller.addEventListener('abort', onCallerAbort, { once: true });
  return {
    signal: AbortSignal.any([caller, deadline.signal]),
    release: () => {
      clearTimeout(timer);
      caller.removeEventListener('abort', onCallerAbort);
    },
  };
}

/**
 * Maps an error thrown while `signal` was in use. A passed deadline becomes AITimeoutError and a
 * caller cancel becomes an AbortError (DOMException); any other error is returned unchanged.
 * Messages name only the provider and the deadline, never the request URL or key.
 */
export function requestError(err: unknown, signal: AbortSignal, provider: string): unknown {
  if (!signal.aborted) return err;
  const reason: unknown = signal.reason;
  if (reason instanceof AITimeoutError) {
    return new AITimeoutError(`${provider} did not answer within ${reason.timeoutMs} ms.`, reason.timeoutMs);
  }
  return new DOMException(`The ${provider} request was cancelled.`, 'AbortError');
}
