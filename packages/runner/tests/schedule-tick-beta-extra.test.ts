/** Tester-added (ADR 0039): on a beta copy the owner key alone, a key plus a bad token, and no credential cannot open the tick. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import { promises as fs } from 'fs';
import { generateKeyPairSync, sign, type JsonWebKey } from 'crypto';
import { RunnerServer } from '../src/server.js';
import { GoogleOidcVerifier } from '../src/helpers/google-oidc-token.js';
import type { ScheduleStore, CheckupSchedule } from '../src/scheduler.js';

const SA = 'qa-scheduler@proj.iam.gserviceaccount.com';
const AUD = 'https://qa.example.run.app';
const KEY = 'k3y-tester-extra-0123456789';
const PORT = 3771;
const scratch = path.join(process.cwd(), '.tmp-schedule-tick-extra');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1', alg: 'RS256' };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

function token(over: Record<string, unknown> = {}, signer = privateKey): string {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: AUD,
    exp: now + 600,
    iat: now - 5,
    email: SA,
    email_verified: true,
    ...over,
  })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), signer).toString('base64url')}`;
}

const store: ScheduleStore = { read: async () => [] as CheckupSchedule[], write: async () => undefined };
let server: RunnerServer;

function post(headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: '/api/runner/schedules/tick',
        method: 'POST',
        headers: { host: `localhost:${PORT}`, ...headers },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode || 0));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  const verifier = new GoogleOidcVerifier({
    serviceAccountEmail: SA,
    audiences: () => [AUD],
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'max-age=600' },
      json: async () => ({ keys: [jwk] }),
    }),
  });
  server = new RunnerServer({
    port: PORT,
    outputDir: path.join(scratch, 'r'),
    dataDir: path.join(scratch, 'd'),
    beta: true,
    accessToken: KEY,
    scheduleStore: store,
    schedulerAuth: verifier,
  });
  await server.start();
});
afterAll(async () => {
  await server.stop();
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('tick on a beta copy', () => {
  it('owner key alone is 401', async () => {
    expect(await post({ 'x-qa-access': KEY })).toBe(401);
  });
  it('no credential is 401', async () => {
    expect(await post({})).toBe(401);
  });
  it('key plus wrong audience / issuer / email / expired, or a foreign signature, is 401', async () => {
    for (const over of [
      { aud: 'https://evil.example' },
      { iss: 'https://evil.example' },
      { email: 'x@y.com' },
      { exp: 1 },
    ]) {
      expect(await post({ 'x-qa-access': KEY, authorization: `Bearer ${token(over)}` }), JSON.stringify(over)).toBe(
        401
      );
    }
    expect(await post({ authorization: `Bearer ${token({}, otherKey)}` })).toBe(401);
  });
  it('a valid token is 200', async () => {
    expect(await post({ authorization: `Bearer ${token()}` })).toBe(200);
  });
});
