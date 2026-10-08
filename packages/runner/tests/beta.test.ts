/**
 * A runner shared with outside testers (beta mode): each tester's AI key lives in memory for their
 * session only, only public sites can be checked, and routes that change what other testers see are
 * closed. A runner without beta mode works as before.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import { refusedTarget, claimBetaRun, betaLimitsFromEnv, resetBetaUsage, sessionFor } from '../src/beta.js';
import type { OpenRouterClient } from '@qa/core';

const PORT = 3571;
const LIMIT_PORT = 3572;
const scratch = path.join(process.cwd(), '.tmp-beta');

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(method: string, rawPath: string, cookie?: string, body?: unknown, port = PORT): Promise<Answer> {
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

/** The session cookie a first visit is given, ready to send back. */
async function newSession(port = PORT): Promise<string> {
  const first = await call('GET', '/api/runner/status', undefined, undefined, port);
  const set = first.headers['set-cookie']?.find((c) => c.startsWith('qa_session=')) || '';
  return set.split(';')[0];
}

const fakeOpenRouter = {
  validateKey: async () => ({ valid: true }),
  listFreeModels: async () => [],
  freeRequestsToday: async () => null,
} as unknown as OpenRouterClient;

describe('A runner shared as a beta', () => {
  let server: RunnerServer;

  beforeAll(async () => {
    process.env.OPENROUTER_API_KEY = 'owner-env-key';
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      beta: true,
      openRouter: fakeOpenRouter,
    });
    await server.start();
  });

  afterAll(async () => {
    delete process.env.OPENROUTER_API_KEY;
    await server?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('gives each visitor a session, and keeps it for a visitor who sends the cookie back', async () => {
    const first = await call('GET', '/api/runner/status');
    expect(first.headers['set-cookie']?.[0]).toContain('qa_session=');
    expect(first.headers['set-cookie']?.[0]).toContain('HttpOnly');

    const cookie = await newSession();
    const again = await call('GET', '/api/runner/status', cookie);
    expect(again.headers['set-cookie']).toBeUndefined();
  });

  it('says in its status that it is a shared copy, so the app can warn that check-ups are visible to others', async () => {
    expect(JSON.parse((await call('GET', '/api/runner/status')).body).beta).toBe(true);
  });

  it('keeps a tester’s key to their own session, in memory only', async () => {
    const alice = await newSession();
    const bob = await newSession();

    const saved = await call('POST', '/api/ai/openrouter/key', alice, { apiKey: 'sk-or-alice' });
    expect(saved.status).toBe(200);

    expect(JSON.parse((await call('GET', '/api/ai/openrouter/key', alice)).body).configured).toBe(true);
    // Bob has no key, and neither the saved key of the owner nor the environment's counts as his.
    expect(JSON.parse((await call('GET', '/api/ai/openrouter/key', bob)).body).configured).toBe(false);

    const onDisk = await fs.readdir(path.join(scratch, 'data')).catch(() => [] as string[]);
    expect(onDisk).not.toContain('.qa-keys.json');
  });

  it('refuses addresses that are not on the public internet', async () => {
    const cookie = await newSession();
    for (const targetUrl of [
      'http://localhost:3001',
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'http://192.168.1.1',
      'ftp://example.com',
    ]) {
      const answer = await call('POST', '/api/runner/preflight', cookie, { targetUrl });
      expect(answer.status, targetUrl).toBe(400);
    }
    const run = await call('POST', '/api/runner/run', cookie, { targetUrl: 'http://10.0.0.5/' });
    expect(run.status).toBe(400);
    expect(JSON.parse(run.body).code).toBe('ERR_PRIVATE_TARGET');
  });

  it('never gives a tester the made-up journeys of the test AI', async () => {
    const cookie = await newSession();
    const run = await call('POST', '/api/runner/run', cookie, {
      targetUrl: 'https://example.com/',
      useAI: true,
      aiProvider: 'mock',
    });
    expect(run.status).toBe(400);
    expect(JSON.parse(run.body).code).toBe('ERR_NO_AI_KEY');
  });

  it('compares sites for a tester, but only public ones, and keeps each tester’s comparisons to themselves', async () => {
    const alice = await newSession();
    const bob = await newSession();
    for (const [ourUrl, refUrl] of [
      ['http://localhost:3001', 'https://example.com'],
      ['https://example.com', 'http://10.0.0.5/'],
    ]) {
      const answer = await call('POST', '/api/runner/benchmark', alice, { ourUrl, refUrl });
      expect(answer.status, `${ourUrl} vs ${refUrl}`).toBe(400);
      expect(JSON.parse(answer.body).code).toBe('ERR_PRIVATE_TARGET');
    }
    expect(JSON.parse((await call('GET', '/api/runner/benchmarks', alice)).body)).toEqual([]);
    expect(JSON.parse((await call('GET', '/api/runner/benchmarks', bob)).body)).toEqual([]);
    expect((await call('GET', '/api/runner/benchmark/bench-1', bob)).status).toBe(404);
  });

  it('shuts the routes that change what other testers see', async () => {
    const cookie = await newSession();
    expect((await call('DELETE', '/api/runs/run-1', cookie)).status).toBe(403);
    expect((await call('POST', '/api/runner/schedules', cookie, { targetUrl: 'https://example.com' })).status).toBe(
      403
    );
  });

  it('turns away a request body that is far too large', async () => {
    const cookie = await newSession();
    const answer = await call('POST', '/api/runner/preflight', cookie, {
      targetUrl: 'https://example.com/' + 'a'.repeat(5_100_000),
    });
    expect(answer.status).toBe(400);
  });
});

