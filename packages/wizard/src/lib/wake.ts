import type { WakeState } from '../hooks/useWakeOnline';
import { wakeLimitMs } from './online';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Is a failed status check what a runner that is still waking up gives? A 5xx always is (the site's rewrite
 * answers 502/504 while the container starts). No answer in time is too, except on this computer, where it
 * means the QA Tool is simply not started and the connection screen explains how.
 */
export function looksLikeWaking(failure: 'none' | 'slow' | 'server' | 'other', hostname: string): boolean {
  if (failure === 'server') return true;
  return failure === 'slow' && !LOOPBACK.has(hostname.toLowerCase());
}

/**
 * The wake state while the runner has not answered: 'none' when the failures do not look like waking, else
 * 'waking' until the limit (VITE_WAKE_LIMIT_SECONDS) has passed since the first one, then 'failed'.
 */
export function wakeStateFor(
  firstFailureAt: number | null,
  now: number,
  limitMs: number = wakeLimitMs()
): Extract<WakeState, 'none' | 'waking' | 'failed'> {
  if (firstFailureAt === null) return 'none';
  return now - firstFailureAt >= limitMs ? 'failed' : 'waking';
}
