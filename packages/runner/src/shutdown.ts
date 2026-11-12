export interface ShutdownDeps {
  /** Stops the run and the server (RunnerServer.shutdown). */
  shutdown: () => Promise<void>;
  exit: (code: number) => void;
  log: (message: string) => void;
  /** Longest the graceful stop may take before the process exits anyway (defaults to 8 s to fit Cloud Run's ~10 s grace). */
  graceMs?: number;
}

export type ShutdownHandler = (reason: string, exitCode: number) => Promise<void>;

/**
 * One graceful shutdown per process. The first call stops the server, then exits with its code. A second call
 * (a second Ctrl+C) exits at once.
 */
export function createShutdown(deps: ShutdownDeps): ShutdownHandler {
  // Cloud Run gives a container about 10 s after SIGTERM before SIGKILL; default to 8 s so shutdown fits within it.
  const graceMs = deps.graceMs ?? 8000;
  let started = false;
  return async (reason, exitCode) => {
    if (started) {
      deps.exit(exitCode);
      return;
    }
    started = true;
    deps.log(`[Release check-up] ${reason}: stopping the check-up and the server.`);
    const force = setTimeout(() => deps.exit(exitCode), graceMs);
    try {
      await deps.shutdown();
    } catch (err) {
      deps.log(`[Release check-up] Shutdown error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(force);
    }
    deps.exit(exitCode);
  };
}