describe('Which addresses a tester may check', () => {
  it('accepts public addresses and refuses private ones, however they are written', async () => {
    expect(await refusedTarget('https://93.184.216.34/')).toBeNull();
    expect(await refusedTarget('http://localhost:3000')).not.toBeNull();
    expect(await refusedTarget('http://100.64.0.1/')).not.toBeNull();
    expect(await refusedTarget('http://0.0.0.0/')).not.toBeNull();
    expect(await refusedTarget('http://[::ffff:127.0.0.1]/')).not.toBeNull();
    expect(await refusedTarget('http://[fd00::1]/')).not.toBeNull();
    expect(await refusedTarget('not a url')).not.toBeNull();
  });
});

/** A visit as sessionFor sees it: the cookie sent, and what Set-Cookie came back. */
function visit(cookie?: string, address = '203.0.113.7'): { id: string; setCookie: string[] } {
  const headers: Record<string, unknown> = {};
  const req = { headers: cookie ? { cookie } : {}, socket: { remoteAddress: address } };
  const res = {
    getHeader: (name: string) => headers[name],
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
  };
  const id = sessionFor(req as never, res as never, false);
  const set = headers['Set-Cookie'];
  return { id, setCookie: set === undefined ? [] : Array.isArray(set) ? (set as string[]) : [String(set)] };
}

describe('beta sessions: lifetime and size stay as they were', () => {
  afterEach(() => {
    // These tests set the clock years ahead; sweep their sessions out so later tests see a normal map.
    vi.setSystemTime(Date.parse('2040-01-01T00:00:00Z'));
    visit();
    vi.useRealTimers();
  });

  it('beta sessions: the 51st session pushes out the least recently seen', () => {
    vi.useFakeTimers();
    const start = Date.parse('2030-01-01T00:00:00Z');
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) {
      vi.setSystemTime(start + i * 1000);
      ids.push(visit().id);
    }
    vi.setSystemTime(start + 60_000);
    for (const id of ids.slice(1)) expect(visit(`qa_session=${id}`).setCookie, id).toEqual([]);
    expect(visit(`qa_session=${ids[0]}`).setCookie[0]).toContain('qa_session=');
  });

  it('beta sessions: a session unseen for 24 hours is forgotten', () => {
    vi.useFakeTimers();
    const start = Date.parse('2031-01-01T00:00:00Z');
    vi.setSystemTime(start);
    const kept = visit();
    const gone = visit();
    expect(kept.setCookie[0]).toContain('Max-Age=86400');
    vi.setSystemTime(start + 24 * 3_600_000 - 60_000);
    expect(visit(`qa_session=${kept.id}`).setCookie).toEqual([]);
    vi.setSystemTime(start + 24 * 3_600_000 + 1000);
    expect(visit(`qa_session=${gone.id}`).setCookie[0]).toContain('qa_session=');
  });
});

