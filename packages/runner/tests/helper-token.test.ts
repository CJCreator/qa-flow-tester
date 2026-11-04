/**
 * REQ-033 (BE-606): Firebase ID token check without the Admin SDK. Tokens are signed with a locally generated
 * RSA key; Google's key download is a fake fetch, so no test touches the network.
 */
import { describe, it, expect } from 'vitest';
import { createHmac, generateKeyPairSync, sign, type KeyObject } from 'crypto';
import {
  FirebaseTokenVerifier,
  HelperSignInError,
  SECURETOKEN_KEYS_URL,
  cacheSeconds,
  type KeysFetch,
} from '../src/helpers/firebase-token.js';

const PROJECT = 'qa-helpers-test';
const KID = 'kid-1';
const NOW = new Date('2026-11-03T09:00:00.000Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    exp: NOW_S + 3600,
    iat: NOW_S - 10,
    auth_time: NOW_S - 10,
    sub: 'google-user-1',
    email: 'Priya.K@Example.com',
    email_verified: true,
    firebase: { sign_in_provider: 'google.com', identities: {} },
    ...overrides,
  };
}

function signToken(
  payload: Record<string, unknown> = claims(),
  header: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' },
  key: KeyObject = privateKey
): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

function fakeFetch(keys: Record<string, string> = { [KID]: publicPem }, cacheControl = 'public, max-age=3600') {
  const calls: string[] = [];
  const fetch: KeysFetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'cache-control' ? cacheControl : null) },
      json: async () => keys,
    };
  };
  return { fetch, calls };
}

function verifier(fetch: KeysFetch = fakeFetch().fetch, now: () => Date = () => NOW) {
  return new FirebaseTokenVerifier({ projectId: PROJECT, fetch, now });
}

async function refused(v: FirebaseTokenVerifier, token: unknown): Promise<HelperSignInError> {
  const err = await v.verify(token).then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(HelperSignInError);
  return err as HelperSignInError;
}

