import { useEffect, useState } from 'react';
import { getStatus } from '../api';

export const POLL_INTERVAL_MS = 3000;

/**
 * Polls the runner until it answers. Each check waits for the previous one to finish, then
 * pauses POLL_INTERVAL_MS, so a slow or absent runner is never hammered. `enabled` is false on the
 * public landing page, which needs no runner.
 */
export function useRunnerConnection(enabled = true): { reachable: boolean; checks: number } {
  const [reachable, setReachable] = useState(false);
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    if (reachable || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      const status = await getStatus();
      if (cancelled) return;
      setChecks((n) => n + 1);
      if (status) setReachable(true);
      else timer = setTimeout(run, POLL_INTERVAL_MS);
    };
    const run = () => {
      void check().catch((err: unknown) => console.error(err));
    };

    run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reachable, enabled]);

  return { reachable, checks };
}
