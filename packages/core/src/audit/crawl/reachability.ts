/**
 * Website Audit: the start address check (REQ-001, Q-22). Node only.
 * - Public: the host resolves to public addresses only (`resolvePublic`). Private, loopback and
 *   link-local addresses are refused here, for a Website Audit only; the Check-up preflight is separate,
 *   so Test Copies on local addresses keep working.
 * - A local runner (ADR 0042: not a beta copy, bound to this computer) passes `allowPrivateAddresses`, set by
 *   the runner and never from request input: localhost and LAN addresses are then accepted.
 * - Reachable: the final response after redirects is below 400 within the page timeout. Every hop goes
 *   through `safeGet` (ADR 0031): resolved once, pinned, re-checked, so no request reaches a private address.
 * - A body cut at the byte cap still counts: only the status matters.
 * Messages are short and for people; no addresses, error codes or stack details.
 */
import { defaultNetDeps, safeGet, type NetDeps, type PinnedRequest } from '../../safe-net.js';

/**
 * The audit's page timeout (crawl.ts AUDIT_PAGE_TIMEOUT_MS); it bounds the whole check. A dev server's first
 * answer, while it compiles the page, can take longer than 10 s, which refused the audit with a 422.
 */
export const AUDIT_ADDRESS_TIMEOUT_MS = 30_000;
/** The body is not needed; a small cap keeps the check cheap. */
const MAX_BYTES = 64 * 1024;

export type AuditAddressCode = 'ERR_PRIVATE_ADDRESS' | 'ERR_UNREACHABLE' | 'ERR_DNS';

export type AuditAddressResult =
  { ok: true; finalUrl: string; status: number } | { ok: false; code: AuditAddressCode; reason: string };

export interface AuditAddressOptions {
  timeoutMs?: number;
  netDeps?: NetDeps;
  /** A local runner only (ADR 0042); set by the runner, never from the start body. */
  allowPrivateAddresses?: boolean;
}

const MESSAGES = {
  private: 'This address points to a private or local network. A Website Audit only checks public websites.',
  dns: 'The site name could not be found. Check the address for typos.',
  timeout: 'The site did not answer in time.',
  redirects: 'The site redirected too many times.',
  scheme: 'Only http and https web addresses can be checked.',
  error: 'The site could not be reached.',
} as const;

const unreachable = (reason: string): AuditAddressResult => ({ ok: false, code: 'ERR_UNREACHABLE', reason });

export async function checkAuditAddress(url: string, opts: AuditAddressOptions = {}): Promise<AuditAddressResult> {
  const base = opts.netDeps ?? defaultNetDeps;
  const timeoutMs = opts.timeoutMs ?? AUDIT_ADDRESS_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  let lastUrl: string | undefined;

  const timeLeft = () => deadline - Date.now();
  /** Runs one network step within the time left; past the deadline it fails as a timeout. */
  const bounded = <T>(work: () => Promise<T>): Promise<T> => {
    const left = timeLeft();
    if (left <= 0) {
      timedOut = true;
      return Promise.reject(new Error('timeout'));
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('timeout'));
      }, left);
      work().then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  };

  // The whole check, every lookup and hop included, fits in one page timeout.
  const deps: NetDeps = {
    lookup: (host) => bounded(() => base.lookup(host)),
    connect: (req: PinnedRequest) =>
      bounded(() => {
        lastUrl = req.url.toString();
        return base.connect({ ...req, timeoutMs: Math.max(1, Math.min(req.timeoutMs, timeLeft())) });
      }),
  };

  let res;
  try {
    res = await safeGet(
      url,
      { maxBytes: MAX_BYTES, timeoutMs, ...(opts.allowPrivateAddresses ? { allowPrivate: true } : {}) },
      deps
    );
  } catch {
    return unreachable(timedOut ? MESSAGES.timeout : MESSAGES.error);
  }

  if (res.ok) {
    if (res.status > 0) return { ok: true, finalUrl: res.finalUrl, status: res.status };
    return unreachable(MESSAGES.error);
  }
  switch (res.reason) {
    case 'private-address':
      return { ok: false, code: 'ERR_PRIVATE_ADDRESS', reason: MESSAGES.private };
    case 'too-large':
      // Cut at the byte cap: the status line arrived, so the site answered.
      if (res.status !== undefined && res.status >= 200 && lastUrl) {
        return { ok: true, finalUrl: lastUrl, status: res.status };
      }
      return unreachable(MESSAGES.error);
    case 'dns-failed':
      return timedOut ? unreachable(MESSAGES.timeout) : { ok: false, code: 'ERR_DNS', reason: MESSAGES.dns };
    case 'timeout':
      return unreachable(MESSAGES.timeout);
    case 'redirected':
      return unreachable(MESSAGES.redirects);
    case 'bad-scheme':
      return unreachable(MESSAGES.scheme);
    default:
      return unreachable(timedOut ? MESSAGES.timeout : MESSAGES.error);
  }
}
