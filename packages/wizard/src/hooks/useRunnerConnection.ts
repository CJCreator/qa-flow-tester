import { useEffect, useState } from 'react';
import { getStatus } from '../api';

export const POLL_INTERVAL_MS = 3000;
export const MAX_POLL_INTERVAL_MS = 30000;

/** The pause before the next check after `misses` failed checks in a row: 3 s, 6 s, 12 s, 24 s, then 30 s. */
export function nextCheckDelayMs(misses: number): number {
  return Math.min(POLL_INTERVAL_MS * 2 ** Math.max(0, misses - 1), MAX_POLL_INTERVAL_MS);
}

/**
 * Polls the runner until it answers. Each check waits for the previous one to finish, then
 * pauses, and the pause doubles after every miss up to MAX_POLL_INTERVAL_MS, so a slow or absent
 * runner is never hammered. `enabled` is false on the public landing page, which needs no runner.
 */
export function useRunnerConnection(enabled = true): { reachable: boolean; checks: number } {
  const [reachable, setReachable] = useState(false);
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    if (reachable || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let misses = 0;

    const check = async () => {
      const status = await getStatus();
      if (cancelled) return;
      setChecks((n) => n + 1);
      if (status) setReachable(true);
      else timer = setTimeout(check, nextCheckDelayMs(++misses));
    };

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reachable, enabled]);

  return { reachable, checks };
}
