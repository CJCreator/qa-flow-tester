/**
 * The runner as the one server: the built Wizard at /, the API beside it, QA Flow Studio's old
 * addresses redirected to Past check-ups, /hub and /api/v1/* passed on to the Report Hub, and only
 * this computer's own names answered.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import type { TestCase } from '@qa/types';
import { RunnerServer } from '../src/server.js';

const RUNNER_PORT = 3551;
const HUB_PORT = 3552;
const BARE_PORT = 3553;
const TARGET_PORT = 3554;
const LONE_PORT = 3555;
const base = `http://localhost:${RUNNER_PORT}`;
const scratch = path.join(process.cwd(), '.tmp-single-server');
const wizardDir = path.join(scratch, 'wizard');

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A GET sent as written, with any Host header (fetch tidies paths and won't send a made-up Host). */
function get(port: number, rawPath: string, host = `localhost:${port}`): Promise<Answer> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: 'localhost', port, path: rawPath, headers: { host } }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
      })
      .on('error', reject);
  });
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve) => server.listen(port, 'localhost', resolve));
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('The runner as the one server', () => {
  let runner: RunnerServer;
  const hubRequests: Array<{ method: string; url: string; host: string; body: string }> = [];
  const hub = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    hubRequests.push({ method: req.method || '', url: req.url || '', host: req.headers.host || '', body });
    if (req.url === '/hub' || req.url === '/hub/?view=triage') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>Team Hub</title>');
    } else if (req.url === '/api/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.url === '/api/v1/echo' && req.method === 'POST') {
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, received: JSON.parse(body) }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  const target = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html lang="en"><head><title>Target</title></head><body><main><h1>Target</h1></main></body></html>');
  });

  beforeAll(async () => {
    await fs.mkdir(path.join(wizardDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(wizardDir, 'index.html'), '<!doctype html><title>Wizard</title><div id="root"></div>');
    await fs.writeFile(path.join(wizardDir, 'assets', 'app-abc123.js'), 'console.log("wizard")');
    await fs.writeFile(path.join(wizardDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await fs.writeFile(path.join(scratch, 'secret.txt'), 'do not serve');

    await listen(hub, HUB_PORT);
    await listen(target, TARGET_PORT);
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      hubUrl: `http://localhost:${HUB_PORT}/`,
      ui: [{ base: '/', dir: wizardDir, name: 'Wizard' }],
    });
    await runner.start();
  });

  afterAll(async () => {
    await runner?.stop();
    await close(hub);
    await close(target);
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('serves the Wizard at /: its hashed assets are kept for good, everything else is rechecked', async () => {
    const page = await get(RUNNER_PORT, '/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain('<title>Wizard</title>');
    expect(page.headers['cache-control']).toBe('no-cache');

    const script = await get(RUNNER_PORT, '/assets/app-abc123.js');
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.headers['cache-control']).toContain('immutable');

    const icon = await get(RUNNER_PORT, '/favicon.svg');
    expect(icon.headers['content-type']).toBe('image/svg+xml');
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it('gives every screen address to the app, but a missing file is a 404', async () => {
    for (const address of ['/check/scan', '/check/plan', '/check/testing', '/reports', '/reports/run-1', '/settings', '/no/such/page']) {
      expect((await get(RUNNER_PORT, address)).body, address).toContain('<title>Wizard</title>');
    }
    expect((await get(RUNNER_PORT, '/assets/missing.js')).status).toBe(404);
  });

  it('sends QA Flow Studio\'s old addresses, and everything under them, to Past check-ups', async () => {
    for (const address of ['/studio', '/studio/', '/studio/runs/42', '/studio/assets/studio-def456.css']) {
      const answer = await get(RUNNER_PORT, address);
      expect(answer.status, address).toBe(308);
      expect(answer.headers.location, address).toBe('/reports');
    }
  });

  it('never reads a file outside a build folder', async () => {
    for (const attempt of ['/..%2fsecret.txt', '/..%5csecret.txt', '/reports/..%2f..%2fsecret.txt', '/../secret.txt', '/%2e%2e/secret.txt']) {
      const answer = await get(RUNNER_PORT, attempt);
      expect(answer.status, attempt).toBe(404);
      expect(answer.body, attempt).not.toContain('do not serve');
    }
  });

  it('keeps the API in front of the UIs', async () => {
    const status = await get(RUNNER_PORT, '/api/runner/status');
    expect(JSON.parse(status.body)).toHaveProperty('phase');
    const unknown = await get(RUNNER_PORT, '/api/nothing-here');
    expect(unknown.status).toBe(404);
    expect(unknown.body).not.toContain('<title>Wizard</title>');
  });

  it("only answers to this computer's own names", async () => {
    expect((await get(RUNNER_PORT, '/', `evil.example:${RUNNER_PORT}`)).status).toBe(403);
    expect((await get(RUNNER_PORT, '/api/runner/status', 'evil.example')).status).toBe(403);
    expect((await get(RUNNER_PORT, '/', `127.0.0.1:${RUNNER_PORT}`)).status).toBe(200);
  });

  it('says a Hub is connected, and passes its dashboard at /hub on to it', async () => {
    expect(JSON.parse((await get(RUNNER_PORT, '/api/runner/status')).body)).toMatchObject({ hubConnected: true });
    hubRequests.length = 0;
    const dashboard = await get(RUNNER_PORT, '/hub');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body).toContain('<title>Team Hub</title>');
    expect((await get(RUNNER_PORT, '/hub/?view=triage')).body).toContain('<title>Team Hub</title>');
    expect(hubRequests.map((r) => r.url)).toEqual(['/hub', '/hub/?view=triage']);
  });

  it('passes /api/v1/* on to the Report Hub, body and all', async () => {
    hubRequests.length = 0;
    const health = await fetch(`${base}/api/v1/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    expect(hubRequests[0].host).toBe(`localhost:${HUB_PORT}`);

    const echo = await fetch(`${base}/api/v1/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACCEPTED_RISK' }),
    });
    expect(echo.status).toBe(201);
    expect(await echo.json()).toEqual({ method: 'POST', received: { status: 'ACCEPTED_RISK' } });
  });

  it('without a Hub, answers /hub and /api/v1/* with "Hub not connected", and a missing UI build explains itself', async () => {
    const bare = new RunnerServer({
      port: BARE_PORT,
      outputDir: path.join(scratch, 'bare-report'),
      dataDir: path.join(scratch, 'bare-data'),
      ui: [{ base: '/', dir: path.join(scratch, 'never-built'), name: 'Wizard' }],
    });
    await bare.start();
    try {
      const hubless = await get(BARE_PORT, '/api/v1/health');
      expect(hubless.status).toBe(503);
      expect(JSON.parse(hubless.body)).toMatchObject({ error: 'Hub not connected', hubConnected: false });
      expect((await get(BARE_PORT, '/hub')).status).toBe(503);
      expect(JSON.parse((await get(BARE_PORT, '/api/runner/status')).body)).toMatchObject({ hubConnected: false });

      const unbuilt = await get(BARE_PORT, '/');
      expect(unbuilt.status).toBe(503);
      expect(unbuilt.body).toContain('hasn’t been built yet');
    } finally {
      await bare.stop();
    }
  });

  it('does not send a run to itself as the Hub when no Hub is set up', async () => {
    const lone = new RunnerServer({ port: LONE_PORT, outputDir: path.join(scratch, 'lone-report'), dataDir: path.join(scratch, 'lone-data') });
    await lone.start();
    const events: Array<{ type: string }> = [];
    const stream = new AbortController();
    try {
      const res = await fetch(`http://localhost:${LONE_PORT}/api/runner/stream`, { signal: stream.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      void (async () => {
        let buffer = '';
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            buffer += decoder.decode(value, { stream: true });
            for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
              const chunk = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (chunk.startsWith('data: ')) events.push(JSON.parse(chunk.slice(6)));
            }
          }
        } catch {
          // stream closed
        }
      })();

      const lookAtThePage: TestCase = {
        id: 'TC-LOOK',
        flowId: 'look',
        name: 'Look at the page',
        role: 'visitor',
        startPage: '/',
        steps: [{ action: 'wait', name: 'Look at the page' }],
        expectations: {},
      };
      // A caller that sends this server's own address as the Hub means "the Hub behind /api/v1".
      const started = await fetch(`http://localhost:${LONE_PORT}/api/runner/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: `http://localhost:${TARGET_PORT}/`,
          hubUrl: `http://localhost:${LONE_PORT}`,
          breakpoints: ['1440px'],
          specTestCases: [lookAtThePage],
        }),
      });
      expect(started.status).toBe(202);

      await expect.poll(() => events.some((e) => e.type === 'RUN_COMPLETED'), { timeout: 60000, interval: 250 }).toBe(true);
      // Pushing to a Hub is the last thing a run does; give it the chance to happen.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(events.filter((e) => e.type === 'HUB_PUSH_RESULT')).toEqual([]);
    } finally {
      stream.abort();
      await lone.stop();
    }
  }, 90000);
});
