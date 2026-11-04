/**
 * T-203: the route inventory. A net under T-206's rewrite of the dispatch chain.
 *
 * Every (method, path) pair the chain in `RunnerServer.start()` matches is asserted *matched* here, against the
 * server as it is today: the answer is not the generic fallback `{"error":"Not found"}` of `server.ts` (the last
 * lines of the chain). Any status is fine — 400, 401, 403, 404-with-another-body, 409, 422 and 429 all mean the
 * route was reached and refused the request because of the state it is in, not because it was never matched.
 *
 * The chain has **42** `if (pathname …)` conditionals; this file has **60** pairs, because some conditionals serve
 * more than one method or alias (`abort`/`stop`, the six `/api/runs/…` shapes, three `/api/sites/…` shapes). The
 * mapping, in the order the chain is written:
 *
 * | chain conditional                            | pairs here                                                |
 * |----------------------------------------------|-----------------------------------------------------------|
 * | `GET /healthz` (no method check)             | 1                                                         |
 * | `/studio` and `/studio/…` (308, retired UI)  | 2                                                         |
 * | `/api/runs` and `/api/runs/…` (one helper)   | 10-15: list, read, delete, download, triage, judgement     |
 * | `GET /api/runner/stream`                     | 3                                                         |
 * | `POST /api/runner/run`                       | 5                                                         |
 * | `POST /api/runner/abort` or `/stop`          | 6, 7 (two aliases of one conditional)                      |
 * | `GET /api/report`                            | 8                                                         |
 * | `GET /api/runner/status`                     | 4                                                         |
 * | `GET /api/runner/plan`                       | 16                                                        |
 * | `PATCH /api/runner/plan`                     | 17                                                        |
 * | `POST /api/runner/plan/approve`              | 18                                                        |
 * | `POST /api/runner/plan/interpret`            | 19                                                        |
 * | `GET /api/runner/plan/markdown`              | 20                                                        |
 * | `GET /api/runner/plan/export`                | 21                                                        |
 * | `POST /api/runner/plan/replan`               | 22                                                        |
 * | `POST /api/runner/plan/add-page`             | 23                                                        |
 * | `/api/runner/waiting-plans` (no method check)| 26                                                        |
 * | `POST /api/runner/plan/add-sign-in`          | 25                                                        |
 * | `POST /api/runner/plan/include-host`         | 24                                                        |
 * | `/api/sites` and `/api/sites/…` (one helper) | 27-29: list, read, save one host                          |
 * | `/api/settings/defaults` (both methods)      | 30, 31                                                    |
 * | `POST /api/runner/ai-estimate`               | 32                                                        |
 * | `POST /api/runner/preflight`                 | 33                                                        |
 * | `POST /api/runner/context/docx`              | 34                                                        |
 * | `POST /api/runner/domain-proof`              | 35                                                        |
 * | `GET /api/report/download/…`                 | 9                                                         |
 * | `POST /api/runner/ai/finish`                 | 36                                                        |
 * | `/api/ai/…` (except `/api/ai/openrouter/…`)  | 37, 38, 41, 42: settings (GET, POST), usage, test-model   |
 * | `/api/ai/openrouter/…`                       | 39, 40, 43, 44: key (GET, POST), validate, free-models   |
 * | `GET /api/baselines/…`                       | 48                                                        |
 * | `GET /api/runner/baselines`                  | 45                                                        |
 * | `POST /api/runner/baselines/accept`          | 46                                                        |
 * | `DELETE /api/runner/baselines/…`             | 47                                                        |
 * | `POST /api/runner/benchmark`                 | 49                                                        |
 * | `GET /api/runner/benchmarks`                 | 50                                                        |
 * | `GET`/`DELETE /api/runner/benchmark/…`       | 51, 52 (two methods of one conditional)                    |
 * | `GET /api/runner/schedules`                  | 53                                                        |
 * | `POST /api/runner/schedules`                 | 54                                                        |
 * | `POST /api/runner/schedules/…/toggle`        | 55                                                        |
 * | `DELETE /api/runner/schedules/…`             | 56                                                        |
 * | `POST /api/runner/spec-override`             | 57                                                        |
 * | `GET /api/runner/spec-overrides`             | 58                                                        |
 * | `GET /api/evidence/…`                        | 59                                                        |
 * | `POST /api/runner/schedules/tick` (ADR 0039)  | 60 (new row, no chain conditional; answers 401 here)      |
 *
 * (`grep -c "if (pathname" packages/runner/src/server.ts` counts 47 in the file: the 42 above plus 5 inside the
 * beta-scope helpers, which decide whether *an already matched* route is visible to a beta visitor and never
 * route anything themselves.)
 *
 * T-206 will keep this file untouched and green: it is the proof that moving the plan rows into a table changed
 * nothing. If a pair here starts answering the fallback, a route was lost.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import path from 'path';
import { promises as fs } from 'fs';
import { RunnerServer } from '../src/server.js';

/** The generic answer of an unmatched path: the last lines of the dispatch chain in `start()`. */
const FALLBACK = JSON.stringify({ error: 'Not found' });

