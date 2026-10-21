import dns from 'dns';
import http from 'http';
import https from 'https';
import { isIpLiteral, isPrivateTextHost, isPublicAddress } from './address-class.js';
import { proofMatches, proofUrl } from './domain-verification.js';

/**
 * Network checks for shared machines (ADR 0014). Node only: the wizard never imports this file.
 * A name is resolved once per hop, every address must be public, and the connection goes to the
 * address that was checked (the name only goes in the Host header and the TLS server name), so a
 * second lookup can never swap the address. Every redirect hop is checked again. Anything unclear fails.
 */

export interface PinnedRequest {
  url: URL;
  /** The checked address to connect to. */
  address: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** True when the body went over `maxBytes` (it is cut off). */
  tooLarge?: boolean;
}

export interface NetDeps {
  lookup(host: string): Promise<string[]>;
  connect(req: PinnedRequest): Promise<RawResponse>;
}

const LOOKUP_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 1_000_000;

function defaultLookup(host: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), LOOKUP_TIMEOUT_MS);
    dns.promises
      .lookup(host, { all: true, verbatim: true })
      .then((found) => resolve(found.map((f) => f.address)))
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

function defaultConnect(req: PinnedRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const secure = req.url.protocol === 'https:';
    const mod = secure ? https : http;
    let settled = false;
    // eslint-disable-next-line prefer-const
    let timer: NodeJS.Timeout | undefined;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const request = mod.request(
      {
        host: req.address,
        port: req.url.port ? Number(req.url.port) : secure ? 443 : 80,
        path: `${req.url.pathname}${req.url.search}`,
        method: 'GET',
        headers: { ...req.headers, Host: req.url.host },
        // The name is only for the certificate check; the address is already chosen.
        ...(secure && !isIpLiteral(req.url.hostname) ? { servername: req.url.hostname } : {}),
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > req.maxBytes) {
            res.destroy();
            done(() => resolve({ status: res.statusCode || 0, headers: res.headers, body: '', tooLarge: true }));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          done(() =>
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          )
        );
        res.on('error', (err) => done(() => reject(err)));
      }
    );
    timer = setTimeout(() => {
      request.destroy();
      done(() => reject(new Error('timeout')));
    }, req.timeoutMs);
    request.on('error', (err) => done(() => reject(err)));
    request.end();
  });
}

export const defaultNetDeps: NetDeps = { lookup: defaultLookup, connect: defaultConnect };

export type ResolveResult =
  { ok: true; address: string; all: string[] } | { ok: false; reason: 'dns-failed' | 'private-address' };

/**
 * Resolves a host once and requires every address to be public. A literal IP skips DNS but is classified.
 * `allowPrivate` is for a local run only (ADR 0031): the address is still resolved once and pinned.
 */
export async function resolvePublic(
  host: string,
  deps: Pick<NetDeps, 'lookup'> = defaultNetDeps,
  allowPrivate = false
): Promise<ResolveResult> {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return { ok: false, reason: 'dns-failed' };
  if (!allowPrivate && isPrivateTextHost(h)) return { ok: false, reason: 'private-address' };
  if (isIpLiteral(h)) {
    return allowPrivate || isPublicAddress(h)
      ? { ok: true, address: h, all: [h] }
      : { ok: false, reason: 'private-address' };
  }
  let all: string[];
  try {
    all = await deps.lookup(h);
  } catch {
    return { ok: false, reason: 'dns-failed' };
  }
  if (!Array.isArray(all) || all.length === 0) return { ok: false, reason: 'dns-failed' };
  // One bad address in a mixed answer fails the whole name.
  if (!allowPrivate && !all.every((a) => typeof a === 'string' && isPublicAddress(a))) {
    return { ok: false, reason: 'private-address' };
  }
  const address = all.find((a) => !a.includes(':')) ?? all[0];
  return { ok: true, address, all };
}

export type SafeGetFailure =
  'dns-failed' | 'private-address' | 'redirected' | 'timeout' | 'too-large' | 'bad-scheme' | 'error';

export type SafeGetResult =
  | { ok: true; status: number; finalUrl: string; headers: Record<string, string | string[] | undefined>; body: string }
  | { ok: false; reason: SafeGetFailure; status?: number };

/** A cookie from a Playwright storage state (ADR 0031). It is sent only to a hop it matches. */
export interface SafeCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  /** Unix seconds; absent or -1 means a session cookie. */
  expires?: number;
}

