/**
 * Google-signed OIDC ID token check for the Cloud Scheduler tick call (ADR 0039). Same approach as
 * firebase-token.ts: node:crypto, RS256 only, Google's published keys (JWKS), then issuer, audience, expiry,
 * issued-at, a verified email, and that email is the one configured service account.
 *
 * The token is only read here. It is never stored, logged or put into an error: every refusal is the same
 * SchedulerAuthError with a fixed message.
 */
import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'crypto';
import {
  CLOCK_SKEW_SECONDS,
  MAX_ID_TOKEN_CHARS,
  cacheSeconds,
  decodeJsonPart,
  type KeysFetch,
} from './firebase-token.js';

/** Google's public keys for OIDC ID tokens (JWKS). Fixed: never from config. */
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

const GOOGLE_ISSUERS: ReadonlySet<string> = new Set(['https://accounts.google.com', 'accounts.google.com']);
const KEYS_FETCH_TIMEOUT_MS = 5000;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Every refusal of a scheduler token. The message is fixed and says nothing about the token. */
export class SchedulerAuthError extends Error {
  constructor() {
    super('The scheduler token was refused.');
    this.name = 'SchedulerAuthError';
  }
}

export interface GoogleOidcVerifierOptions {
  /** The one service account whose token is accepted (SCHEDULER_SERVICE_ACCOUNT). */
  serviceAccountEmail: string;
  /** The audiences accepted: this runner's own URLs. Read per call, so it follows the runner's origins. */
  audiences: () => string[];
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
  throw new SchedulerAuthError();
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export class GoogleOidcVerifier {
  private readonly email: string;
  private readonly audiences: () => string[];
  private readonly fetchImpl: KeysFetch;
  private readonly now: () => Date;
  private cache: KeyCache | null = null;
  private loading: Promise<KeyCache> | null = null;

  constructor(options: GoogleOidcVerifierOptions) {
    const email = options.serviceAccountEmail.trim().toLowerCase();
    if (!email) throw new Error('A scheduler service account is required.');
    this.email = email;
    this.audiences = options.audiences;
    this.fetchImpl = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.now = options.now ?? (() => new Date());
  }

  /** Resolves for a valid scheduler token in an `Authorization` header; throws SchedulerAuthError otherwise. */
  async verify(authorizationHeader: unknown): Promise<void> {
    try {
      await this.check(authorizationHeader);
    } catch {
      // Whatever went wrong, the caller sees the same fixed refusal.
      refuse();
    }
  }

  private async check(authorizationHeader: unknown): Promise<void> {
    if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) refuse();
    const token = authorizationHeader.slice('Bearer '.length).trim();
    if (token.length === 0 || token.length > MAX_ID_TOKEN_CHARS) refuse();
    const parts = token.split('.');
    if (parts.length !== 3) refuse();
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    const header = decodeJsonPart(headerPart);
    if (header.alg !== 'RS256') refuse();
    if (typeof header.kid !== 'string' || header.kid === '') refuse();
    if (!BASE64URL.test(signaturePart)) refuse();

    const cache = await this.keys();
    const key = cache.keys.get(header.kid);
    if (!key) refuse();
    const signed = verify(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`, 'utf8'),
      key,
      Buffer.from(signaturePart, 'base64url')
    );
    if (!signed) refuse();

    const claims = decodeJsonPart(payloadPart);
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.has(claims.iss)) refuse();
    if (typeof claims.aud !== 'string' || !this.audiences().includes(claims.aud)) refuse();
    if (!isNumber(claims.exp) || claims.exp <= nowSeconds) refuse();
    if (!isNumber(claims.iat) || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) refuse();
    if (claims.email_verified !== true) refuse();
    if (typeof claims.email !== 'string' || claims.email.trim().toLowerCase() !== this.email) refuse();
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
      reply = await this.fetchImpl(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(KEYS_FETCH_TIMEOUT_MS) });
      if (!reply.ok) refuse();
      body = await reply.json();
    } catch {
      refuse();
    }
    const list = (body as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(list)) refuse();

    const keys = new Map<string, KeyObject>();
    for (const jwk of list) {
      if (jwk === null || typeof jwk !== 'object') continue;
      const { kid, kty } = jwk as { kid?: unknown; kty?: unknown };
      if (typeof kid !== 'string' || kty !== 'RSA') continue;
      try {
        const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
        if (key.asymmetricKeyType === 'rsa') keys.set(kid, key);
      } catch {
        // A key that does not parse is skipped; the others still work.
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

/** The verifier the environment asks for; none (the tick route stays closed) when SCHEDULER_SERVICE_ACCOUNT is blank. */
export function schedulerAuthFromEnv(
  env: Record<string, string | undefined>,
  audiences: () => string[]
): GoogleOidcVerifier | undefined {
  const email = env.SCHEDULER_SERVICE_ACCOUNT?.trim();
  if (!email) return undefined;
  return new GoogleOidcVerifier({ serviceAccountEmail: email, audiences });
}
