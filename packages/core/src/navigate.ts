import type { Page } from 'playwright';
import type { RouteTelemetry } from '@qa/types';
import { redactUrl } from './redact.js';

export interface NavigateOptions {
  /** Default 15000 for the first attempt */
  timeoutMs?: number;
  /** Default 1; the retry uses timeoutMs * 1.5 */
  retries?: number;
  /** Cap for the idle wait after DOMContentLoaded, default 1000 (network idle ends it earlier) */
  settleMs?: number;
  /** Wait for at least one a[href] or interactive element (spider), default false */
  needLinks?: boolean;
  /** 'visitor' or a role name (copied into telemetry) */
  who?: string;
}

export interface NavigateResult {
  /** A page loaded (any HTTP status) within the retries */
  ok: boolean;
  /** Main-frame status of the last attempt */
  status?: number;
  /** page.url() after redirects (not redacted; callers redact) */
  finalUrl: string;
  /** URLs from request.redirectedFrom() chain, oldest first (not redacted) */
  redirectChain: string[];
  attempts: number;
  durationMs: number;
  /** Idle/links condition met before the cap */
  settled: boolean;
  /** When needLinks */
  linkCount?: number;
  /** Kind only, never message text */
  error?: { kind: 'timeout' | 'net' | 'aborted' | 'other' };
}

/** Default cap for the settle wait. A page that never goes network-idle waits this long, not longer. */
const DEFAULT_SETTLE_MS = 1000;
/** How long a link or control may take to appear on a page that has none yet (spider, SPA hydration). */
const LINK_WAIT_MS = 2000;

/**
 * Classifies a Playwright navigation error into a kind enum without leaking error message text.
 */
function classifyError(err: unknown, page: Page): { kind: 'timeout' | 'net' | 'aborted' | 'other' } {
  if (page.isClosed()) {
    return { kind: 'aborted' };
  }
  const name = err instanceof Error ? err.name : '';
  const message = err instanceof Error ? err.message : String(err);

  if (name === 'TimeoutError' || /timeout|timed_out/i.test(name) || /timeout|timed_out/i.test(message)) {
    return { kind: 'timeout' };
  }
  if (/page closed|target closed|browser has been closed|browser disconnected|crashed/i.test(message)) {
    return { kind: 'aborted' };
  }
  if (/net::ERR_|connection refused|ECONNREFUSED|ENOTFOUND|getaddrinfo/i.test(message)) {
    return { kind: 'net' };
  }
  return { kind: 'other' };
}

/**
 * Waits for a page to settle after DOMContentLoaded: networkidle cap and optional link wait.
 */
export async function settlePage(
  page: Page,
  options?: { settleMs?: number; needLinks?: boolean }
): Promise<{ settled: boolean; linkCount: number }> {
  const settleMs = options?.settleMs ?? DEFAULT_SETTLE_MS;
  const needLinks = options?.needLinks ?? false;

  // Race networkidle with the settle cap: networkidle is only an early exit
  await Promise.race([page.waitForLoadState('networkidle').catch(() => {}), page.waitForTimeout(settleMs)]);

  let linkCount = 0;
  try {
    linkCount = await page
      .locator('a[href]')
      .count()
      .catch(() => 0);
  } catch {
    linkCount = 0;
  }

  if (needLinks) {
    if (linkCount === 0) {
      // First wait for interactive or link element
      const candidates = page.locator('a[href], button, [role=link], [role=button]');
      await candidates
        .first()
        .waitFor({ state: 'visible', timeout: LINK_WAIT_MS })
        .catch(() => {});
      linkCount = await page
        .locator('a[href]')
        .count()
        .catch(() => 0);

      // Zero-link retry: if still zero links, wait once more up to LINK_WAIT_MS for SPA hydration
      if (linkCount === 0) {
        await page.waitForTimeout(LINK_WAIT_MS);
        linkCount = await page
          .locator('a[href]')
          .count()
          .catch(() => 0);
      }
    }
  }

  return { settled: true, linkCount };
}

/**
 * Checks whether the current page looks like a login page.
 * Returns true if a visible input[type=password] exists or current path matches loginPaths.
 */