/** Requests that carry a body: the handlers answer 400/422 for an empty one, which is a match. */
const WITH_BODY = new Set(['POST', 'PATCH', 'PUT']);

const ROUTES: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/healthz' }, // 1
  { method: 'GET', path: '/studio' }, // 2 — retires to Past check-ups with 308
  { method: 'GET', path: '/api/runner/stream' }, // 3 — asserted on its own below (SSE)
  { method: 'GET', path: '/api/runner/status' }, // 4
  { method: 'POST', path: '/api/runner/run' }, // 5
  { method: 'POST', path: '/api/runner/abort' }, // 6
  { method: 'POST', path: '/api/runner/stop' }, // 7
  { method: 'GET', path: '/api/report' }, // 8
  { method: 'GET', path: '/api/report/download/report.md' }, // 9
  { method: 'GET', path: '/api/runs' }, // 10
  { method: 'GET', path: '/api/runs/run-does-not-exist' }, // 11
  { method: 'DELETE', path: '/api/runs/run-does-not-exist' }, // 12
  { method: 'GET', path: '/api/runs/run-does-not-exist/download/report.md' }, // 13
  { method: 'POST', path: '/api/runs/run-does-not-exist/triage' }, // 14
  { method: 'POST', path: '/api/runs/run-does-not-exist/accept-judgement' }, // 15
  { method: 'GET', path: '/api/runner/plan' }, // 16
  { method: 'PATCH', path: '/api/runner/plan' }, // 17
  { method: 'POST', path: '/api/runner/plan/approve' }, // 18
  { method: 'POST', path: '/api/runner/plan/interpret' }, // 19
  { method: 'GET', path: '/api/runner/plan/markdown' }, // 20
  { method: 'GET', path: '/api/runner/plan/export' }, // 21
  { method: 'POST', path: '/api/runner/plan/replan' }, // 22
  { method: 'POST', path: '/api/runner/plan/add-page' }, // 23
  { method: 'POST', path: '/api/runner/plan/include-host' }, // 24
  { method: 'POST', path: '/api/runner/plan/add-sign-in' }, // 25
  { method: 'GET', path: '/api/runner/waiting-plans' }, // 26 — matched with no method check
  { method: 'GET', path: '/api/sites' }, // 27
  { method: 'GET', path: '/api/sites/example.invalid' }, // 28
  { method: 'POST', path: '/api/sites/example.invalid' }, // 29
  { method: 'GET', path: '/api/settings/defaults' }, // 30
  { method: 'POST', path: '/api/settings/defaults' }, // 31
  { method: 'POST', path: '/api/runner/ai-estimate' }, // 32
  { method: 'POST', path: '/api/runner/preflight' }, // 33
  { method: 'POST', path: '/api/runner/context/docx' }, // 34
  { method: 'POST', path: '/api/runner/domain-proof' }, // 35
  { method: 'POST', path: '/api/runner/ai/finish' }, // 36
  { method: 'GET', path: '/api/ai/settings' }, // 37
  { method: 'POST', path: '/api/ai/settings' }, // 38
  { method: 'GET', path: '/api/ai/openrouter/key' }, // 39
  { method: 'POST', path: '/api/ai/openrouter/key' }, // 40
  { method: 'GET', path: '/api/ai/usage' }, // 41
  { method: 'POST', path: '/api/ai/test-model' }, // 42
  { method: 'POST', path: '/api/ai/openrouter/validate' }, // 43
  { method: 'GET', path: '/api/ai/openrouter/free-models' }, // 44
  { method: 'GET', path: '/api/runner/baselines' }, // 45
  { method: 'POST', path: '/api/runner/baselines/accept' }, // 46
  { method: 'DELETE', path: '/api/runner/baselines/some-baseline' }, // 47
  { method: 'GET', path: '/api/baselines/some-image.png' }, // 48
  { method: 'POST', path: '/api/runner/benchmark' }, // 49
  { method: 'GET', path: '/api/runner/benchmarks' }, // 50
  { method: 'GET', path: '/api/runner/benchmark/some-benchmark' }, // 51
  { method: 'DELETE', path: '/api/runner/benchmark/some-benchmark' }, // 52
  { method: 'GET', path: '/api/runner/schedules' }, // 53
  { method: 'POST', path: '/api/runner/schedules' }, // 54
  { method: 'POST', path: '/api/runner/schedules/some-schedule/toggle' }, // 55
  { method: 'DELETE', path: '/api/runner/schedules/some-schedule' }, // 56
  { method: 'POST', path: '/api/runner/spec-override' }, // 57
  { method: 'GET', path: '/api/runner/spec-overrides' }, // 58
  { method: 'GET', path: '/api/evidence/some-file.txt' }, // 59
  { method: 'POST', path: '/api/runner/schedules/tick' }, // 60: scheduler-only; no token here, so 401
];

