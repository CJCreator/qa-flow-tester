/**
 * Firebase Authentication ID token check for Helper sign-in (REQ-033, ADR 0037, Q-38). Done in code with
 * node:crypto, without the Firebase Admin SDK: RS256 only, signature against Google's published securetoken
 * keys, then issuer, audience, expiry, issued-at, auth time, subject and a verified email.
 *
 * The token is only read here. It is never stored, logged or put into an error: every refusal is the same
 * HelperSignInError with a fixed message, so nothing about the token reaches a reply.
 */
import { createPublicKey, verify, type KeyObject } from 'crypto';

/** Google's public keys for Firebase ID tokens (X.509 certificates by key id). Fixed: never from config. */
export const SECURETOKEN_KEYS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/** Allowed clock difference for iat and auth_time in the future (5 minutes). */
export const CLOCK_SKEW_SECONDS = 5 * 60;
/** Longest token accepted, so an oversized body can't make us parse megabytes. */
export const MAX_ID_TOKEN_CHARS = 8192;
/** Key cache when Google's reply has no usable max-age. */
const DEFAULT_KEYS_TTL_SECONDS = 60 * 60;
/** Never keep keys longer than a day, whatever the header says. */
const MAX_KEYS_TTL_SECONDS = 24 * 60 * 60;
const KEYS_FETCH_TIMEOUT_MS = 5000;

/** The fetch the key loader uses: the standard one, or a fake in tests. */
export type KeysFetch = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

/** Every refusal of a token. The message is fixed and says nothing about the token. */
export class HelperSignInError extends Error {
  constructor() {
    super('The Google sign-in token was refused.');
    this.name = 'HelperSignInError';
  }
}

/** A verified Helper identity. */
export interface VerifiedHelperToken {
  /** The Google account address, trimmed and lower-cased. */
  email: string;
  sub: string;
}

export interface FirebaseTokenVerifierOptions {
  /** The Firebase project ID (FIREBASE_PROJECT_ID). */
  projectId: string;
  /** Default: globalThis.fetch. Tests inject a fake: no real network. */
  fetch?: KeysFetch;
  /** Default: the system clock. */
  now?: () => Date;
}

interface KeyCache {
  keys: Map<string, KeyObject>;
  expiresAtMs: number;
}

function refuse(): never {
  throw new HelperSignInError();
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function decodeJsonPart(part: string): Record<string, unknown> {
  if (!BASE64URL.test(part)) refuse();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    refuse();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) refuse();
  return parsed as Record<string, unknown>;
}

/** max-age from a Cache-Control header, in seconds; the default when missing or unusable. */
export function cacheSeconds(cacheControl: string | null): number {
  const match = /(?:^|[,\s])max-age=(\d+)/i.exec(cacheControl ?? '');
  if (!match) return DEFAULT_KEYS_TTL_SECONDS;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_KEYS_TTL_SECONDS;
  return Math.min(seconds, MAX_KEYS_TTL_SECONDS);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Verifies Firebase ID tokens for one project. Keeps Google's keys in memory for as long as the key reply's
 * Cache-Control allows; concurrent sign-ins share one key download.
 */
export class FirebaseTokenVerifier {
  private readonly projectId: string;
  private readonly fetchImpl: KeysFetch;
  private readonly now: () => Date;
  private cache: KeyCache | null = null;
  private loading: Promise<KeyCache> | null = null;

  constructor(options: FirebaseTokenVerifierOptions) {
    const projectId = options.projectId.trim();
    if (!projectId) throw new Error('A Firebase project ID is required.');
    this.projectId = projectId;
    this.fetchImpl = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.now = options.now ?? (() => new Date());
  }

  /** The identity in a valid token; throws HelperSignInError for anything else. */
  async verify(idToken: unknown): Promise<VerifiedHelperToken> {
    if (typeof idToken !== 'string' || idToken.length === 0 || idToken.length > MAX_ID_TOKEN_CHARS) refuse();
    const parts = idToken.split('.');
    if (parts.length !== 3) refuse();
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    const header = decodeJsonPart(headerPart);
    // RS256 only: 'none', HS256 (a public key used as an HMAC secret) and every other algorithm are refused.
    if (header.alg !== 'RS256') refuse();
    if (typeof header.kid !== 'string' || header.kid === '') refuse();
    if (!BASE64URL.test(signaturePart)) refuse();

    const key = await this.keyFor(header.kid);
    const signed = verify(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`, 'utf8'),
      key,
      Buffer.from(signaturePart, 'base64url')
    );
    if (!signed) refuse();

    const claims = decodeJsonPart(payloadPart);
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (claims.iss !== `https://securetoken.google.com/${this.projectId}`) refuse();
    if (claims.aud !== this.projectId) refuse();
    if (!isNumber(claims.exp) || claims.exp <= nowSeconds) refuse();
    if (!isNumber(claims.iat) || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) refuse();
    if (!isNumber(claims.auth_time) || claims.auth_time > nowSeconds + CLOCK_SKEW_SECONDS) refuse();
    if (typeof claims.sub !== 'string' || claims.sub === '' || claims.sub.length > 128) refuse();
    if (typeof claims.email !== 'string' || claims.email.trim() === '') refuse();
    if (claims.email_verified !== true) refuse();
    // ADR 0037 is Google sign-in: a password or other provider with a verified email is refused.
    const firebase = claims.firebase;
    if (
      firebase === null ||
      typeof firebase !== 'object' ||
      (firebase as Record<string, unknown>).sign_in_provider !== 'google.com'
    ) {
      refuse();
    }

    return { email: claims.email.trim().toLowerCase(), sub: claims.sub };
  }

  private async keyFor(kid: string): Promise<KeyObject> {
    const cache = await this.keys();
    const key = cache.keys.get(kid);
    if (!key) refuse();
    return key;
  }

  private async keys(): Promise<KeyCache> {
    if (this.cache && this.cache.expiresAtMs > this.now().getTime()) return this.cache;
    if (!this.loading) {
      this.loading = this.loadKeys().finally(() => {
        this.loading = null;
      });
    }
    return this.loading;
  }

  private async loadKeys(): Promise<KeyCache> {
    let reply: Awaited<ReturnType<KeysFetch>>;
    let body: unknown;
    try {
      reply = await this.fetchImpl(SECURETOKEN_KEYS_URL, { signal: AbortSignal.timeout(KEYS_FETCH_TIMEOUT_MS) });
      if (!reply.ok) refuse();
      body = await reply.json();
    } catch {
      refuse();
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) refuse();

    const keys = new Map<string, KeyObject>();
    for (const [kid, pem] of Object.entries(body as Record<string, unknown>)) {
      if (typeof pem !== 'string') continue;
      try {
        const key = createPublicKey(pem);
        if (key.asymmetricKeyType === 'rsa') keys.set(kid, key);
      } catch {
        // A certificate that does not parse is skipped; the others still work.
      }
    }
    if (keys.size === 0) refuse();
    const cache: KeyCache = {
      keys,
      expiresAtMs: this.now().getTime() + cacheSeconds(reply.headers.get('cache-control')) * 1000,
    };
    this.cache = cache;
    return cache;
  }
}
