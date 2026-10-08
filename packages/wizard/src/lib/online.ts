import { ONLINE_APP_URL } from './workflow';
import { PATHS } from './router';

/**
 * Where "Run a free check-up" leads. When this page is served by the app itself that is its own
 * address. When it is served from a static host (Vercel) and an online copy is published, it is that
 * copy's new check-up screen, which is on another origin.
 */
export function startAddress(
  onlineAppUrl: string | null = ONLINE_APP_URL,
  here: string = window.location.origin
): string {
  if (!onlineAppUrl) return PATHS.new;
  try {
    const online = new URL(onlineAppUrl);
    if (online.origin === here) return PATHS.new;
    return new URL(PATHS.new, online).toString();
  } catch {
    return PATHS.new;
  }
}

export const DEFAULT_WAKE_LIMIT_MS = 90_000;

/** How long to wait for the online copy to wake, from `VITE_WAKE_LIMIT_SECONDS` (5 to 600 s); 90 s when unset or not a positive number. */
export function wakeLimitMs(
  raw: string | undefined = import.meta.env.VITE_WAKE_LIMIT_SECONDS as string | undefined
): number {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_WAKE_LIMIT_MS;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_WAKE_LIMIT_MS;
  return Math.min(600, Math.max(5, seconds)) * 1000;
}

/** The online copy's health address, to wake it while a visitor is still reading; null when it is this page's own origin. */
export function wakeAddress(
  onlineAppUrl: string | null = ONLINE_APP_URL,
  here: string = window.location.origin
): string | null {
  if (!onlineAppUrl) return null;
  try {
    const online = new URL(onlineAppUrl);
    return online.origin === here ? null : new URL('/healthz', online).toString();
  } catch {
    return null;
  }
}
