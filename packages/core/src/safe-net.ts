import dns from 'dns';
import http from 'http';
import https from 'https';
import { isIpLiteral, isPrivateTextHost, isPublicAddress } from './address-class.js';
import { proofMatches, proofUrl } from './domain-verification.js';
import type { FetchedResponse } from '@qa/checkers';
import { getBrowserPolicy } from './browser.js';
import { isSameSite } from './same-site.js';
import type { HostPacer } from './host-pacer.js';

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
  /** Aborting destroys the pinned socket. Nothing is sent after the abort. */
  signal?: AbortSignal;
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** The undecoded body bytes. Fakes may omit it; then `body` is taken as UTF-8. */
  raw?: Buffer;
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

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function defaultConnect(req: PinnedRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (req.signal?.aborted) return reject(abortError());
    const secure = req.url.protocol === 'https:';
    const mod = secure ? https : http;
    let settled = false;
    // eslint-disable-next-line prefer-const
    let timer: NodeJS.Timeout | undefined;
    // eslint-disable-next-line prefer-const -- assigned after `done` closes over it
    let onAbort: (() => void) | undefined;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onAbort) req.signal?.removeEventListener('abort', onAbort);
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
          done(() => {
            const raw = Buffer.concat(chunks);
            resolve({ status: res.statusCode || 0, headers: res.headers, body: raw.toString('utf8'), raw });
          })
        );
        res.on('error', (err) => done(() => reject(err)));
      }
    );
    timer = setTimeout(() => {
      request.destroy();
      done(() => reject(new Error('timeout')));
    }, req.timeoutMs);
    onAbort = () => {
      request.destroy();
      done(() => reject(abortError()));
    };
    req.signal?.addEventListener('abort', onAbort, { once: true });
    request.on('error', (err) => done(() => reject(err)));
    request.end();
  });
}

export const defaultNetDeps: NetDeps = { lookup: defaultLookup, connect: defaultConnect };

export type ResolveResult =
  { ok: true; address: string; all: string[] } | { ok: false; reason: 'dns-failed' | 'private-address' };

/** Resolves a host once and requires every address to be public. A literal IP skips DNS but is classified. */
export async function resolvePublic(
  host: string,
  deps: Pick<NetDeps, 'lookup'> = defaultNetDeps
): Promise<ResolveResult> {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return { ok: false, reason: 'dns-failed' };
  if (isPrivateTextHost(h)) return { ok: false, reason: 'private-address' };
  if (isIpLiteral(h)) {
    return isPublicAddress(h) ? { ok: true, address: h, all: [h] } : { ok: false, reason: 'private-address' };
  }
  let all: string[];
  try {
    all = await deps.lookup(h);
  } catch {
    return { ok: false, reason: 'dns-failed' };
  }
  if (!Array.isArray(all) || all.length === 0) return { ok: false, reason: 'dns-failed' };
  // One bad address in a mixed answer fails the whole name.
  if (!all.every((a) => typeof a === 'string' && isPublicAddress(a))) return { ok: false, reason: 'private-address' };
  const address = all.find((a) => !a.includes(':')) ?? all[0];
  return { ok: true, address, all };
}

/**
 * Whether a host is plainly on this machine or a private network: `localhost`, `*.localhost`,
 * `host.docker.internal` or a non-public IP literal. A name that merely resolves to a private address is not
 * matched (no lookup here). The outbound fetch still refuses private addresses on a shared machine.
 */
export function isLocalOriginHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return false;
  return isPrivateTextHost(h) || (isIpLiteral(h) && !isPublicAddress(h));
}

/**
 * Resolves a host once for a local run (ADR 0031 `allowPrivate`): any address is accepted, but the name is
 * still looked up once and the connection still goes to that one address. A literal IP skips DNS.
 */
