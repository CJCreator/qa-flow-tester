/** What POST /api/runner/abort answered, as api.ts abortRun returns it. */
export interface StopReply {
  aborted: boolean;
  /** The run was asked to finish with the work so far: the plan or the partial report follows. */
  finishing?: boolean;
  planKept?: boolean;
  error?: string;
}

export const NOTHING_STOPPED = 'Nothing was stopped. The check-up may have already finished.';

/** The message for a stop that did nothing, or null when it worked: stopped, or finishing with the work so far. */
export function stopProblem(reply: StopReply): string | null {
  if (reply.aborted || reply.finishing) return null;
  return reply.error ?? NOTHING_STOPPED;
}
