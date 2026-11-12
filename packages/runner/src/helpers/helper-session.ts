/**
 * The Helper session cookie (REQ-033, ADR 0037, DEC-011): after a verified Google sign-in the runner sets one
 * cookie holding only the Helper's lower-cased email, the Google account id (`sub`) it was issued for, and its
 * expiry, signed with HMAC-SHA256 under a random key the runner's HelperAccess makes when it is created and
 * keeps in memory only. Nothing is derived from RUNNER_ACCESS_TOKEN, which beta testers hold. A Helper signs
 * in again after a runner restart. HttpOnly, SameSite=Strict, Path=/, Secure on https, at most 8 hours.
 * Nothing else (no ID token, no grants) is kept: grants are read from the store on every request.
 */
import type http from 'http';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { readCookie, cookieFrom } from '../cookies.js';

export { readCookie, cookieFrom };

export const HELPER_COOKIE = 'qa_helper';
/** Longest Helper session: 8 hours. */
export const HELPER_SESSION_SECONDS = 8 * 60 * 60;
/** Size of the cookie signing key. */
export const HELPER_SESSION_KEY_BYTES = 32;
/** Longest cookie value read; anything longer is no session. */
const MAX_COOKIE_CHARS = 1024;
/** Longest Google account id accepted, as the Firebase token check. */
const MAX_SUB_CHARS = 128;

/** What the cookie holds. */
export interface HelperSessionClaims {
  /** Lower-cased Google account address. */
  email: string;
  /** The Google account id (Firebase `sub`) the session was issued for. */
  sub: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

/** A new random cookie signing key (DEC-011): one per HelperAccess, held in memory only, never derived. */
export function newHelperSessionKey(): Buffer {
  return randomBytes(HELPER_SESSION_KEY_BYTES);
}

function mac(key: Buffer, payload: string): Buffer {
  return createHmac('sha256', key).update(payload, 'utf8').digest();
}

function isSub(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= MAX_SUB_CHARS;
}

/** The signed cookie value for this verified Google account, valid for `seconds` (capped at 8 hours). */
export function signHelperSession(
  key: Buffer,
  who: Pick<HelperSessionClaims, 'email' | 'sub'>,
  now: Date,
  seconds = HELPER_SESSION_SECONDS
): string {
  if (!isSub(who.sub)) throw new Error('A Helper session needs the Google account id.');
  const lifetime = Math.max(1, Math.min(Math.floor(seconds), HELPER_SESSION_SECONDS));
  const claims: HelperSessionClaims = {
    email: who.email.trim().toLowerCase(),
    sub: who.sub,
    exp: Math.floor(now.getTime() / 1000) + lifetime,
  };
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${payload}.${mac(key, payload).toString('base64url')}`;
}

/** The claims in a cookie value, or null when it is missing, tampered, malformed or expired. */
export function readHelperSessionValue(key: Buffer, value: string | undefined, now: Date): HelperSessionClaims | null {
  if (!value || value.length > MAX_COOKIE_CHARS) return null;
  const dot = value.indexOf('.');
  if (dot <= 0 || dot !== value.lastIndexOf('.')) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), 'base64url');
  const expected = mac(key, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims === null || typeof claims !== 'object') return null;
  const { email, sub, exp } = claims as Record<string, unknown>;
  if (typeof email !== 'string' || email === '' || email !== email.toLowerCase()) return null;
  if (!isSub(sub)) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  // Expired, or claiming more than the longest session (a cookie this code never signs).
  if (exp <= nowSeconds || exp > nowSeconds + HELPER_SESSION_SECONDS) return null;
  return { email, sub, exp };
}

/** The request's Helper session, or null. */
export function readHelperSession(key: Buffer, req: http.IncomingMessage, now: Date): HelperSessionClaims | null {
  return readHelperSessionValue(key, cookieFrom(req.headers.cookie, HELPER_COOKIE), now);
}

/** Whether the visit came over https (directly, or as a proxy or tunnel says), for the Secure flag. */
export function isHttpsRequest(req: http.IncomingMessage): boolean {
  if ((req.socket as { encrypted?: boolean } | undefined)?.encrypted) return true;
  const proto = req.headers['x-forwarded-proto'];
  const first = Array.isArray(proto) ? proto[0] : proto;
  if (first?.split(',')[0]?.trim().toLowerCase() === 'https') return true;
  const cfVisitor = req.headers['cf-visitor'];
  return typeof cfVisitor === 'string' && cfVisitor.includes('"https"');
}

function attributes(secure: boolean): string {
  return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

/** Set-Cookie for a new Helper session. */
export function helperSessionCookie(value: string, secure: boolean, seconds = HELPER_SESSION_SECONDS): string {
  const maxAge = Math.max(1, Math.min(Math.floor(seconds), HELPER_SESSION_SECONDS));
  return `${HELPER_COOKIE}=${value}; ${attributes(secure)}; Max-Age=${maxAge}`;
}

/** Set-Cookie that removes the Helper session (sign-out). */
export function clearHelperSessionCookie(secure: boolean): string {
  return `${HELPER_COOKIE}=; ${attributes(secure)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
