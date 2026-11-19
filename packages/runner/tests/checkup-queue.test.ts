/**
 * T-436 (ADR 0050): the waiting line for the Check-up slot, and the keep-alive ping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { CheckupQueue, QUEUE_ABSENCE_MS, QUEUE_MAX, type QueueEntry } from '../src/checkup-queue.js';
import { createHelperAccess, MIN_SESSION_SECRET_CHARS } from '../src/helpers/helper-access.js';
import { HELPER_COOKIE, signHelperSession } from '../src/helpers/helper-session.js';
import { RunnerServer } from '../src/server.js';
import { freePort } from './helpers/free-port.js';

const entry = (account: string, lastPoll = 0): QueueEntry => ({
  account,
  sessionId: undefined,
  bodyText: '{}',
  cookie: undefined,
  remoteAddress: undefined,
  host: undefined,
  lastPoll,
});

describe('CheckupQueue', () => {
  it('is first in, first out, with places counted from 1', () => {
    const q = new CheckupQueue();
    expect(q.join(entry('a'))).toEqual({ joined: true, position: 1 });
    expect(q.join(entry('b'))).toEqual({ joined: true, position: 2 });
    expect(q.position('b')).toBe(2);
    expect(q.shift()?.account).toBe('a');
    expect(q.position('b')).toBe(1);
  });

  it('a second start by the same account keeps its place', () => {
    const q = new CheckupQueue();
    q.join(entry('a'));
    q.join(entry('b'));
    expect(q.join({ ...entry('a'), bodyText: '{"x":1}' })).toEqual({ joined: true, position: 1 });
    expect(q.length).toBe(2);
    expect(q.peek()?.bodyText).toBe('{"x":1}');
  });

  it('holds at most 10', () => {
    const q = new CheckupQueue();
    for (let i = 0; i < QUEUE_MAX; i++) expect(q.join(entry(`u${i}`)).joined).toBe(true);
    expect(q.join(entry('late'))).toEqual({ joined: false, reason: 'full' });
  });

  it('leaving frees the place', () => {
    const q = new CheckupQueue();
    q.join(entry('a'));
    expect(q.leave('a')).toBe(true);
    expect(q.leave('a')).toBe(false);
    expect(q.length).toBe(0);
  });

  it('drops an entry whose status polls stopped for 10 minutes, and touch keeps one', () => {
    const q = new CheckupQueue();
    q.join(entry('gone', 0));
    q.join(entry('here', 0));
    q.touch('here', QUEUE_ABSENCE_MS - 1);
    expect(q.prune(QUEUE_ABSENCE_MS + 1)).toBe(1);
    expect(q.position('here')).toBe(1);
    expect(q.position('gone')).toBeNull();
  });
});

const ACCESS = 'queue-access-key-0123456789';
const SECRET = 'q'.repeat(MIN_SESSION_SECRET_CHARS + 4);
const store = { grantsFor: async () => [] };

function call(port: number, method: string, rawPath: string, headers: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port, path: rawPath, method, headers: { host: `localhost:${port}`, ...headers } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode || 0, json });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('the waiting line on a beta copy in account mode', () => {
  let scratch: string;
  let runner: RunnerServer;
  let port = 0;
  const cookies: string[] = [];
  const net = { lookup: async () => ['93.184.216.34'], connect: async () => Promise.reject(new Error('no')) };
  const json = { 'content-type': 'application/json' };
  const target = JSON.stringify({ targetUrl: 'https://example.com' });

  beforeAll(async () => {
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-queue-'));
    const access = createHelperAccess({ projectId: 'proj', accessToken: ACCESS, sessionSecret: SECRET, store });
    for (const email of ['one@example.com', 'two@example.com']) {
      const value = signHelperSession(
        access.sessionKey(),
        { email, sub: `uid-${email}` },
        access.now(),
        access.sessionSeconds,
        access.sessionSeconds
      );
      cookies.push(`${HELPER_COOKIE}=${value}`);
    }
    port = await freePort();
    runner = new RunnerServer({
      port,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      accessToken: ACCESS,
      helperAccess: access,
      beta: true,
      hostChecks: net,
      queuePumpMs: 3_600_000,
    });
    await runner.start();
    // Someone else holds the slot for a long Competitive Benchmark.
    (runner as unknown as { session: { run: { begin: (...a: unknown[]) => boolean } } }).session.run.begin(
      'bench-1',
      'https://a.example/',
      'benchmark'
    );
  });

  afterAll(async () => {
    await runner?.stop();
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
  });

  it('answers the key holder with the plain 409, as before', async () => {
    const answer = await call(port, 'POST', '/api/runner/run', { ...json, 'x-qa-access': ACCESS }, target);
    expect(answer.status).toBe(409);
    expect(answer.json.code).toBe('ERR_RUN_IN_PROGRESS');
  });

  it('puts an account in line, in order, and shows the place on its status', async () => {
    const first = await call(port, 'POST', '/api/runner/run', { ...json, cookie: cookies[0] }, target);
    expect(first.status).toBe(202);
    expect(first.json).toEqual({ queued: true, position: 1 });
    const second = await call(port, 'POST', '/api/runner/run', { ...json, cookie: cookies[1] }, target);
    expect(second.json).toEqual({ queued: true, position: 2 });
    const status = await call(port, 'GET', '/api/runner/status', { cookie: cookies[1] });
    expect(status.json.queue).toEqual({ position: 2 });
  });

  it('refuses a queued start for a missing address before it takes a place', async () => {
    const answer = await call(port, 'POST', '/api/runner/run', { ...json, cookie: cookies[0] }, '{}');
    expect(answer.status).toBe(400);
  });

  it('leaving the line moves the next one up', async () => {
    const left = await call(port, 'DELETE', '/api/runner/queue', { cookie: cookies[0] });
    expect(left.json).toEqual({ left: true });
    const status = await call(port, 'GET', '/api/runner/status', { cookie: cookies[1] });
    expect(status.json.queue).toEqual({ position: 1 });
    expect((await call(port, 'DELETE', '/api/runner/queue', { cookie: cookies[0] })).json).toEqual({ left: false });
  });

  it('a stranger cannot join or leave the line', async () => {
    expect((await call(port, 'DELETE', '/api/runner/queue')).status).toBe(401);
  });

  it('the ping route answers with no sign-in and no detail', async () => {
    const answer = await call(port, 'GET', '/api/runner/ping');
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({});
  });
});

describe('keep-alive', () => {
  it('calls RUNNER_PUBLIC_URL/api/runner/ping while a run is active, and not when idle', async () => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const publicPort = (server.address() as { port: number }).port;
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-keepalive-'));
    const port = await freePort();
    const runner = new RunnerServer({
      port,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      publicUrl: `http://127.0.0.1:${publicPort}`,
      keepAliveMs: 40,
    });
    try {
      await runner.start();
      await new Promise((r) => setTimeout(r, 150));
      expect(hits).toEqual([]);
      (runner as unknown as { session: { run: { begin: (...a: unknown[]) => boolean } } }).session.run.begin(
        'bench-1',
        'https://a.example/',
        'benchmark'
      );
      await new Promise((r) => setTimeout(r, 200));
      expect(hits.length).toBeGreaterThan(0);
      expect(new Set(hits)).toEqual(new Set(['/api/runner/ping']));
    } finally {
      await runner.stop();
      await new Promise<void>((r) => server.close(() => r()));
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  });
});