describe('route inventory (T-203)', () => {
  const outputDir = path.join(process.cwd(), '.tmp-route-inventory');
  const dataDir = path.join(process.cwd(), '.tmp-route-inventory-data');

  let runner: RunnerServer;
  let base: string;

  beforeAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    // No hard-coded port: a throwaway server on port 0 says which one is free, and gives it straight back.
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

  it.each(ROUTES)('$method $path is matched (not the generic 404)', async ({ method, path: routePath }) => {
    const res = await fetch(`${base}${routePath}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: WITH_BODY.has(method) ? '{}' : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    if (routePath === '/api/runner/stream') {
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      await res.body?.cancel();
      return;
    }
    const body = await res.text();
    expect(body).not.toBe(FALLBACK);
  });

  it('GET /api/runner/stream answers a live event stream, not JSON', async () => {
    const res = await fetch(`${base}/api/runner/stream`, { signal: AbortSignal.timeout(15000) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    // Cancelled, not consumed: an open stream would keep the server from closing.
    await res.body?.cancel();
  });

  it('GET /healthz answers ok', async () => {
    const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(15000) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('GET /studio retires to Past check-ups with 308', async () => {
    const res = await fetch(`${base}/studio`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/reports');
    await res.text();
  });

  describe('CORS origins', () => {
    function withOrigin(
      origin: string,
      method = 'GET'
    ): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
      const url = new URL(`${base}/api/runner/status`);
      return new Promise((resolve, reject) => {
        const req = http.request(
          { host: url.hostname, port: url.port, path: url.pathname, method, headers: { origin } },
          (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers }));
          }
        );
        req.on('error', reject);
        req.end();
      });
    }

    it('sends credentialed CORS headers for this server’s own origin', async () => {
      const own = new URL(base).origin;
      const res = await withOrigin(own);
      expect(res.headers['access-control-allow-origin']).toBe(own);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('sends none for another localhost port', async () => {
      const res = await withOrigin('http://localhost:9999');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('refuses a cross-origin write from another localhost port', async () => {
      const res = await withOrigin('http://localhost:9999', 'POST');
      expect(res.status).toBe(403);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  // The negative control: without it, a check that passed for the wrong reason (`fetch` failing, the server
  // answering the fallback everywhere) would look green.
  it('an unknown path answers exactly the generic 404', async () => {
    const res = await fetch(`${base}/api/does-not-exist`, { signal: AbortSignal.timeout(15000) });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(FALLBACK);
  });
});
