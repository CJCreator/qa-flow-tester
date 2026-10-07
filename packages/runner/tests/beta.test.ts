/**
 * A runner shared with outside testers (beta mode): each tester's AI key lives in memory for their
 * session only, only public sites can be checked, and routes that change what other testers see are
 * closed. A runner without beta mode works as before.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import { refusedTarget } from '../src/beta.js';
import type { OpenRouterClient } from '@qa/core';

const PORT = 3571;
const scratch = path.join(process.cwd(), '.tmp-beta');

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(method: string, rawPath: string, cookie?: string, body?: unknown): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: rawPath,
        method,
        headers: {
          host: `localhost:${PORT}`,
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
async function newSession(): Promise<string> {
  const first = await call('GET', '/api/runner/status');
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