export async function looksLikeLogin(page: Page, loginPaths?: string[]): Promise<boolean> {
  try {
    const currentUrl = new URL(page.url());
    if (loginPaths) {
      const match = loginPaths.some((p) => p === currentUrl.pathname || p === currentUrl.pathname + currentUrl.search);
      if (match) return true;
    }
  } catch {
    // ignore URL parse errors
  }

  try {
    const pw = page.locator('input[type="password"]');
    const count = await pw.count();
    for (let i = 0; i < count; i++) {
      if (
        await pw
          .nth(i)
          .isVisible()
          .catch(() => false)
      ) {
        return true;
      }
    }
  } catch {
    // ignore locator errors
  }

  return false;
}

/**
 * Navigates a Playwright Page with retries, status capture, redirect chain tracking, and settle wait.
 */
export async function navigate(page: Page, url: string, options?: NavigateOptions): Promise<NavigateResult> {
  const timeoutMs = options?.timeoutMs ?? 15000;
  const retries = options?.retries ?? 1;
  const settleMs = options?.settleMs ?? DEFAULT_SETTLE_MS;
  const needLinks = options?.needLinks ?? false;

  const startTime = Date.now();
  const maxAttempts = 1 + Math.max(0, retries);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptTimeout = attempt === 1 ? timeoutMs : Math.round(timeoutMs * 1.5);
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: attemptTimeout });
      const { settled, linkCount } = await settlePage(page, { settleMs, needLinks });

      const redirectChain: string[] = [];
      if (resp) {
        let req = resp.request().redirectedFrom();
        while (req) {
          redirectChain.unshift(req.url());
          req = req.redirectedFrom();
        }
      }

      return {
        ok: true,
        status: resp ? resp.status() : undefined,
        finalUrl: page.url(),
        redirectChain,
        attempts: attempt,
        durationMs: Date.now() - startTime,
        settled,
        linkCount: needLinks ? linkCount : undefined,
      };
    } catch (err) {
      const errInfo = classifyError(err, page);
      const isLastAttempt = attempt >= maxAttempts;

      if (errInfo.kind === 'aborted' || isLastAttempt) {
        let currentUrl = '';
        try {
          currentUrl = page.url();
        } catch {
          currentUrl = '';
        }

        return {
          ok: false,
          finalUrl: currentUrl,
          redirectChain: [],
          attempts: attempt,
          durationMs: Date.now() - startTime,
          settled: false,
          error: { kind: errInfo.kind },
        };
      }
      // On retryable errors (timeout, net, other), reset the pending navigation with about:blank
      if (!page.isClosed()) {
        await page.goto('about:blank', { timeout: 2000 }).catch(() => {});
      }
    }
  }

  return {
    ok: false,
    finalUrl: '',
    redirectChain: [],
    attempts: maxAttempts,
    durationMs: Date.now() - startTime,
    settled: false,
    error: { kind: 'other' },
  };
}

/**
 * Maps a NavigateResult to RouteTelemetry, redacting paths and queries.
 */
export function toTelemetry(r: NavigateResult, requestedPath: string, extra?: Partial<RouteTelemetry>): RouteTelemetry {
  let finalPath: string | undefined;
  try {
    const u = new URL(r.finalUrl);
    finalPath = redactUrl(u.pathname + u.search);
  } catch {
    finalPath = r.finalUrl ? redactUrl(r.finalUrl) : undefined;
  }

  const redirectChain = r.redirectChain.map((u) => {
    try {
      const parsed = new URL(u);
      return redactUrl(parsed.pathname + parsed.search);
    } catch {
      return redactUrl(u);
    }
  });

  const outcome = r.ok && (r.status === undefined || r.status < 400) ? 'recorded' : 'skipped';
  let skipReason: RouteTelemetry['skipReason'];
  if (!r.ok) {
    skipReason = r.error?.kind === 'timeout' ? 'timeout' : 'did-not-load';
  } else if (r.status !== undefined && r.status >= 400) {
    skipReason = 'http-error';
  }

  return {
    requestedPath: redactUrl(requestedPath),
    status: r.status,
    finalPath,
    redirectChain: redirectChain.length > 0 ? redirectChain : undefined,
    outcome: extra?.outcome ?? outcome,
    attempts: r.attempts,
    durationMs: r.durationMs,
    ...(skipReason ? { skipReason } : {}),
    ...extra,
  };
}