describe('Firebase ID token check (REQ-033)', () => {
  it('accepts a valid RS256 token and returns the lower-cased email', async () => {
    const result = await verifier().verify(signToken());
    expect(result).toEqual({ email: 'priya.k@example.com', sub: 'google-user-1' });
  });

  it("refuses alg 'none', HS256 signed with the public key, and any other alg", async () => {
    const v = verifier();
    const none = `${b64({ alg: 'none', kid: KID })}.${b64(claims())}.`;
    await refused(v, none);

    const hsInput = `${b64({ alg: 'HS256', kid: KID })}.${b64(claims())}`;
    const hs = `${hsInput}.${createHmac('sha256', publicPem).update(hsInput).digest('base64url')}`;
    await refused(v, hs);

    await refused(v, signToken(claims(), { alg: 'RS512', kid: KID }));
    await refused(v, signToken(claims(), { alg: 'RS256' })); // no kid
  });

  it('refuses a token signed by another key, an unknown kid, or a changed payload', async () => {
    const v = verifier();
    await refused(v, signToken(claims(), undefined, other.privateKey));
    await refused(v, signToken(claims(), { alg: 'RS256', kid: 'kid-unknown' }));
    const [h, , s] = signToken().split('.');
    await refused(v, `${h}.${b64(claims({ email: 'attacker@example.com' }))}.${s}`);
  });

  it('refuses a wrong issuer or audience', async () => {
    const v = verifier();
    await refused(v, signToken(claims({ iss: 'https://securetoken.google.com/other-project' })));
    await refused(v, signToken(claims({ iss: 'https://accounts.google.com' })));
    await refused(v, signToken(claims({ aud: 'other-project' })));
    await refused(v, signToken(claims({ aud: [PROJECT] })));
  });

  it('refuses an expired token, and iat or auth_time more than 5 minutes ahead', async () => {
    const v = verifier();
    await refused(v, signToken(claims({ exp: NOW_S - 1 })));
    await refused(v, signToken(claims({ exp: NOW_S })));
    await refused(v, signToken(claims({ exp: undefined })));
    await refused(v, signToken(claims({ iat: NOW_S + 301 })));
    await refused(v, signToken(claims({ auth_time: NOW_S + 301 })));
    await refused(v, signToken(claims({ iat: undefined })));
    await refused(v, signToken(claims({ auth_time: undefined })));
    // Within the 5-minute skew is fine.
    await expect(v.verify(signToken(claims({ iat: NOW_S + 299, auth_time: NOW_S + 299 })))).resolves.toBeTruthy();
  });

  it('refuses a token without sub, without email, or with an unverified email', async () => {
    const v = verifier();
    await refused(v, signToken(claims({ sub: '' })));
    await refused(v, signToken(claims({ sub: undefined })));
    await refused(v, signToken(claims({ email: undefined })));
    await refused(v, signToken(claims({ email: '  ' })));
    await refused(v, signToken(claims({ email_verified: false })));
    await refused(v, signToken(claims({ email_verified: 'true' })));
    await refused(v, signToken(claims({ email_verified: undefined })));
  });

  it('accepts only the google.com sign-in provider', async () => {
    const v = verifier();
    await expect(v.verify(signToken(claims()))).resolves.toBeTruthy();
    await refused(v, signToken(claims({ firebase: { sign_in_provider: 'password' } })));
    await refused(v, signToken(claims({ firebase: { sign_in_provider: 'github.com' } })));
    await refused(v, signToken(claims({ firebase: {} })));
    await refused(v, signToken(claims({ firebase: null })));
    await refused(v, signToken(claims({ firebase: undefined })));
  });

  it('refuses malformed and oversized input', async () => {
    const v = verifier();
    for (const bad of [undefined, null, 42, '', 'a.b', 'a.b.c.d', '!!.??.**', 'x'.repeat(9000)]) await refused(v, bad);
  });

  it('never puts the token in the error', async () => {
    const token = signToken(claims({ exp: NOW_S - 1 }));
    const err = await refused(verifier(), token);
    expect(err.message).not.toContain(token);
    expect(String(err.stack)).not.toContain(token);
  });

  it("loads keys from Google's fixed URL and caches them per Cache-Control max-age", async () => {
    let now = NOW;
    const { fetch, calls } = fakeFetch(undefined, 'public, max-age=600, must-revalidate');
    const v = verifier(fetch, () => now);
    await v.verify(signToken());
    await v.verify(signToken());
    expect(calls).toEqual([SECURETOKEN_KEYS_URL]);

    now = new Date(NOW.getTime() + 601_000);
    const later = Math.floor(now.getTime() / 1000);
    await v.verify(signToken(claims({ iat: later - 5, auth_time: later - 5, exp: later + 600 })));
    expect(calls).toHaveLength(2);
  });

  it('shares one key download between concurrent checks', async () => {
    const { fetch, calls } = fakeFetch();
    const v = verifier(fetch);
    await Promise.all([v.verify(signToken()), v.verify(signToken()), v.verify(signToken())]);
    expect(calls).toHaveLength(1);
  });

  it('refuses when the key download fails or answers an error', async () => {
    const failing: KeysFetch = async () => {
      throw new Error('offline');
    };
    await refused(verifier(failing), signToken());
    const notOk: KeysFetch = async () => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({}),
    });
    await refused(verifier(notOk), signToken());
    await refused(verifier(fakeFetch({ [KID]: 'not a pem' }).fetch), signToken());
  });

  it('reads max-age from Cache-Control, with a default and a cap', () => {
    expect(cacheSeconds('public, max-age=19302, must-revalidate, no-transform')).toBe(19302);
    expect(cacheSeconds(null)).toBe(3600);
    expect(cacheSeconds('no-cache')).toBe(3600);
    expect(cacheSeconds('max-age=0')).toBe(3600);
    expect(cacheSeconds('max-age=999999999')).toBe(86400);
  });

  it('requires a project ID', () => {
    expect(() => new FirebaseTokenVerifier({ projectId: '  ' })).toThrow();
  });
});
