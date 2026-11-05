import type { FetchFn } from '@qa/checkers';
import { makeOutboundFetch, type NetDeps } from './safe-net.js';
import type { HostPacer } from './host-pacer.js';

/**
 * The checkers' `FetchFn` for a run (ADR 0031). One builder, used by the Check-up orchestrator and the
 * Website Audit analysis, so both reach page- and site-derived addresses the same way: GET only, through
 * `makeOutboundFetch` (resolved once per hop, pinned, every redirect hop re-checked, body capped).
 * Private addresses are reached only on a local run: `allowPrivate` can narrow the run's rule, never widen it
 * (a browser guard set means public only, read at call time).
 */

/** Short, as the checkers' own probes (security.txt, source maps, site files, broken links) always were. */
export const CHECKER_FETCH_TIMEOUT_MS = 3000;
/** The checkers read status and at most a file head; a large body is not kept. */
export const CHECKER_FETCH_MAX_BYTES = 512_000;

/** Per-caller defaults for the shared factory. Pacer use is explicit: only the audit shares one with its crawl. */
export const CHECKER_FETCH_CALLERS = {
  audit: { maxRedirects: 0, timeoutMs: CHECKER_FETCH_TIMEOUT_MS, usesPacer: true },
  orchestrator: { maxRedirects: 0, timeoutMs: CHECKER_FETCH_TIMEOUT_MS, usesPacer: false },
  orchestratorLinks: { maxRedirects: 10, timeoutMs: 10_000, usesPacer: false },
} as const;
export type CheckerFetchCaller = keyof typeof CHECKER_FETCH_CALLERS;

export interface CheckerFetchOptions {
  /** Which caller's defaults apply (redirect limit, timeout, pacer use). Explicit fields below still win. */
  caller?: CheckerFetchCaller;
  /** The run's rule for private addresses. Never set from request input. */
  allowPrivate?: boolean;
  /** 0 (default) returns a 3xx as the response; the checkers stay on the address they were given. */
  maxRedirects?: number;
  timeoutMs?: number;
  /** Shared with the crawl of the same site (ADR 0015). */
  pacer?: HostPacer;
  /** Network seam for tests. */
  deps?: NetDeps;
}

/** The options handed to makeOutboundFetch: one place, so callers cannot drift. */
export function resolveCheckerFetchOptions(opts: CheckerFetchOptions = {}) {
  const profile: { maxRedirects: number; timeoutMs: number; usesPacer: boolean } = opts.caller
    ? CHECKER_FETCH_CALLERS[opts.caller]
    : { maxRedirects: 0, timeoutMs: CHECKER_FETCH_TIMEOUT_MS, usesPacer: true }; // no caller: options as given (crawl, tests)
  return {
    allowPrivate: opts.allowPrivate,
    maxRedirects: opts.maxRedirects ?? profile.maxRedirects,
    timeoutMs: opts.timeoutMs ?? profile.timeoutMs,
    maxBytes: CHECKER_FETCH_MAX_BYTES,
    pacer: profile.usesPacer ? opts.pacer : undefined,
    deps: opts.deps,
  };
}

export function makeCheckerFetch(opts: CheckerFetchOptions = {}): FetchFn {
  return makeOutboundFetch(resolveCheckerFetchOptions(opts));
}

/**
 * The plan's link check: one GET, redirects followed with every hop re-checked, failing only when the link is
 * broken (404, 410, 5xx) or nothing answers. 401, 403, 429 and 999 pass: those sites turn automated requests away.
 */
export async function checkLinkStatus(address: string, fetchFn: FetchFn): Promise<void> {
  const res = await fetchFn(address).catch(() => null);
  if (!res) throw new Error(`The link doesn’t open: ${address} (no answer, or the address is not allowed)`);
  const status = res.status;
  if (status === 404 || status === 410 || (status >= 500 && status <= 599))
    throw new Error(`The link is broken: ${address} answered ${status}`);
}
