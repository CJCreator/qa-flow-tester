/**
 * Stopping a scan or a test run. The runner hands an AbortSignal down; the crawler, the planner and
 * the orchestrator check it between pages, AI requests and test points, and give up with an
 * AbortError, closing their browser on the way out.
 */

export const RUN_STOPPED = 'The run was stopped.';

export function abortError(): Error {
  return Object.assign(new Error(RUN_STOPPED), { name: 'AbortError', code: 'ERR_RUN_ABORTED' });
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || (err as { code?: string }).code === 'ERR_RUN_ABORTED');
}

/** Throws an AbortError when the signal says stop. */
export function stopIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
