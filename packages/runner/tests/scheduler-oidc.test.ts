/**
 * ADR 0039: Google OIDC token check for the Cloud Scheduler tick call. Tokens are signed with a locally
 * generated RSA key; Google's key download is a fake fetch, so no test touches the network.
 */
import { describe, it, expect } from 'vitest';
import { createHmac, generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from 'crypto';
import {
  GOOGLE_JWKS_URL,
  GoogleOidcVerifier,
  SchedulerAuthError,
  schedulerAuthFromEnv,
} from '../src/helpers/google-oidc-token.js';
import type { KeysFetch } from '../src/helpers/firebase-token.js';

const SA = 'qa-scheduler@my-project.iam.gserviceaccount.com';
const AUD = 'https://qa-check-up.example.run.app';
const KID = 'kid-1';
const NOW = new Date('2026-11-04T09:00:00.000Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: KID, alg: 'RS256', use: 'sig' };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: AUD,
    exp: NOW_S + 3600,
    iat: NOW_S - 10,
    email: SA,
    email_verified: true,
    sub: '1234567890',
    ...overrides,
  };
}

function token(
  payload: Record<string, unknown> = claims(),
  header: Record<string, unknown> = { alg: 'RS256', kid: KID, typ: 'JWT' },
  key: KeyObject = privateKey
): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

function fakeFetch(
  body: unknown = { keys: [jwk] },
  options: { ok?: boolean; status?: number; cacheControl?: string; fail?: boolean } = {}
) {
  const calls: string[] = [];
  const fetch: KeysFetch = async (url) => {
    calls.push(url);
    if (options.fail) throw new Error('network down');
    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'cache-control' ? (options.cacheControl ?? 'public, max-age=3600') : null,
      },
      json: async () => body,
    };
  };
  return { fetch, calls };
}

function verifier(fetch: KeysFetch = fakeFetch().fetch, now: () => Date = () => NOW) {
  return new GoogleOidcVerifier({ serviceAccountEmail: SA, audiences: () => [AUD], fetch, now });
}

async function refused(v: GoogleOidcVerifier, header: unknown): Promise<SchedulerAuthError> {
  const err = await v.verify(header).then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(SchedulerAuthError);
  return err as SchedulerAuthError;
}

describe('Google OIDC scheduler token check (ADR 0039)', () => {
  it('accepts a valid token', async () => {
    await expect(verifier().verify(`Bearer ${token()}`)).resolves.toBeUndefined();
  });

  it('accepts the bare accounts.google.com issuer and an upper-case email', async () => {
    const t = token(claims({ iss: 'accounts.google.com', email: SA.toUpperCase() }));
    await expect(verifier().verify(`Bearer ${t}`)).resolves.toBeUndefined();
  });

  it('fetches the fixed Google key address', async () => {
    const f = fakeFetch();
    await verifier(f.fetch).verify(`Bearer ${token()}`);
    expect(f.calls).toEqual([GOOGLE_JWKS_URL]);
  });

  it("refuses alg 'none', HS256 signed with the public key, and ES256", async () => {
    const v = verifier();
    await refused(v, `Bearer ${b64({ alg: 'none', kid: KID })}.${b64(claims())}.`);
    const hsInput = `${b64({ alg: 'HS256', kid: KID })}.${b64(claims())}`;
    await refused(v, `Bearer ${hsInput}.${createHmac('sha256', publicPem).update(hsInput).digest('base64url')}`);
    await refused(v, `Bearer ${token(claims(), { alg: 'ES256', kid: KID })}`);
  });

  it('refuses a bad signature (another key), a wrong issuer, a wrong audience', async () => {
    const v = verifier();
    await refused(v, `Bearer ${token(claims(), undefined, other.privateKey)}`);
    await refused(v, `Bearer ${token(claims({ iss: 'https://evil.example' }))}`);
    await refused(v, `Bearer ${token(claims({ aud: 'https://other.example.run.app' }))}`);
    await refused(v, `Bearer ${token(claims({ aud: [AUD] }))}`);
  });

  it('refuses expired, future-issued, unverified-email and other-email tokens', async () => {
    const v = verifier();
    await refused(v, `Bearer ${token(claims({ exp: NOW_S - 1 }))}`);
    await refused(v, `Bearer ${token(claims({ iat: NOW_S + 3600 }))}`);
    await refused(v, `Bearer ${token(claims({ email_verified: false }))}`);
    await refused(v, `Bearer ${token(claims({ email_verified: undefined }))}`);
    await refused(v, `Bearer ${token(claims({ email: 'someone@example.com' }))}`);
    await refused(v, `Bearer ${token(claims({ email: undefined }))}`);
  });

  it('refuses an unknown kid and a missing or non-Bearer header', async () => {
    const v = verifier();
    await refused(v, `Bearer ${token(claims(), { alg: 'RS256', kid: 'unknown' })}`);
    await refused(v, undefined);
    await refused(v, '');
    await refused(v, token());
    await refused(v, `Basic ${token()}`);
    await refused(v, 'Bearer ');
  });

  it('refuses an oversized token', async () => {
    await refused(verifier(), `Bearer ${'a'.repeat(9000)}`);
  });

  it('refuses when the key download fails, is not ok, or has no usable key', async () => {
    await refused(verifier(fakeFetch({ keys: [jwk] }, { fail: true }).fetch), `Bearer ${token()}`);
    await refused(verifier(fakeFetch({ keys: [jwk] }, { ok: false, status: 503 }).fetch), `Bearer ${token()}`);
    await refused(verifier(fakeFetch({ keys: [] }).fetch), `Bearer ${token()}`);
    await refused(verifier(fakeFetch({ nothing: 1 }).fetch), `Bearer ${token()}`);
  });

  it('refusal message is fixed and does not contain the token', async () => {
    const t = token(claims({ email: 'someone@example.com' }));
    const err = await refused(verifier(), `Bearer ${t}`);
    expect(err.message).toBe('The scheduler token was refused.');
    expect(err.message).not.toContain(t);
    expect(JSON.stringify(err)).not.toContain(t);
  });

  it('keeps keys for the max-age: one fetch for two checks, a new one after it', async () => {
    const f = fakeFetch(undefined, { cacheControl: 'public, max-age=600' });
    let nowMs = NOW.getTime();
    const v = verifier(f.fetch, () => new Date(nowMs));
    await v.verify(`Bearer ${token()}`);
    await v.verify(`Bearer ${token()}`);
    expect(f.calls).toHaveLength(1);
    nowMs += 601_000;
    await v.verify(`Bearer ${token(claims({ exp: NOW_S + 7200, iat: NOW_S + 590 }))}`);
    expect(f.calls).toHaveLength(2);
  });

  it('schedulerAuthFromEnv: none when blank or unset, a verifier when set', () => {
    expect(schedulerAuthFromEnv({}, () => [AUD])).toBeUndefined();
    expect(schedulerAuthFromEnv({ SCHEDULER_SERVICE_ACCOUNT: '   ' }, () => [AUD])).toBeUndefined();
    expect(schedulerAuthFromEnv({ SCHEDULER_SERVICE_ACCOUNT: SA }, () => [AUD])).toBeInstanceOf(GoogleOidcVerifier);
  });
});
