/**
 * Beta copy: browsers and streams outside the run slot are limited (T-300). A Smoke Check-up and a sign-in
 * test count against the visitor's quota; one sign-in browser runs at a time; each visitor has a few event streams.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import { BrowserGate } from '../src/browser-gate.js';
import { claimBetaRun, resetBetaUsage } from '../src/beta.js';
import { BrowserManager } from '@qa/core';
import { freePort } from './helpers/free-port.js';

const scratch = path.join(process.cwd(), '.tmp-beta-side-limits');
const LIMITS = { perVisitor: 2, perDay: 40 };

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(port: number, method: string, rawPath: string, cookie?: string, body?: unknown): Promise<Answer> {
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

interface Visitor {
  cookie: string;
  id: string;
}

async function newSession(port: number): Promise<Visitor> {
  const first = await call(port, 'GET', '/api/runner/status');
  const cookie = (first.headers['set-cookie']?.find((c) => c.startsWith('qa_session=')) || '').split(';')[0];
  return { cookie, id: cookie.slice('qa_session='.length) };
}

/** Opens the event stream and resolves with its status. A stream that was let in stays open until destroyed. */
function openStream(port: number, cookie: string): Promise<{ status: number; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'localhost', port, path: '/api/runner/stream', headers: { host: `localhost:${port}`, cookie } },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode || 0, req });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('BrowserGate', () => {
  it('admits up to its limit and frees a place on release', () => {
    const gate = new BrowserGate(1);
    const first = gate.tryAcquire();
    expect(first).toBeTypeOf('function');
    expect(gate.tryAcquire()).toBeNull();
    first!();
    expect(gate.tryAcquire()).toBeTypeOf('function');
  });

  it('a release called twice frees one place only', () => {
    const gate = new BrowserGate(2);
    const release = gate.tryAcquire()!;
    expect(gate.active).toBe(1);
    release();
    release();
    expect(gate.active).toBe(0);
  });
});

describe('Beta copy: sign-in tests, Smoke Check-ups and event streams are limited', () => {
  let port: number;
  let server: RunnerServer;
  let createContext: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    port = await freePort();
    server = new RunnerServer({
      port,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      beta: true,
      betaLimits: LIMITS,
      hostChecks: { lookup: async () => ['93.184.216.34'], connect: async () => Promise.reject(new Error('no')) },
    });
    await server.start();
  });

  beforeEach(() => {
    resetBetaUsage();
    vi.restoreAllMocks();
    createContext = vi.spyOn(BrowserManager.prototype, 'createContext').mockRejectedValue(new Error('no browser'));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await server?.stop();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('a Smoke Check-up counts against the visitor limit', async () => {
    const visitor = await newSession(port);
    claimBetaRun(visitor.id, { limits: LIMITS });
    claimBetaRun(visitor.id, { limits: LIMITS });
    const answer = await call(port, 'POST', '/api/runner/run', visitor.cookie, {
      targetUrl: 'https://example.com/',
      preset: 'smoke',
    });
    expect(answer.status).toBe(429);
    expect(JSON.parse(answer.body).code).toBe('ERR_BETA_LIMIT');
  });

  it('a sign-in test counts against the visitor limit and opens no browser', async () => {
    const visitor = await newSession(port);
    claimBetaRun(visitor.id, { limits: LIMITS });
    claimBetaRun(visitor.id, { limits: LIMITS });
    const answer = await call(port, 'POST', '/api/sites/example.com', visitor.cookie, {
      addSignIn: { username: 'u', password: 'p' },
    });
    expect(answer.status).toBe(429);
    expect(JSON.parse(answer.body).code).toBe('ERR_BETA_LIMIT');
    expect(createContext).not.toHaveBeenCalled();
  });

  it('one sign-in browser at a time: a second test answers ERR_BUSY until the first ends', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    createContext.mockImplementation(async () => {
      await gate;
      throw new Error('boom');
    });
    const alice = await newSession(port);
    const bob = await newSession(port);
    const body = { addSignIn: { username: 'u', password: 'p' } };

    const first = call(port, 'POST', '/api/sites/example.com', alice.cookie, body);
    for (let i = 0; i < 200 && createContext.mock.calls.length === 0; i++) await wait(10);
    expect(createContext).toHaveBeenCalledTimes(1);

    const busy = await call(port, 'POST', '/api/sites/example.com', bob.cookie, body);
    expect(busy.status).toBe(429);
    expect(JSON.parse(busy.body).code).toBe('ERR_BUSY');
    expect(busy.headers['retry-after']).toBeDefined();

    release();
    expect((await first).status).toBe(422);

    const third = await call(port, 'POST', '/api/sites/example.com', alice.cookie, body);
    expect(third.status).toBe(422);
    expect(createContext).toHaveBeenCalledTimes(2);
  });

  it('caps one visitor at four event streams; another visitor still gets one', async () => {
    const alice = await newSession(port);
    const bob = await newSession(port);
    const open: http.ClientRequest[] = [];
    try {
      for (let i = 0; i < 4; i++) {
        const stream = await openStream(port, alice.cookie);
        open.push(stream.req);
        expect(stream.status).toBe(200);
      }
      const fifth = await openStream(port, alice.cookie);
      open.push(fifth.req);
      expect(fifth.status).toBe(429);
      const other = await openStream(port, bob.cookie);
      open.push(other.req);
      expect(other.status).toBe(200);
    } finally {
      for (const req of open) req.destroy();
      await wait(50);
    }
  });
});