describe('beta limits', () => {
  afterEach(resetBetaUsage);

  it('beta limits: a visitor over their cap is stopped and another visitor is not', () => {
    const limits = { perVisitor: 2, perDay: 100 };
    const a = visit().id;
    const b = visit().id;
    expect(claimBetaRun(a, { limits })).toBeNull();
    expect(claimBetaRun(a, { limits })).toBeNull();
    const hit = claimBetaRun(a, { limits });
    expect(hit?.scope).toBe('visitor');
    expect(hit?.error).toContain('2');
    expect(hit?.error).toContain('00:00 UTC');
    expect(claimBetaRun(b, { limits })).toBeNull();
  });

  it('beta limits: when the day cap is reached every visitor is stopped', () => {
    const limits = { perVisitor: 10, perDay: 2 };
    const a = visit().id;
    const b = visit().id;
    const c = visit().id;
    expect(claimBetaRun(a, { limits })).toBeNull();
    expect(claimBetaRun(b, { limits })).toBeNull();
    expect(claimBetaRun(c, { limits })?.scope).toBe('day');
    expect(claimBetaRun(undefined, { limits })?.scope).toBe('day');
  });

  it('beta limits: a session-less start is held only by the day cap and never throws', () => {
    const limits = { perVisitor: 1, perDay: 3 };
    expect(claimBetaRun(undefined, { limits })).toBeNull();
    expect(claimBetaRun('unknown-id', { limits })).toBeNull();
    expect(claimBetaRun(undefined, { limits })).toBeNull();
    expect(claimBetaRun(undefined, { limits })?.scope).toBe('day');
  });

  it('beta limits: env values set the caps, unset uses 5 and 40, invalid values fall back', () => {
    expect(betaLimitsFromEnv({})).toEqual({ perVisitor: 5, perDay: 40 });
    expect(betaLimitsFromEnv({ RUNNER_BETA_RUNS_PER_VISITOR: '3', RUNNER_BETA_RUNS_PER_DAY: '10' })).toEqual({
      perVisitor: 3,
      perDay: 10,
    });
    for (const bad of ['0', '-1', '2.5', 'abc', '', '  ', '1e3']) {
      expect(
        betaLimitsFromEnv({ RUNNER_BETA_RUNS_PER_VISITOR: bad, RUNNER_BETA_RUNS_PER_DAY: bad }),
        JSON.stringify(bad)
      ).toEqual({ perVisitor: 5, perDay: 40 });
    }
    expect(betaLimitsFromEnv({ RUNNER_BETA_RUNS_PER_VISITOR: '7', RUNNER_BETA_RUNS_PER_DAY: 'x' })).toEqual({
      perVisitor: 7,
      perDay: 40,
    });
  });

  it('beta limits: counters start again on the next UTC day', () => {
    const limits = { perVisitor: 1, perDay: 1 };
    const id = visit().id;
    const late = Date.parse('2026-10-07T23:59:59Z');
    expect(claimBetaRun(id, { limits, now: late })).toBeNull();
    const hit = claimBetaRun(id, { limits, now: late });
    expect(hit?.scope).toBe('day');
    expect(hit?.resetsAt).toBe('2026-10-08T00:00:00.000Z');
    expect(claimBetaRun(id, { limits, now: Date.parse('2026-10-08T00:00:00Z') })).toBeNull();
  });

  it('beta limits: two sessions from the same address have separate counts', () => {
    const limits = { perVisitor: 1, perDay: 100 };
    const a = visit(undefined, '198.51.100.9').id;
    const b = visit(undefined, '198.51.100.9').id;
    expect(a).not.toBe(b);
    expect(claimBetaRun(a, { limits })).toBeNull();
    expect(claimBetaRun(a, { limits })?.scope).toBe('visitor');
    expect(claimBetaRun(b, { limits })).toBeNull();
  });
});

