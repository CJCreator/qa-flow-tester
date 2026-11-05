/**
 * M3 (ADR 0039): POST /api/runner/sessions/cleanup through the real RunnerServer dispatch. Only a valid Google
 * token from the scheduler service account opens it. Tokens are signed with a local RSA key; Google's key download
 * is a fake fetch (the same fake verifier the tick tests use).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { generateKeyPairSync, sign, type JsonWebKey } from 'crypto';
import { RunnerServer } from '../src/server.js';
import { GoogleOidcVerifier } from '../src/helpers/google-oidc-token.js';
import type { KeysFetch } from '../src/helpers/firebase-token.js';
import type { CheckupSchedule, ScheduleStore } from '../src/scheduler.js';

const SA = 'qa-scheduler@proj.iam.gserviceaccount.com';
const AUD = 'https://qa-cleanup.example.run.app';
const KEY = 'k3y-session-cleanup-0123456789';
const PORT = 3931;
const scratch = path.join(process.cwd(), '.tmp-session-cleanup-route');
const DAY_MS = 24 * 3_600_000;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'k1', alg: 'RS256' };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

function token(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'RS256', kid: 'k1' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: AUD,
    exp: now + 600,
    iat: now - 5,
    email: SA,
    email_verified: true,
    ...overrides,
  })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function verifier(): GoogleOidcVerifier {
  const fetch: KeysFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'max-age=600' },
    json: async () => ({ keys: [jwk] }),
  });
  return new GoogleOidcVerifier({ serviceAccountEmail: SA, audiences: () => [AUD], fetch });
}

function memoryStore(): ScheduleStore {
  let list: CheckupSchedule[] = [];
  return {
    read: async () => JSON.parse(JSON.stringify(list)) as CheckupSchedule[],
    write: async (l: CheckupSchedule[]) => {
      list = JSON.parse(JSON.stringify(l));
    },
  };
}

interface Answer {
  status: number;
  body: string;
}

function call(method: string, rawPath: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise<Answer>((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port: PORT, path: rawPath, method, headers: { host: `localhost:${PORT}`, ...headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const CLEANUP = '/api/runner/sessions/cleanup';
const bearer = (t: string = token()) => ({ authorization: `Bearer ${t}` });

/** A folder under dataDir/sessions whose files were last touched `ageMs` ago. */
async function visitorFolder(sessionsDir: string, name: string, ageMs: number): Promise<string> {
  const dir = path.join(sessionsDir, name);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'secrets.json');
  await fs.writeFile(file, '{}', 'utf8');
  const when = new Date(Date.now() - ageMs);
  await fs.utimes(file, when, when);
  await fs.utimes(dir, when, when);
  return dir;
}

describe('POST /api/runner/sessions/cleanup (ADR 0039, M3)', () => {
  let server: RunnerServer;
  let sessionsDir: string;

  beforeAll(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
    const dataDir = path.join(scratch, 'data');
    sessionsDir = path.join(dataDir, 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir,
      accessToken: KEY,
      scheduleStore: memoryStore(),
      schedulerAuth: verifier(),
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('is 401 ERR_SCHEDULER_AUTH without a token, with the access key alone, or with a bad token', async () => {
    const cases: Record<string, string>[] = [
      {},
      { 'x-qa-access': KEY },
      { authorization: 'Bearer nope' },
      { authorization: `Basic ${token()}` },
    ];
    for (const headers of cases) {
      const res = await call('POST', CLEANUP, headers);
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body).code).toBe('ERR_SCHEDULER_AUTH');
    }
  });

  it('is 401 for a valid Google token of another account, or for another audience', async () => {
    const other = await call('POST', CLEANUP, bearer(token({ email: 'someone@example.com' })));
    expect(other.status).toBe(401);
    const wrongAud = await call('POST', CLEANUP, bearer(token({ aud: 'https://other.example.run.app' })));
    expect(wrongAud.status).toBe(401);
  });

  it('a GET is not a row here: never served, even with a valid token', async () => {
    const res = await call('GET', CLEANUP, bearer());
    expect(res.status).not.toBe(200);
    expect(res.body).not.toContain('folders');
  });

  it('with the scheduler token: purges folders idle for over 24 hours, keeps fresh ones, replies counts only', async () => {
    const stale = await visitorFolder(sessionsDir, 'stale-visitor', DAY_MS + 3_600_000);
    const fresh = await visitorFolder(sessionsDir, 'fresh-visitor', 60_000);

    const t = token();
    const res = await call('POST', CLEANUP, bearer(t));
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['folders', 'sessions']);
    expect(body.folders).toBe(1);
    for (const secret of [t, SA, KEY, stale, fresh]) expect(res.body).not.toContain(secret);

    await expect(fs.stat(stale)).rejects.toThrow();
    await expect(fs.stat(fresh)).resolves.toBeTruthy();
  });
});
