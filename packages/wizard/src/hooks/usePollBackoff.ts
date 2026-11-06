import { useEffect, useRef } from 'react';

/**
 * How long to wait before poll number `attempt` (0-based): `base`, then double each time, up to `cap` (LAT-9).
 */
export function pollDelay(attempt: number, base: number, cap: number): number {
  return Math.min(base * 2 ** attempt, cap);
}

/**
 * Calls `poll` while `active`: first after `base` ms, then after twice as long each time, up to `cap`.
 * Whenever a value in `resetKeys` changes (a fresh event or a state change), the wait goes back to `base`.
 * Turning `active` off stops it.
 */
export function usePollBackoff(
  poll: () => void,
  active: boolean,
  base: number,
  cap: number,
  resetKeys: ReadonlyArray<unknown>
): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (!active) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      timer = setTimeout(tick, pollDelay(attempt, base, cap));
    };
    const tick = () => {
      pollRef.current();
      attempt++;
      schedule();
    };

    schedule();
    return () => clearTimeout(timer);
  }, [active, base, cap, ...resetKeys]);
}