async function resolveAny(host: string, deps: Pick<NetDeps, 'lookup'>): Promise<ResolveResult> {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return { ok: false, reason: 'dns-failed' };
  if (isIpLiteral(h)) return { ok: true, address: h, all: [h] };
  let all: string[];
  try {
    all = await deps.lookup(h);
  } catch {
    return { ok: false, reason: 'dns-failed' };
  }
  if (!Array.isArray(all) || all.length === 0 || !all.every((a) => typeof a === 'string' && a)) {
    return { ok: false, reason: 'dns-failed' };
  }
  const address = all.find((a) => !a.includes(':')) ?? all[0];
  return { ok: true, address, all };
}

/** Headers that may follow a redirect to another origin; anything else (Cookie, tokens) stays with the first origin. */
const CROSS_ORIGIN_HEADERS = new Set(['accept', 'accept-language', 'user-agent']);

function headersFor(headers: Record<string, string>, sameOrigin: boolean): Record<string, string> {
  if (sameOrigin) return { ...headers };
  return Object.fromEntries(Object.entries(headers).filter(([k]) => CROSS_ORIGIN_HEADERS.has(k.toLowerCase())));
}

export type SafeGetFailure =
  'dns-failed' | 'private-address' | 'redirected' | 'timeout' | 'too-large' | 'bad-scheme' | 'error';

export type SafeGetResult =
  | {
      ok: true;
      status: number;
      finalUrl: string;
      headers: Record<string, string | string[] | undefined>;
      body: string;
      bytes: Buffer;
    }
  | { ok: false; reason: SafeGetFailure; status?: number };

export interface SafeGetOptions {
  maxRedirects?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Local run only (ADR 0031): non-public addresses are accepted, still resolved once per hop and pinned.
   * Callers derive it from the run (no browser guard), never from request input.
   */
  allowPrivate?: boolean;
  /** When the redirect limit is reached, return the 3xx itself (ok, with its status and headers) instead of failing. */
  redirectAsResponse?: boolean;
  /** Aborting throws AbortError: no lookup or request starts after the abort, and a request in flight is destroyed. */
  signal?: AbortSignal;
}

/** GET with the checks above on every hop. `maxRedirects` 0 means any 3xx fails as 'redirected'. */
export async function safeGet(
  url: string,
  opts: SafeGetOptions = {},
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
  const firstOrigin = current.origin;
  for (let hop = 0; ; hop++) {
    if (opts.signal?.aborted) throw abortError();
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return { ok: false, reason: 'bad-scheme' };
    const resolved = opts.allowPrivate
      ? await resolveAny(current.hostname, deps)
      : await resolvePublic(current.hostname, deps);
    if (opts.signal?.aborted) throw abortError();
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    // A local run tries the name's other addresses when one refuses: `localhost` is ::1 and 127.0.0.1, and a
    // dev server often listens on only one of them. A public address is one pinned address, as before.
    const candidates = opts.allowPrivate
      ? [resolved.address, ...resolved.all.filter((a) => a !== resolved.address)]
      : [resolved.address];
    let raw: RawResponse | undefined;
    let failure: SafeGetFailure = 'error';
    for (const address of candidates) {
      try {
        raw = await deps.connect({
          url: current,
          address,
          headers: headersFor(opts.headers || {}, current.origin === firstOrigin),
          timeoutMs: opts.timeoutMs ?? CONNECT_TIMEOUT_MS,
          maxBytes,
          signal: opts.signal,
        });
        break;
      } catch (err) {
        // An abort ends the whole fetch: no other address is tried.
        if (opts.signal?.aborted) throw abortError();
        // A timeout means the time is spent: no other address is tried.
        if (err instanceof Error && err.message === 'timeout') {
          failure = 'timeout';
          break;
        }
        failure = 'error';
      }
    }
    if (opts.signal?.aborted) throw abortError();
    if (!raw) return { ok: false, reason: failure };
    if (raw.tooLarge) return { ok: false, reason: 'too-large', status: raw.status };
    const location = raw.headers.location;
    const target = Array.isArray(location) ? location[0] : location;
    if (raw.status >= 300 && raw.status < 400 && target) {
      if (hop >= maxRedirects) {
        if (opts.redirectAsResponse) {
          return {
            ok: true,
            status: raw.status,
            finalUrl: current.toString(),
            headers: raw.headers,
            body: raw.body,
            bytes: rawBytes(raw),
          };
        }
        return { ok: false, reason: 'redirected' };
      }
      try {
        current = new URL(target, current);
      } catch {
        return { ok: false, reason: 'bad-scheme' };
      }
      continue;
    }
    return {
      ok: true,
      status: raw.status,
      finalUrl: current.toString(),
      headers: raw.headers,
      body: raw.body,
      bytes: rawBytes(raw),
    };
  }
}