/** The Cookie header for one hop, or undefined when no cookie matches it (host, path, scheme, expiry). */
export function cookieHeaderFor(url: URL, cookies: SafeCookie[] | undefined): string | undefined {
  const host = url.hostname.toLowerCase();
  const parts = (cookies ?? [])
    .filter((c) => {
      const domain = c.domain.replace(/^\./, '').toLowerCase();
      if (!domain || (host !== domain && !host.endsWith(`.${domain}`))) return false;
      if (c.secure && url.protocol !== 'https:') return false;
      if (c.expires !== undefined && c.expires > 0 && c.expires * 1000 <= Date.now()) return false;
      const p = c.path || '/';
      return url.pathname === p || url.pathname.startsWith(p.endsWith('/') ? p : `${p}/`);
    })
    .map((c) => `${c.name}=${c.value}`);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

/**
 * GET with the checks above on every hop. `maxRedirects` 0 means any 3xx fails as 'redirected'.
 * `allowPrivate` is set only when no browser guard is active (a local run, ADR 0014 and 0031).
 * `cookies` are matched per hop, so a redirect to another host never carries them.
 */
export async function safeGet(
  url: string,
  opts: {
    maxRedirects?: number;
    maxBytes?: number;
    headers?: Record<string, string>;
    timeoutMs?: number;
    allowPrivate?: boolean;
    cookies?: SafeCookie[];
  } = {},
  deps: NetDeps = defaultNetDeps
): Promise<SafeGetResult> {
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ok: false, reason: 'bad-scheme' };
  }
  for (let hop = 0; ; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return { ok: false, reason: 'bad-scheme' };
    const resolved = await resolvePublic(current.hostname, deps, opts.allowPrivate);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const cookie = cookieHeaderFor(current, opts.cookies);
    let raw: RawResponse;
    try {
      raw = await deps.connect({
        url: current,
        address: resolved.address,
        headers: { ...(opts.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
        timeoutMs: opts.timeoutMs ?? CONNECT_TIMEOUT_MS,
        maxBytes,
      });
    } catch (err) {
      return { ok: false, reason: err instanceof Error && err.message === 'timeout' ? 'timeout' : 'error' };
    }
    if (raw.tooLarge) return { ok: false, reason: 'too-large', status: raw.status };
    const location = raw.headers.location;
    const target = Array.isArray(location) ? location[0] : location;
    if (raw.status >= 300 && raw.status < 400 && target) {
      if (hop >= maxRedirects) return { ok: false, reason: 'redirected' };
      try {
        current = new URL(target, current);
      } catch {
        return { ok: false, reason: 'bad-scheme' };
      }
      continue;
    }
    return { ok: true, status: raw.status, finalUrl: current.toString(), headers: raw.headers, body: raw.body };
  }
}

/**
 * The GET the checkers use (they cannot import this file, so core passes this in). Same pinned,
 * redirect-checked request as safeGet; null when the request is refused or fails. Checkers only read
 * the body and headers they are given, so the shape is kept small. `cookies` is for a signed-in role.
 */
export function makeOutboundFetch(
  opts: { allowPrivate: boolean; timeoutMs: number; maxRedirects?: number; cookies?: SafeCookie[] },
  deps: NetDeps = defaultNetDeps
): (url: string) => Promise<{ status: number; headers: Record<string, string>; text: () => Promise<string> } | null> {
  return async (url: string) => {
    const got = await safeGet(
      url,
      {
        allowPrivate: opts.allowPrivate,
        timeoutMs: opts.timeoutMs,
        maxRedirects: opts.maxRedirects,
        cookies: opts.cookies,
      },
      deps
    );
    if (!got.ok) return null;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(got.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : (v ?? '');
    return { status: got.status, headers, text: async () => got.body };
  };
}

export type ProofFailure =
  'not-https' | 'not-found' | 'mismatch' | 'redirected' | 'private-address' | 'dns-failed' | 'timeout' | 'too-large';

export const PROOF_MAX_BYTES = 4096;

/** Fetches the proof file of this exact origin (https, no redirect, 4 KB) and matches the session's token. */
export async function verifyDomainProof(
  origin: string,
  token: string,
  deps: NetDeps = defaultNetDeps
): Promise<{ ok: boolean; reason?: ProofFailure }> {
  const url = proofUrl(origin);
  if (!url) {
    let isHttps = false;
    try {
      isHttps = new URL(origin).protocol === 'https:';
    } catch {
      /* not a URL */
    }
    return { ok: false, reason: isHttps ? 'private-address' : 'not-https' };
  }
  if (!token) return { ok: false, reason: 'mismatch' };
  const got = await safeGet(url, { maxRedirects: 0, maxBytes: PROOF_MAX_BYTES }, deps);
  if (!got.ok) {
    const reason: ProofFailure = got.reason === 'bad-scheme' || got.reason === 'error' ? 'not-found' : got.reason;
    return { ok: false, reason };
  }
  if (got.status !== 200) return { ok: false, reason: 'not-found' };
  if (!proofMatches(got.body, token)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

/**
 * The per-request browser guard: true lets the request go on, false aborts it. The host is resolved
 * afresh every call (no cache) and every address must be public. Pages that do not touch the network
 * (data:, blob:, about:) pass. A redirected request is checked exactly like any other.
 */
export function makeRequestGuard(
  deps: Pick<NetDeps, 'lookup'> = defaultNetDeps
): (url: string, redirected: boolean) => Promise<boolean> {
  return async (url: string): Promise<boolean> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') return true;
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return false;
    return (await resolvePublic(parsed.hostname, deps)).ok;
  };
}
