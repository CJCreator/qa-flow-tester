/**
 * On the shared beta copy every visitor sees only their own check-up. The runner holds one run at a
 * time; whatever is current belongs to the visitor who started it, and to everyone else it doesn't
 * exist: not its status, plan, progress, report, past check-ups or evidence.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import type { OpenRouterClient } from '@qa/core';

const PORT = 3572;
const scratch = path.join(process.cwd(), '.tmp-beta-privacy');

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

async function newSession(): Promise<{ cookie: string; id: string }> {
  const first = await call('GET', '/api/runner/status');
  const cookie = (first.headers['set-cookie']?.find((c) => c.startsWith('qa_session=')) || '').split(';')[0];
  return { cookie, id: cookie.slice('qa_session='.length) };
}

/** Opens the event stream and collects what arrives, until closed. */
function openStream(cookie: string): { text: () => string; close: () => void } {
  let received = '';
  const req = http.request(
    { host: 'localhost', port: PORT, path: '/api/runner/stream', headers: { host: `localhost:${PORT}`, cookie } },
    (res) => {
      res.on('data', (chunk) => (received += chunk));
    }
  );
  req.on('error', () => {});
  req.end();
  return { text: () => received, close: () => req.destroy() };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What a test reaches into: the state a run in progress would have set. */
interface Inside {
  runOwners: Map<string, string>;
  currentRunId: string | null;
  phase: string;
  isRunning: boolean;
  currentTargetUrl: string | null;
  lastReport: unknown;
  runEvents: Array<Record<string, unknown>>;
  broadcastRunnerEvent(event: Record<string, unknown>): void;
}

describe('On the shared copy, a visitor sees only their own check-up', () => {
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

    // Alice's check-up of her site is testing; two finished check-ups are on disk, one each.
    inside.runOwners.set('run-1001', alice.id);
    inside.runOwners.set('run-1002', bob.id);
    inside.currentRunId = 'run-1001';
    inside.currentTargetUrl = 'https://alices-secret-site.example/';
    inside.phase = 'testing';
    inside.isRunning = true;
    for (const [runId, host] of [
      ['run-1001', 'alices-secret-site.example'],
      ['run-1002', 'bobs-site.example'],
    ]) {
      const dir = path.join(scratch, 'report', 'runs', runId);
      await fs.mkdir(path.join(dir, 'evidence'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'summary.json'),
        JSON.stringify({
          runId,
          targetUrl: `https://${host}/`,
          host,
          timestamp: new Date().toISOString(),
          ready: true,
          stamp: 'Ready to release',
        })
      );
      await fs.writeFile(
        path.join(dir, 'report.json'),
        JSON.stringify({ runId, targetUrl: `https://${host}/`, findings: [] })
      );
      await fs.writeFile(path.join(dir, 'evidence', 'shot.png'), 'png');
    }
  });

  afterAll(async () => {
    await server?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('shows the owner their run, and everyone else an idle copy that is busy', async () => {
    const mine = JSON.parse((await call('GET', '/api/runner/status', alice.cookie)).body);
    expect(mine).toMatchObject({
      phase: 'testing',
      runId: 'run-1001',
      targetUrl: 'https://alices-secret-site.example/',
    });

    const theirs = await call('GET', '/api/runner/status', bob.cookie);
    expect(JSON.parse(theirs.body)).toMatchObject({
      phase: 'idle',
      runId: null,
      targetUrl: null,
      hasPlan: false,
      reportRunId: null,
      busy: true,
    });
    expect(theirs.body).not.toContain('alices-secret-site');
  });

  it('keeps the plan, the report and the evidence of a run to its owner', async () => {
    for (const route of ['/api/runner/plan', '/api/runner/plan/markdown', '/api/runner/plan/export']) {
      const answer = await call('GET', route, bob.cookie);
      expect(answer.status, route).toBe(404);
      expect(JSON.parse(answer.body).code).toBe('ERR_NOT_YOURS');
    }
    expect((await call('POST', '/api/runner/plan/approve', bob.cookie, {})).status).toBe(404);

    inside.lastReport = { runId: 'run-1001', targetUrl: 'https://alices-secret-site.example/' };
    expect((await call('GET', '/api/report', bob.cookie)).status).toBe(404);
    expect((await call('GET', '/api/report', alice.cookie)).status).toBe(200);

    expect((await call('GET', '/api/evidence/runs/run-1001/evidence/shot.png', bob.cookie)).status).toBe(404);
    expect((await call('GET', '/api/evidence/runs/run-1001/evidence/shot.png', alice.cookie)).status).toBe(200);
    // Nothing outside a visitor's own runs is served as evidence.
    expect((await call('GET', '/api/evidence/findings.json', alice.cookie)).status).toBe(404);
  });

  it('lists only a visitor’s own past check-ups and opens only those', async () => {
    const aliceRuns = JSON.parse((await call('GET', '/api/runs', alice.cookie)).body).runs.map(
      (r: { runId: string }) => r.runId
    );
    const bobRuns = JSON.parse((await call('GET', '/api/runs', bob.cookie)).body).runs.map(
      (r: { runId: string }) => r.runId
    );
    expect(aliceRuns).toEqual(['run-1001']);
    expect(bobRuns).toEqual(['run-1002']);
    expect((await call('GET', '/api/runs/run-1001', bob.cookie)).status).toBe(404);
    expect((await call('GET', '/api/runs/run-1002', bob.cookie)).status).toBe(200);
    // Someone with no check-ups sees none, whichever were run.
    const carol = await newSession();
    expect(JSON.parse((await call('GET', '/api/runs', carol.cookie)).body).runs).toEqual([]);
  });

  it('does not let another visitor stop a run', async () => {
    const answer = JSON.parse((await call('POST', '/api/runner/abort', bob.cookie, {})).body);
    expect(answer.aborted).toBe(false);
    expect(inside.phase).toBe('testing');
    expect(inside.isRunning).toBe(true);
  });

  it('sends a run’s progress only to the visitor who started it', async () => {
    const forAlice = openStream(alice.cookie);
    const forBob = openStream(bob.cookie);
    await wait(150);
    inside.broadcastRunnerEvent({ type: 'DISCOVERY_PROGRESS', runId: 'run-1001', pagesFound: 7 });
    await wait(150);
    expect(forAlice.text()).toContain('DISCOVERY_PROGRESS');
    expect(forBob.text()).not.toContain('DISCOVERY_PROGRESS');
    forAlice.close();
    forBob.close();
  });

  it('shows no waiting plans of anyone else', async () => {
    expect(JSON.parse((await call('GET', '/api/runner/waiting-plans', bob.cookie)).body).plans).toEqual([]);
  });

  it('offers no shared visual baselines', async () => {
    expect(JSON.parse((await call('GET', '/api/runner/baselines', bob.cookie)).body)).toEqual([]);
    expect((await call('POST', '/api/runner/baselines/accept', bob.cookie, {})).status).toBe(403);
  });

  it('keeps what is remembered about a site to the visitor who checked it', async () => {
    // Alice's memory of a site is in her own folder, where only her requests look.
    const dir = path.join(scratch, 'data', 'sessions', alice.id, 'sites');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'alices-secret-site.example.json'),
      JSON.stringify({
        host: 'alices-secret-site.example',
        updatedAt: new Date().toISOString(),
        owner: true,
        pages: [],
      })
    );
    const hosts = async (who: { cookie: string }) =>
      JSON.parse((await call('GET', '/api/sites', who.cookie)).body).sites.map((x: { host: string }) => x.host);
    expect(await hosts(alice)).toEqual(['alices-secret-site.example']);
    expect(await hosts(bob)).toEqual([]);
  });
});
