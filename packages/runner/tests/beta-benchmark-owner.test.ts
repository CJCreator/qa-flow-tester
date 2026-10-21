/**
 * On the shared beta copy a comparison belongs to the visitor who started it. Another visitor cannot delete it
 * (404, nothing removed), and the starter cannot delete it while it is still running (409).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import { BenchmarkStore } from '../src/benchmarks.js';
import type { BenchmarkJob } from '@qa/types';
import type { OpenRouterClient } from '@qa/core';

const PORT = 3945;
const scratch = path.join(process.cwd(), '.tmp-beta-benchmark-owner');

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function call(method: string, rawPath: string, cookie?: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: rawPath,
        method,
        headers: { host: `localhost:${PORT}`, ...(cookie ? { cookie } : {}) },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: text }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function newSession(): Promise<{ cookie: string; id: string }> {
  const first = await call('GET', '/api/runner/status');
  const cookie = (first.headers['set-cookie']?.find((c) => c.startsWith('qa_session=')) || '').split(';')[0];
  return { cookie, id: cookie.slice('qa_session='.length) };
}

/** The folder a beta visitor's comparisons are kept in: one per session, as the runner names it. */
function benchmarkDir(sessionId: string): string {
  return path.join(scratch, 'data', 'sessions', sessionId.replace(/[^\w-]/g, '_'), 'benchmarks');
}

function job(id: string, status: BenchmarkJob['status']): BenchmarkJob {
  return {
    id,
    status,
    stage: status === 'running' ? 'Starting…' : 'Done',
    flowType: 'custom',
    ourUrl: 'https://alices-site.example/',
    refUrl: 'https://rival.example/',
    startedAt: new Date().toISOString(),
  };
}

/** What a test reaches into: the comparisons a run in progress would have set. */
interface Inside {
  benchmarkJobs: Map<string, { job: BenchmarkJob; owner?: string }>;
}

describe('On the shared copy, a comparison belongs to the visitor who started it', () => {
  let server: RunnerServer;
  let inside: Inside;
  let alice: { cookie: string; id: string };
  let bob: { cookie: string; id: string };

  beforeAll(async () => {
    server = new RunnerServer({
      port: PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      beta: true,
      openRouter: {
        validateKey: async () => ({ valid: true }),
        listFreeModels: async () => [],
        freeRequestsToday: async () => null,
      } as unknown as OpenRouterClient,
    });
    await server.start();
    inside = server as unknown as Inside;
    alice = await newSession();
    bob = await newSession();

    // Alice has one finished comparison on disk and one still running.
    await new BenchmarkStore(benchmarkDir(alice.id)).save(job('bench-2001', 'done'));
    inside.benchmarkJobs.set('bench-2002', { job: job('bench-2002', 'running'), owner: alice.id });
  });

  afterAll(async () => {
    await server?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('another visitor cannot delete a finished comparison: 404, and the file stays', async () => {
    const answer = await call('DELETE', '/api/runner/benchmark/bench-2001', bob.cookie);
    expect(answer.status).toBe(404);
    await expect(fs.access(path.join(benchmarkDir(alice.id), 'bench-2001.json'))).resolves.toBeUndefined();
    const still = await call('GET', '/api/runner/benchmark/bench-2001', alice.cookie);
    expect(still.status).toBe(200);
  });

  it('another visitor cannot delete a running comparison: 404, and it keeps running', async () => {
    const answer = await call('DELETE', '/api/runner/benchmark/bench-2002', bob.cookie);
    expect(answer.status).toBe(404);
    expect(inside.benchmarkJobs.get('bench-2002')?.job.status).toBe('running');
  });

  it('a running comparison is not listed to another visitor', async () => {
    const bobList = JSON.parse((await call('GET', '/api/runner/benchmarks', bob.cookie)).body) as Array<{ id: string }>;
    const aliceList = JSON.parse((await call('GET', '/api/runner/benchmarks', alice.cookie)).body) as Array<{
      id: string;
    }>;
    expect(bobList.map((j) => j.id)).not.toContain('bench-2002');
    expect(aliceList.map((j) => j.id)).toContain('bench-2002');
  });

  it('the starter cannot delete a running comparison: 409, and it stays', async () => {
    const answer = await call('DELETE', '/api/runner/benchmark/bench-2002', alice.cookie);
    expect(answer.status).toBe(409);
    expect(JSON.parse(answer.body).code).toBe('ERR_RUN_IN_PROGRESS');
    expect(inside.benchmarkJobs.has('bench-2002')).toBe(true);
  });

  it('the starter deletes a finished comparison: 200, and it is gone', async () => {
    const answer = await call('DELETE', '/api/runner/benchmark/bench-2001', alice.cookie);
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toEqual({ removed: true });
    expect((await call('GET', '/api/runner/benchmark/bench-2001', alice.cookie)).status).toBe(404);
    await expect(fs.access(path.join(benchmarkDir(alice.id), 'bench-2001.json'))).rejects.toThrow();
  });
});
