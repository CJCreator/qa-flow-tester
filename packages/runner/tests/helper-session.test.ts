/** REQ-033 (BE-606, DEC-011): the signed Helper session cookie. */
import { describe, it, expect } from 'vitest';
import type http from 'http';
import { createHmac, hkdfSync } from 'crypto';
import {
  HELPER_COOKIE,
  HELPER_SESSION_KEY_BYTES,
  HELPER_SESSION_SECONDS,
  clearHelperSessionCookie,
  cookieFrom,
  helperSessionCookie,
  isHttpsRequest,
  newHelperSessionKey,
  readHelperSession,
  readHelperSessionValue,
  signHelperSession,
} from '../src/helpers/helper-session.js';

const ACCESS = 'test-access-key-0123456789';
const NOW = new Date('2026-11-03T09:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const SUB = 'google-uid-1';
const key = newHelperSessionKey();

/** The pre-DEC-011 key: HKDF of the access key with the fixed, published salt and label (F-045). */
const oldAccessDerivedKey = (accessToken: string) =>
  Buffer.from(hkdfSync('sha256', accessToken, 'qa-helper-session', 'qa helper session cookie v1', 32));

/** A cookie value with any claims, MACed under `k` as this code signs (to test what the reader accepts). */
function signedWith(k: Buffer, claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${createHmac('sha256', k).update(payload).digest('base64url')}`;
}

const who = (email: string, sub = SUB) => ({ email, sub });

function fakeReq(headers: http.IncomingHttpHeaders, encrypted = false): http.IncomingMessage {
  return { headers, socket: { encrypted } } as unknown as http.IncomingMessage;
}

describe('Helper session cookie (REQ-033)', () => {
  it('holds only the lower-cased email, the Google account id and the expiry, and reads back', () => {
    const value = signHelperSession(key, who('  Priya.K@Example.COM '), NOW);
    const payload = JSON.parse(Buffer.from(value.split('.')[0]!, 'base64url').toString('utf8'));
    expect(Object.keys(payload).sort()).toEqual(['email', 'exp', 'sub']);
    expect(payload).toEqual({ email: 'priya.k@example.com', sub: SUB, exp: NOW_SECONDS + 8 * 3600 });
    expect(readHelperSessionValue(key, value, NOW)).toEqual(payload);
    expect(value).not.toContain(ACCESS);
  });

  it('is at most 8 hours long', () => {
    expect(HELPER_SESSION_SECONDS).toBe(28800);
    const value = signHelperSession(key, who('a@example.com'), NOW, 999_999);
    const { exp } = readHelperSessionValue(key, value, NOW)!;
    expect(exp - NOW_SECONDS).toBe(28800);
  });

  it('a tampered, foreign-key, malformed or expired cookie is no Helper', () => {
    const value = signHelperSession(key, who('a@example.com'), NOW);
    const [payload, mac] = value.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ email: 'b@example.com', sub: SUB, exp: 9_999_999_999 })).toString(
      'base64url'
    );
    expect(readHelperSessionValue(key, `${forged}.${mac}`, NOW)).toBeNull();
    const flipped = `${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
    expect(readHelperSessionValue(key, `${payload}.${flipped}`, NOW)).toBeNull();
    expect(readHelperSessionValue(key, `${payload}.`, NOW)).toBeNull();
    expect(readHelperSessionValue(key, payload, NOW)).toBeNull();
    expect(readHelperSessionValue(key, `${value}.x`, NOW)).toBeNull();
    expect(readHelperSessionValue(key, undefined, NOW)).toBeNull();
    expect(readHelperSessionValue(newHelperSessionKey(), value, NOW)).toBeNull();

    const expiredAt = new Date(NOW.getTime() + 8 * 3600 * 1000);
    expect(readHelperSessionValue(key, value, expiredAt)).toBeNull();
    expect(readHelperSessionValue(key, value, new Date(expiredAt.getTime() - 1000))).not.toBeNull();
  });

  it('refuses a correctly signed cookie that claims more than 8 hours', () => {
    const value = signedWith(key, { email: 'a@example.com', sub: SUB, exp: NOW_SECONDS + 9 * 3600 });
    expect(readHelperSessionValue(key, value, NOW)).toBeNull();
  });

  it('F-045: signs with a random 32-byte key, never one derived from the access key', () => {
    expect(HELPER_SESSION_KEY_BYTES).toBe(32);
    expect(key.length).toBe(32);
    expect(key.equals(Buffer.from(ACCESS))).toBe(false);
    expect(key.equals(oldAccessDerivedKey(ACCESS))).toBe(false);
    // A new key each time: knowing the access key (every beta tester does) gives nothing.
    expect(newHelperSessionKey().equals(key)).toBe(false);
    expect(newHelperSessionKey().equals(newHelperSessionKey())).toBe(false);
  });

  it('F-045: a cookie signed with the old HKDF(access key) key is refused', () => {
    const forged = signedWith(oldAccessDerivedKey(ACCESS), {
      email: 'victim@example.com',
      sub: SUB,
      exp: NOW_SECONDS + 3600,
    });
    expect(readHelperSessionValue(key, forged, NOW)).toBeNull();
    // The old cookie shape (email and expiry only) is refused too, whatever key signed it.
    const oldShape = signedWith(oldAccessDerivedKey(ACCESS), { email: 'victim@example.com', exp: NOW_SECONDS + 3600 });
    expect(readHelperSessionValue(key, oldShape, NOW)).toBeNull();
  });

  it('a cookie without a Google account id, or with a changed one, is no Helper', () => {
    const exp = NOW_SECONDS + 3600;
    // Correctly signed, but no usable `sub`.
    for (const sub of [undefined, '', 42, null, ['uid'], 'x'.repeat(129)]) {
      const claims: Record<string, unknown> = { email: 'a@example.com', exp };
      if (sub !== undefined) claims.sub = sub;
      expect(readHelperSessionValue(key, signedWith(key, claims), NOW)).toBeNull();
    }
    expect(
      readHelperSessionValue(key, signedWith(key, { email: 'a@example.com', sub: 'x'.repeat(128), exp }), NOW)
    ).not.toBeNull();

    // The MAC covers `sub`: another account id with the original MAC is refused.
    const value = signHelperSession(key, who('a@example.com'), NOW);
    const mac = value.split('.')[1]!;
    const claims = readHelperSessionValue(key, value, NOW)!;
    const otherSub = Buffer.from(JSON.stringify({ ...claims, sub: 'google-uid-2' })).toString('base64url');
    expect(readHelperSessionValue(key, `${otherSub}.${mac}`, NOW)).toBeNull();
    const noSub = Buffer.from(JSON.stringify({ email: claims.email, exp: claims.exp })).toString('base64url');
    expect(readHelperSessionValue(key, `${noSub}.${mac}`, NOW)).toBeNull();
  });

  it('will not sign a session without a Google account id', () => {
    expect(() => signHelperSession(key, who('a@example.com', ''), NOW)).toThrow();
    expect(() => signHelperSession(key, { email: 'a@example.com' } as { email: string; sub: string }, NOW)).toThrow();
  });

  it('sets HttpOnly, SameSite=Strict, Path=/ and Max-Age, and Secure only on https', () => {
    const plain = helperSessionCookie('v', false);
    expect(plain).toBe(`${HELPER_COOKIE}=v; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
    const secure = helperSessionCookie('v', true);
    expect(secure).toContain('; Secure');
    expect(helperSessionCookie('v', false, 10 * 3600)).toContain('Max-Age=28800');
  });

  it('sign-out clears the cookie with the same attributes', () => {
    const cleared = clearHelperSessionCookie(true);
    expect(cleared).toMatch(new RegExp(`^${HELPER_COOKIE}=;`));
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=Strict');
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('Secure');
  });

  it('reads the session from the Cookie header among others', () => {
    const value = signHelperSession(key, who('a@example.com'), NOW);
    const req = fakeReq({ cookie: `qa_access=x; ${HELPER_COOKIE}=${value}; other=1` });
    expect(readHelperSession(key, req, NOW)?.email).toBe('a@example.com');
    expect(readHelperSession(key, req, NOW)?.sub).toBe(SUB);
    expect(readHelperSession(key, fakeReq({}), NOW)).toBeNull();
    expect(cookieFrom('a=1; b=%E0%A4%A', 'b')).toBeUndefined();
  });

  it('knows an https visit directly or through a proxy or tunnel', () => {
    expect(isHttpsRequest(fakeReq({}))).toBe(false);
    expect(isHttpsRequest(fakeReq({}, true))).toBe(true);
    expect(isHttpsRequest(fakeReq({ 'x-forwarded-proto': 'https' }))).toBe(true);
    expect(isHttpsRequest(fakeReq({ 'x-forwarded-proto': 'http' }))).toBe(false);
    expect(isHttpsRequest(fakeReq({ 'cf-visitor': '{"scheme":"https"}' }))).toBe(true);
  });
});