describe('beta limits over HTTP', () => {
  let server: RunnerServer;
  const limits = { perVisitor: 1, perDay: 1000 };
  const idOf = (cookie: string): string => cookie.split('=')[1];

  beforeAll(async () => {
    server = new RunnerServer({
      port: LIMIT_PORT,
      outputDir: path.join(scratch, 'limit-report'),
      dataDir: path.join(scratch, 'limit-data'),
      beta: true,
      betaLimits: limits,
      openRouter: fakeOpenRouter,
    });
    await server.start();
  });

  afterEach(resetBetaUsage);

  afterAll(async () => {
    await server?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('beta limits: an over-cap visitor check-up start answers 429 ERR_BETA_LIMIT', async () => {
    const cookie = await newSession(LIMIT_PORT);
    expect(claimBetaRun(idOf(cookie), { limits })).toBeNull();
    const answer = await call('POST', '/api/runner/run', cookie, { targetUrl: 'https://93.184.216.34/' }, LIMIT_PORT);
    expect(answer.status).toBe(429);
    const body = JSON.parse(answer.body);
    expect(body.code).toBe('ERR_BETA_LIMIT');
    expect(body.scope).toBe('visitor');
    expect(body.error).toContain('1');
    expect(body.error).toContain('00:00 UTC');
    expect(answer.body).not.toContain(idOf(cookie));
  });

  it('beta limits: a comparison start is stopped the same way', async () => {
    const cookie = await newSession(LIMIT_PORT);
    claimBetaRun(idOf(cookie), { limits });
    const answer = await call(
      'POST',
      '/api/runner/benchmark',
      cookie,
      { ourUrl: 'https://93.184.216.34/', refUrl: 'https://93.184.216.35/' },
      LIMIT_PORT
    );
    expect(answer.status).toBe(429);
    expect(JSON.parse(answer.body).code).toBe('ERR_BETA_LIMIT');
  });

  it('beta limits: when the day cap is reached a fresh visitor start is stopped', async () => {
    // Fill the server's day cap (1000) with session-less claims.
    for (let i = 0; i < 1000; i++) claimBetaRun(undefined, { limits });
    const fresh = await newSession(LIMIT_PORT);
    const answer = await call('POST', '/api/runner/run', fresh, { targetUrl: 'https://93.184.216.34/' }, LIMIT_PORT);
    expect(answer.status).toBe(429);
    expect(JSON.parse(answer.body).scope).toBe('day');
  });

  it('beta limits: a refused start does not use up a check-up', async () => {
    const cookie = await newSession(LIMIT_PORT);
    for (let i = 0; i < 2; i++) {
      const answer = await call('POST', '/api/runner/run', cookie, { targetUrl: 'http://10.0.0.5/' }, LIMIT_PORT);
      expect(answer.status).toBe(400);
      expect(JSON.parse(answer.body).code).toBe('ERR_PRIVATE_TARGET');
    }
    expect(claimBetaRun(idOf(cookie), { limits })).toBeNull();
  });
});

describe('beta limits: a runner that is not a beta', () => {
  it('beta limits: a runner that is not a beta is never limited', async () => {
    const limits = { perVisitor: 1, perDay: 1 };
    const server = new RunnerServer({
      port: LIMIT_PORT,
      outputDir: path.join(scratch, 'plain-report'),
      dataDir: path.join(scratch, 'plain-data'),
      beta: false,
      betaLimits: limits,
      openRouter: fakeOpenRouter,
    });
    await server.start();
    try {
      claimBetaRun(undefined, { limits });
      claimBetaRun(undefined, { limits });
      const answer = await call('POST', '/api/runner/run', undefined, { targetUrl: 'http://127.0.0.1:9/' }, LIMIT_PORT);
      expect(answer.status).toBe(202);
      await call('POST', '/api/runner/abort', undefined, {}, LIMIT_PORT);
    } finally {
      await server.stop();
      resetBetaUsage();
      await fs.rm(scratch, { recursive: true, force: true });
    }
  });
});
