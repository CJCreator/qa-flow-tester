/**
 * POST /api/runner/domain-proof on a shared copy (beta): the Verified Domain line, per session and
 * exact origin, checked from the server with the address checks of ADR 0014. No real network: the
 * host checks are injected.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import { claimProofCheck, enterSession, peekProofToken, proofTokenFor, sessionFor } from '../src/beta.js';
import type { NetDeps, RawResponse } from '@qa/core';

const PORT = 3574;
const KEYED_PORT = 3575;
const LOCAL_PORT = 3576;
const ACCESS = 'access-key-for-proof-test';
const scratch = path.join(process.cwd(), '.tmp-domain-proof');

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(
  method: string,
  rawPath: string,
  cookie?: string,
  body?: unknown,
  port = PORT,
  extra: Record<string, string> = {}
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: rawPath,
        method,
        headers: {
          host: `localhost:${port}`,
          ...extra,
          ...(cookie ? { cookie } : {}),
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: text }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function newSession(port = PORT, extra: Record<string, string> = {}): Promise<string> {
  const first = await call('GET', '/api/runner/status', undefined, undefined, port, extra);
  const set = first.headers['set-cookie']?.find((c) => c.startsWith('qa_session=')) || '';
  return set.split(';')[0];
}

/** What the fake internet holds: names, and the one file each origin serves. */
const names: Record<string, string[]> = {
  'preview.example.com': ['93.184.216.34'],
  'other.example.com': ['93.184.216.35'],
  'sneaky.example.com': ['10.0.0.9'],
  'turns-private.example.com': ['93.184.216.36', '127.0.0.1'],
};
let served: Record<string, RawResponse> = {};
const connects: string[] = [];
const hostChecks: NetDeps = {
  lookup: async (host) => {
    const a = names[host];
    if (!a) throw new Error('ENOTFOUND');
    return a;
  },
  connect: async (req) => {
    connects.push(req.url.toString());
    const r = served[req.url.toString()];
    if (!r) return { status: 404, headers: {}, body: 'not here' };
    return r;
  },
};
const PROOF = (host: string) => `https://${host}/.well-known/qa-verify.txt`;