function rawBytes(raw: RawResponse): Buffer {
  return raw.raw ?? Buffer.from(raw.body, 'utf8');
}

export interface OutboundFetchOptions {
  /**
   * Narrows the run's rule, never widens it: private addresses are reached only when this is not false AND
   * no browser guard is set (a local run). A shared machine (RUNNER_BETA=1) is always public only.
   */
  allowPrivate?: boolean;
  /** Redirects followed, each hop re-checked (default 5). 0 returns a 3xx as the response. */
  maxRedirects?: number;
  /** Body cap in bytes; a body over it still counts as a response with its status and an empty body. */
  maxBytes?: number;
  timeoutMs?: number;
  /** Extra request headers (e.g. Cookie). Dropped, except Accept/User-Agent, on a redirect to another origin. */
  headers?: Record<string, string>;
  /** Network seam for tests. */
  deps?: NetDeps;
  /** Shared with the crawl of the same site: each request waits for its host's turn (ADR 0015). */
  pacer?: HostPacer;
}

/** The checkers' response plus the raw body bytes (binary bodies such as images are not UTF-8 text). */
export interface OutboundResponse extends FetchedResponse {
  bytes: () => Promise<Uint8Array>;
}
export type OutboundFetchFn = (url: string) => Promise<OutboundResponse | null>;

function flatHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

/**
 * Whether private addresses may be reached now: the caller allows it and no browser guard is set (a shared
 * machine, ADR 0014). A policy that only pins a host (a local alias) is not a guard.
 */
export function privateAddressesAllowed(allow: boolean | undefined): boolean {
  return allow !== false && !getBrowserPolicy()?.guard;
}

/**
 * The one outbound path for page- and site-derived addresses (ADR 0031): GET only, through `safeGet`
 * (resolved once per hop, pinned, every redirect hop re-checked). Returns the checkers' `FetchFn`:
 * null when the request was refused or could not be made. Whether private addresses are allowed is read
 * from the run (the browser guard) at call time; the URL passed in can never change it.
 */
export function makeOutboundFetch(opts: OutboundFetchOptions = {}): OutboundFetchFn {
  const deps = opts.deps ?? defaultNetDeps;
  const fetchOnce = async (url: string): Promise<OutboundResponse | null> => {
    const allowPrivate = privateAddressesAllowed(opts.allowPrivate);
    let got: SafeGetResult;
    try {
      got = await safeGet(
        url,
        {
          maxRedirects: opts.maxRedirects,
          maxBytes: opts.maxBytes,
          timeoutMs: opts.timeoutMs,
          headers: opts.headers,
          allowPrivate,
          redirectAsResponse: true,
        },
        deps
      );
    } catch {
      return null;
    }
    if (got.ok) {
      const { body, bytes } = got;
      return {
        status: got.status,
        headers: flatHeaders(got.headers),
        text: async () => body,
        bytes: async () => new Uint8Array(bytes),
      };
    }
    if (got.reason === 'too-large' && typeof got.status === 'number') {
      return { status: got.status, headers: {}, text: async () => '', bytes: async () => new Uint8Array(0) };
    }
    return null;
  };
  const pacer = opts.pacer;
  if (!pacer) return fetchOnce;
  return (url: string) => {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return fetchOnce(url); // safeGet refuses it without a request
    }
    return pacer.run(host, () => fetchOnce(url));
  };
}

