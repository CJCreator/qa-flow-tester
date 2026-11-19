import { useEffect, useState } from 'react';
import { probeStatus } from '../api';
import { looksLikeWaking, wakeStateFor } from '../lib/wake';
import type { WakeState } from './useWakeOnline';

export const POLL_INTERVAL_MS = 3000;

/**
 * Polls the runner until it answers. Each check waits for the previous one to finish, then
 * pauses POLL_INTERVAL_MS, so a slow or absent runner is never hammered. `enabled` is false on the
 * public landing page, which needs no runner. `wake` is 'waking' while the failures look like a runner that is
 * starting (slow or 5xx, on the hosted copy), 'failed' once VITE_WAKE_LIMIT_SECONDS has passed; polling goes on.
 */
export function useRunnerConnection(enabled = true): {
  reachable: boolean;
  checks: number;
  wake: Extract<WakeState, 'none' | 'waking' | 'failed'>;
} {
  const [reachable, setReachable] = useState(false);
  const [checks, setChecks] = useState(0);
  const [wake, setWake] = useState<Extract<WakeState, 'none' | 'waking' | 'failed'>>('none');

  useEffect(() => {
    if (reachable || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstFailureAt: number | null = null;

    const check = async () => {
      const { status, failure } = await probeStatus();
      if (cancelled) return;
      setChecks((n) => n + 1);
      if (status) {
        setReachable(true);
        setWake('none');
        return;
      }
      if (looksLikeWaking(failure, window.location.hostname)) firstFailureAt ??= Date.now();
      else firstFailureAt = null;
      setWake(wakeStateFor(firstFailureAt, Date.now()));
      timer = setTimeout(run, POLL_INTERVAL_MS);
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

  return { reachable, checks, wake };
}
