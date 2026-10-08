import { useEffect, useState } from 'react';
import { wakeAddress, wakeLimitMs } from '../lib/online';

/** The free online copy sleeps when idle and takes about a minute to wake. 90 s unless `VITE_WAKE_LIMIT_SECONDS` says otherwise. */
const WAKE_TIMEOUT_MS = wakeLimitMs();

export type WakeState = 'none' | 'waking' | 'ready' | 'failed';

/**
 * Wakes the online copy as soon as the landing page opens, so it is usually awake by the time a visitor
 * has read the headline and clicks. 'none' means there is nothing to wake (the page is the app itself).
 * The request is opaque (no-cors): only whether it came back is known, which is all that is needed.
 */
export function useWakeOnline(): WakeState {
  const [state, setState] = useState<WakeState>(() => (wakeAddress() ? 'waking' : 'none'));
  useEffect(() => {
    const url = wakeAddress();
    if (!url) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WAKE_TIMEOUT_MS);
    fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
      .then(() => !cancelled && setState('ready'))
      .catch(() => !cancelled && setState('failed'))
      .finally(() => clearTimeout(timer));
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return state;
}
