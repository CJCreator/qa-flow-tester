import { ONLINE_APP_URL } from './onlineUrl';
import { PATHS } from './router';

/**
 * Where "Run a free check-up" leads. When this page is served by the app itself that is its own
 * address. When it is served from a static host (Vercel) and an online copy is published, it is that
 * copy's new check-up screen, which is on another origin.
 */
export function startAddress(onlineAppUrl: string | null = ONLINE_APP_URL, here: string = window.location.origin): string {
  if (!onlineAppUrl) return PATHS.new;
  try {
    const online = new URL(onlineAppUrl);
    if (online.origin === here) return PATHS.new;
    return new URL(PATHS.new, online).toString();
  } catch {
    return PATHS.new;
  }
}

/** The online copy's health address, to wake it while a visitor is still reading; null when it is this page's own origin. */
export function wakeAddress(onlineAppUrl: string | null = ONLINE_APP_URL, here: string = window.location.origin): string | null {
  if (!onlineAppUrl) return null;
  try {
    const online = new URL(onlineAppUrl);
    return online.origin === here ? null : new URL('/healthz', online).toString();
  } catch {
    return null;
  }
}