/** True when `url` is an http(s) address on the same site as `site` (the crawl's rule: www twin, same port). */
export function sameSiteUrl(url: string | URL, site: string | URL): boolean {
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    const s = typeof site === 'string' ? new URL(site) : site;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return isSameSite(u.host, s.host);
  } catch {
    return false;
  }
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
 * `allowPrivate` (a local run only, ADR 0031 and 0042; never from request input) lets any web address through
 * and still refuses other schemes (file:, chrome: and the like).
 */
export function makeRequestGuard(
  deps: Pick<NetDeps, 'lookup'> = defaultNetDeps,
  opts: { allowPrivate?: boolean } = {}
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
    if (opts.allowPrivate) return true;
    return (await resolvePublic(parsed.hostname, deps)).ok;
  };
}

/** A request the address rule refused, or a name that did not resolve. Nothing was sent. Callers treat it as no answer. */
export class GuardedFetchBlockedError extends Error {
  readonly code = 'ERR_ADDRESS_BLOCKED';
  constructor() {
    super('The address is not a public web address.');
    this.name = 'GuardedFetchBlockedError';
  }
}

export type GuardedFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface GuardedFetchOptions {
  /** Local run only (ADR 0031): private addresses allowed. Narrowed to false when a browser guard is set. Never from request input. */
  allowPrivate?: boolean;
  /** Redirect hops, each checked (default 5). The last 3xx is returned as the response. */
  maxRedirects?: number;
  deps?: NetDeps;
}

/** Statuses that must not carry a body in a `Response`. */
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/** A `Response` built from a pinned `safeGet` result. Only GET responses in the final status range. */
function toResponse(
  status: number,
  body: ArrayBuffer,
  headers: Record<string, string | string[] | undefined>
): Response {
  if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error('unusable response status');
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) h.append(k, item);
  }
  return new Response(NULL_BODY_STATUS.has(status) ? null : body, { status, headers: h });
}

/** A plain ArrayBuffer copy of the bytes (a `Response` body takes ArrayBuffer-backed data). */
function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function headersFromInit(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  new Headers(init).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * `fetch`-shaped GET on the pinned client (`safeGet`, ADR 0031). There is no native fetch here: each hop is resolved
 * once, connected to the checked address, and every redirect hop is checked again. `redirect: 'manual'` returns the
 * 3xx itself, so the caller follows (and checks) it on its own. A refused address, a failed lookup or a non-http(s)
 * URL throws GuardedFetchBlockedError and nothing is sent. Network failure or timeout throws a plain Error. An
 * aborted `signal` rejects with AbortError, the pinned socket is destroyed, and nothing is sent after the abort. A body over the size cap returns its status with an empty body.
 */
export function makeGuardedFetch(opts: GuardedFetchOptions = {}): GuardedFetch {
  const deps = opts.deps ?? defaultNetDeps;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') throw new Error('guarded fetch sends GET only');
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw abortError();
    const manual = init?.redirect === 'manual';
    const got = await safeGet(
      url,
      {
        // Read at call time: a browser guard (shared machine) makes this public only, whatever the caller passed.
        allowPrivate: privateAddressesAllowed(opts.allowPrivate),
        maxRedirects: manual ? 0 : maxRedirects,
        headers: headersFromInit(init?.headers),
        redirectAsResponse: true,
        signal,
      },
      deps
    );
    if (got.ok) return toResponse(got.status, copyBuffer(got.bytes), got.headers);
    if (got.reason === 'too-large' && got.status !== undefined) return toResponse(got.status, new ArrayBuffer(0), {});
    if (got.reason === 'dns-failed' || got.reason === 'private-address' || got.reason === 'bad-scheme') {
      throw new GuardedFetchBlockedError();
    }
    throw new Error(got.reason);
  };
}