describe('POST /api/runner/domain-proof on a shared copy', () => {
  let server: RunnerServer;
  let keyed: RunnerServer;
  let local: RunnerServer;

  beforeAll(async () => {
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      beta: true,
      hostChecks,
    });
    keyed = new RunnerServer({
      port: KEYED_PORT,
      outputDir: path.join(scratch, 'report-keyed'),
      dataDir: path.join(scratch, 'data-keyed'),
      beta: true,
      accessToken: ACCESS,
      hostChecks,
    });
    local = new RunnerServer({
      port: LOCAL_PORT,
      outputDir: path.join(scratch, 'report-local'),
      dataDir: path.join(scratch, 'data-local'),
      hostChecks,
    });
    await server.start();
    await keyed.start();
    await local.start();
  });

  afterAll(async () => {
    await server?.stop();
    await keyed?.stop();
    await local?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    served = {};
    connects.length = 0;
  });

  /** Moves this process's clock forward, so the 10-second throttle can pass. */
  function later(seconds: number): void {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + seconds * 1000);
  }

  it('POST /api/runner/domain-proof returns the line and url, verified false then true', async () => {
    const cookie = await newSession();
    const first = await call('POST', '/api/runner/domain-proof', cookie, {
      targetUrl: 'https://preview.example.com/page',
    });
    expect(first.status).toBe(200);
    const a = JSON.parse(first.body);
    expect(a).toMatchObject({
      required: true,
      verified: false,
      origin: 'https://preview.example.com',
      proofUrl: PROOF('preview.example.com'),
      reason: 'not-found',
    });
    expect(a.line).toMatch(/^qa-verify=[A-Za-z0-9_-]{32}$/);

    // The owner publishes the line; after the throttle a new check passes.
    served[PROOF('preview.example.com')] = { status: 200, headers: {}, body: `${a.line}\n` };
    later(11);
    const second = JSON.parse(
      (await call('POST', '/api/runner/domain-proof', cookie, { targetUrl: 'https://preview.example.com' })).body
    );
    expect(second).toMatchObject({ verified: true, line: a.line });
    expect(second.reason).toBeUndefined();
  });

  it('another session’s line does not verify, and each session gets its own line', async () => {
    const alice = await newSession();
    const bob = await newSession();
    const a = JSON.parse(
      (await call('POST', '/api/runner/domain-proof', alice, { targetUrl: 'https://preview.example.com' })).body
    );
    served[PROOF('preview.example.com')] = { status: 200, headers: {}, body: a.line };
    const b = JSON.parse(
      (await call('POST', '/api/runner/domain-proof', bob, { targetUrl: 'https://preview.example.com' })).body
    );
    expect(b.verified).toBe(false);
    expect(b.reason).toBe('mismatch');
    expect(b.line).not.toBe(a.line);
  });

  it('refuses private targets (400 ERR_PRIVATE_TARGET)', async () => {
    const cookie = await newSession();
    for (const targetUrl of [
      'http://127.0.0.1/',
      'https://localhost',
      'https://sneaky.example.com',
      'https://turns-private.example.com',
      'http://[::1]/',
    ]) {
      const answer = await call('POST', '/api/runner/domain-proof', cookie, { targetUrl });
      expect(answer.status, targetUrl).toBe(400);
      expect(JSON.parse(answer.body).code, targetUrl).toBe('ERR_PRIVATE_TARGET');
    }
    expect(connects).toEqual([]);
  });

  it('throttles repeat checks of one origin (429 ERR_RATE) but not another origin', async () => {
    const cookie = await newSession();
    const body = { targetUrl: 'https://preview.example.com' };
    expect((await call('POST', '/api/runner/domain-proof', cookie, body)).status).toBe(200);
    const again = await call('POST', '/api/runner/domain-proof', cookie, body);
    expect(again.status).toBe(429);
    expect(JSON.parse(again.body).code).toBe('ERR_RATE');
    expect(
      (await call('POST', '/api/runner/domain-proof', cookie, { targetUrl: 'https://other.example.com' })).status
    ).toBe(200);
    // The throttle is per session.
    const other = await newSession();
    expect((await call('POST', '/api/runner/domain-proof', other, body)).status).toBe(200);
  });

  it('claimProofCheck allows one fetch per origin per 10 seconds', () => {
    const id = sessionFor(
      { headers: {} } as http.IncomingMessage,
      { getHeader: () => undefined, setHeader: () => undefined } as unknown as http.ServerResponse,
      false
    );
    enterSession(id);
    expect(claimProofCheck('https://a.example.com', 1000)).toBe(true);
    expect(claimProofCheck('https://a.example.com', 5000)).toBe(false);
    expect(claimProofCheck('https://A.example.com', 5000)).toBe(false);
    expect(claimProofCheck('https://b.example.com', 5000)).toBe(true);
    expect(claimProofCheck('https://a.example.com', 11_001)).toBe(true);
  });

  it('token differs per session and is stable within one, and per origin', () => {
    const res = { getHeader: () => undefined, setHeader: () => undefined } as unknown as http.ServerResponse;
    const one = sessionFor({ headers: {} } as http.IncomingMessage, res, false);
    enterSession(one);
    expect(peekProofToken('https://a.example.com')).toBeUndefined();
    const t1 = proofTokenFor('https://a.example.com');
    expect(proofTokenFor('https://a.example.com')).toBe(t1);
    expect(peekProofToken('https://a.example.com')).toBe(t1);
    expect(proofTokenFor('https://b.example.com')).not.toBe(t1);
    expect(t1).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const two = sessionFor({ headers: {} } as http.IncomingMessage, res, false);
    enterSession(two);
    expect(proofTokenFor('https://a.example.com')).not.toBe(t1);
  });

  it('response never contains the fetched body', async () => {
    served[PROOF('preview.example.com')] = { status: 200, headers: {}, body: 'qa-verify=wrong SECRET-BODY-CONTENT' };
    const cookie = await newSession();
    const answer = await call('POST', '/api/runner/domain-proof', cookie, { targetUrl: 'https://preview.example.com' });
    expect(answer.body).not.toContain('SECRET-BODY-CONTENT');
    expect(JSON.parse(answer.body)).toMatchObject({ verified: false, reason: 'mismatch' });
  });

  it('does not follow a redirect and reports it', async () => {
    served[PROOF('preview.example.com')] = {
      status: 301,
      headers: { location: 'https://other.example.com/.well-known/qa-verify.txt' },
      body: '',
    };
    const cookie = await newSession();
    const answer = JSON.parse(
      (await call('POST', '/api/runner/domain-proof', cookie, { targetUrl: 'https://preview.example.com' })).body
    );
    expect(answer).toMatchObject({ verified: false, reason: 'redirected' });
    expect(connects).toEqual([PROOF('preview.example.com')]);
  });

  it('says an http address cannot be verified, without fetching', async () => {
    const cookie = await newSession();
    const answer = JSON.parse(
      (await call('POST', '/api/runner/domain-proof', cookie, { targetUrl: 'http://preview.example.com' })).body
    );
    expect(answer).toMatchObject({ required: true, verified: false, reason: 'not-https', line: '' });
    expect(connects).toEqual([]);
  });

  it('rejects a body that is not an address', async () => {
    const cookie = await newSession();
    expect((await call('POST', '/api/runner/domain-proof', cookie, { targetUrl: 'nonsense' })).status).toBe(400);
    expect((await call('POST', '/api/runner/domain-proof', cookie, {})).status).toBe(400);
    expect(
      (await call('POST', '/api/runner/domain-proof', cookie, { targetUrl: 'ftp://preview.example.com' })).status
    ).toBe(400);
  });

  it('works with RUNNER_ACCESS_TOKEN, and is refused without it', async () => {
    const headers = { 'x-qa-access': ACCESS };
    const cookie = await newSession(KEYED_PORT, headers);
    const ok = await call(
      'POST',
      '/api/runner/domain-proof',
      cookie,
      { targetUrl: 'https://preview.example.com' },
      KEYED_PORT,
      headers
    );
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body).required).toBe(true);
    const denied = await call(
      'POST',
      '/api/runner/domain-proof',
      cookie,
      { targetUrl: 'https://preview.example.com' },
      KEYED_PORT
    );
    expect(denied.status).not.toBe(200);
  });

  it('is open in beta: not one of the closed routes', async () => {
    const cookie = await newSession();
    const answer = await call('POST', '/api/runner/domain-proof', cookie, { targetUrl: 'https://other.example.com' });
    expect([403, 404, 405]).not.toContain(answer.status);
    expect(answer.status).toBe(200);
  });

  it('a runner on your own computer answers required false and fetches nothing', async () => {
    const answer = await call(
      'POST',
      '/api/runner/domain-proof',
      undefined,
      { targetUrl: 'https://preview.example.com' },
      LOCAL_PORT
    );
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toMatchObject({ required: false, verified: true });
    expect(connects).toEqual([]);
  });

  it('preflight on a shared copy ignores the x-test-copy header and checks every hop', async () => {
    served['https://preview.example.com/'] = {
      status: 200,
      headers: { 'x-test-copy': 'true', 'x-staging': 'true' },
      body: 'hi',
    };
    const cookie = await newSession();
    const answer = JSON.parse(
      (await call('POST', '/api/runner/preflight', cookie, { targetUrl: 'https://preview.example.com/' })).body
    );
    expect(answer.reachable).toBe(true);
    expect(answer.testCopy).toBe(false);
    // A page that redirects to a private address is not reachable and is never fetched.
    served['https://other.example.com/'] = { status: 302, headers: { location: 'http://169.254.169.254/' }, body: '' };
    const redirected = JSON.parse(
      (await call('POST', '/api/runner/preflight', cookie, { targetUrl: 'https://other.example.com/' })).body
    );
    expect(redirected.reachable).toBe(false);
    expect(connects.filter((u) => u.includes('169.254'))).toEqual([]);
  });

  it('token absent from SSE stream events, report files and server log', async () => {
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    let streamed = '';
    const stream = http.get(
      { host: 'localhost', port: PORT, path: '/api/runner/stream', headers: { host: `localhost:${PORT}` } },
      (res) => {
        res.on('data', (chunk) => (streamed += chunk));
      }
    );
    stream.on('error', () => undefined);

    const cookie = await newSession();
    const body = { targetUrl: 'https://preview.example.com' };
    const a = JSON.parse((await call('POST', '/api/runner/domain-proof', cookie, body)).body);
    served[PROOF('preview.example.com')] = { status: 200, headers: {}, body: a.line };
    later(11);
    await call('POST', '/api/runner/domain-proof', cookie, body);
    await call('POST', '/api/runner/preflight', cookie, { targetUrl: 'https://preview.example.com' });
    await new Promise((r) => setTimeout(r, 100));
    stream.destroy();

    const token = a.line.replace('qa-verify=', '');
    expect(token.length).toBeGreaterThan(20);
    expect(streamed).not.toContain(token);
    expect(logged.join('\n')).not.toContain(token);

    const walk = async (dir: string): Promise<string[]> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      const files = await Promise.all(
        entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : Promise.resolve([path.join(dir, e.name)])))
      );
      return files.flat();
    };
    for (const file of await walk(scratch)) {
      expect(await fs.readFile(file, 'utf8').catch(() => ''), file).not.toContain(token);
    }
  });
});
