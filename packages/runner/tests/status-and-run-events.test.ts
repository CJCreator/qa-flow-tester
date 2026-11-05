/**
 * S11: reading GET /api/runner/status does not load or start a plan. M6: a run event is logged once: the
 * CheckupRun path only streams it (the checkup session already logged it).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';
import type { CheckupSession } from '../src/session/checkup-session.js';

const KEY = 'k3y-status-run-events-0123456789';
const PORT = 3932;
const scratch = path.join(process.cwd(), '.tmp-status-run-events');

function get(rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: rawPath,
        method: 'GET',
        headers: { host: `localhost:${PORT}`, 'x-qa-access': KEY },
      },
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

describe('status reads and run events (S11, M6)', () => {
  let server: RunnerServer;
  let session: CheckupSession;
  const dataDir = path.join(scratch, 'data');

  beforeAll(async () => {
    await fs.rm(scratch, { recursive: true, force: true });
    server = new RunnerServer({ port: PORT, outputDir: path.join(scratch, 'report'), dataDir, accessToken: KEY });
    await server.start();
    session = (server as unknown as { session: CheckupSession }).session;
  });

  afterAll(async () => {
    await server.stop();
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('S11: a plan file written after start is not loaded by a status read', async () => {
    const planFile = path.join(dataDir, '.qa-plan.json');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      planFile,
      JSON.stringify({
        schemaVersion: 1,
        status: 'awaiting-review',
        plan: { targetUrl: 'http://localhost:3050', runId: 'run-disk', pages: [] },
        context: { targetUrl: 'http://localhost:3050', productId: 'p', runId: 'run-disk', draft: {} },
      }),
      'utf8'
    );
    const before = await fs.readFile(planFile, 'utf8');

    const res = await get('/api/runner/status');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { hasPlan: boolean; phase: string; runId: string | null };
    expect(body.hasPlan).toBe(false);
    expect(body.phase).toBe('idle');
    expect(body.runId).toBeNull();
    expect(session.run.isRunning).toBe(false);
    expect(await fs.readFile(planFile, 'utf8')).toBe(before);
  });

  it('M6: a broadcast run event is logged once; the stream-only path does not log it', () => {
    const internal = server as unknown as { streamRunnerEvent(e: Record<string, unknown>): void };
    expect(session.run.begin('run-x', 'http://localhost:3050')).toBe(true);
    const start = session.events.log.length;

    internal.streamRunnerEvent({ type: 'STEP', runId: 'run-x' });
    expect(session.events.log.length).toBe(start);

    server.broadcastRunnerEvent({ type: 'STEP', runId: 'run-x' });
    expect(session.events.log.length).toBe(start + 1);
    session.run.release();
  });
});
