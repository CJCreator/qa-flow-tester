/**
 * The health routes: /healthz (plain text "ok", read by scripts/smoke.mjs) and /health (JSON, GET only).
 * Both are public and show no data, so they answer before the host and access-key checks.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import { promises as fs } from 'fs';
import { RunnerServer } from '../src/server.js';

describe('health routes', () => {
  const outputDir = path.join(process.cwd(), '.tmp-health-route');
  const dataDir = path.join(process.cwd(), '.tmp-health-route-data');

  let runner: RunnerServer;
  let base: string;

  beforeAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    const probe = http.createServer();
    const port = await new Promise<number>((resolve) => {
      probe.listen(0, '127.0.0.1', () => {
        const addr = probe.address();
        resolve(addr && typeof addr === 'object' ? addr.port : 0);
      });
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    runner = new RunnerServer({ port, outputDir, dataDir });
    base = await runner.start();
  }, 30000);

  afterAll(async () => {
    await runner.stop();
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it('GET /healthz answers 200 text "ok" (unchanged)', async () => {
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(15000) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('ok');
  });

  it('GET /health answers 200 JSON with status ok and uptimeSeconds', async () => {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(15000) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { status: string; uptimeSeconds: number };
    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('POST /health is not the health answer', async () => {
    const res = await fetch(`${base}/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    expect(text).not.toContain('"uptimeSeconds"');
  });
});
