/**
 * Optional, cookie-free landing counter (T-13). Off unless VITE_COUNTER_URL is set at build time.
 * No third-party script is loaded: each event is one small GET to a GoatCounter-style endpoint.
 * The request carries the event name only: no address, no run id, no referrer, no credentials,
 * and nothing is kept in the browser.
 */

export const COUNTER_EVENTS = {
  landingView: 'landing-view',
  startCheckup: 'start-checkup',
  completedCheckup: 'completed-checkup',
} as const;

export type CounterEvent = (typeof COUNTER_EVENTS)[keyof typeof COUNTER_EVENTS];

/** A usable endpoint, or null. https only (http only for a local test server); no credentials, query or hash. */
export function counterEndpoint(raw?: string): string | null {
  const text = raw?.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  if (url.username || url.password) return null;
  return url.origin + url.pathname;
}

export const COUNTER_URL: string | null = counterEndpoint(import.meta.env.VITE_COUNTER_URL as string | undefined);

export function counterEventUrl(endpoint: string, event: CounterEvent): string {
  return `${endpoint}?p=${event}&e=true&t=${event}`;
}

export interface CounterOptions {
  endpoint?: string | null;
  send?: (url: string) => void;
  /** Do Not Track or Global Privacy Control is on. Read from the browser when not given. */
  dnt?: boolean;
}

function browserOptOut(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

function defaultSend(url: string): void {
  try {
    void fetch(url, {
      method: 'GET',
      keepalive: true,
      mode: 'no-cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).catch(() => undefined);
  } catch {
    // Counting must never break the page.
  }
}

/** Sends one event. Returns false (and does nothing) when the counter is off or the visitor opted out. */
export function sendCounterEvent(event: CounterEvent, opts: CounterOptions = {}): boolean {
  const endpoint = opts.endpoint === undefined ? COUNTER_URL : opts.endpoint;
  if (!endpoint) return false;
  if (opts.dnt ?? browserOptOut()) return false;
  (opts.send ?? defaultSend)(counterEventUrl(endpoint, event));
  return true;
}

const sentOnce = new Set<CounterEvent>();

/** Like sendCounterEvent, but at most once per page load (React StrictMode runs effects twice in dev). */
export function sendCounterEventOnce(event: CounterEvent, opts: CounterOptions = {}): boolean {
  if (sentOnce.has(event)) return false;
  sentOnce.add(event);
  return sendCounterEvent(event, opts);
}

export function resetCounterOnce(): void {
  sentOnce.clear();
}
