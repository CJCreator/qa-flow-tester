/**
 * The runner as the one server: the built Wizard at / (and at every address of its own), the API
 * beside it, Studio's old addresses redirected to Past check-ups, and only this computer's own names
 * answered.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';

const RUNNER_PORT = 3551;
const BARE_PORT = 3553;
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

describe('The runner as the one server', () => {
  let runner: RunnerServer;
  beforeAll(async () => {
    await fs.mkdir(path.join(wizardDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(wizardDir, 'index.html'), '<!doctype html><title>Wizard</title><div id="root"></div>');
    await fs.writeFile(path.join(wizardDir, 'assets', 'app-abc123.js'), 'console.log("wizard")');
    await fs.writeFile(path.join(wizardDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await fs.writeFile(path.join(scratch, 'secret.txt'), 'do not serve');

    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      ui: [{ base: '/', dir: wizardDir, name: 'Wizard' }],
    });
    await runner.start();
  });

  afterAll(async () => {
    await runner?.stop();
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

  it('gives every screen address to the app, so a refresh or a bookmark opens it, but a missing file is a 404', async () => {
    for (const address of [
      '/check/plan',
      '/check/testing',
      '/reports',
      '/reports/run-1700000000000',
      '/settings',
      '/no-such-page',
    ]) {
      const page = await get(RUNNER_PORT, address);
      expect(page.status, address).toBe(200);
      expect(page.body, address).toContain('<title>Wizard</title>');
    }
    expect((await get(RUNNER_PORT, '/assets/missing.js')).status).toBe(404);
  });

  it('sends every old Studio address to Past check-ups', async () => {
    for (const address of ['/studio', '/studio/', '/studio/runs/42', '/studio/assets/studio-def456.css']) {
      const answer = await get(RUNNER_PORT, address);
      expect(answer.status, address).toBe(308);
      expect(answer.headers.location, address).toBe('/reports');
    }
  });

  it('never reads a file outside a build folder', async () => {
    for (const attempt of [
      '/..%2fsecret.txt',
      '/..%5csecret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/../secret.txt',
      '/%2e%2e/secret.txt',
    ]) {
      const answer = await get(RUNNER_PORT, attempt);
      expect(answer.status, attempt).toBe(404);
      expect(answer.body, attempt).not.toContain('do not serve');
    }
  });

  it('keeps the API in front of the app', async () => {
    const status = await get(RUNNER_PORT, '/api/runner/status');
    expect(JSON.parse(status.body)).toMatchObject({ phase: 'idle' });
    const unknown = await get(RUNNER_PORT, '/api/nothing-here');
    expect(unknown.status).toBe(404);
    expect(unknown.body).not.toContain('<title>Wizard</title>');
  });

  it("only answers to this computer's own names", async () => {
    expect((await get(RUNNER_PORT, '/', `evil.example:${RUNNER_PORT}`)).status).toBe(403);
    expect((await get(RUNNER_PORT, '/api/runner/status', 'evil.example')).status).toBe(403);
    expect((await get(RUNNER_PORT, '/', `127.0.0.1:${RUNNER_PORT}`)).status).toBe(200);
  });

  it('a missing UI build explains itself', async () => {
    const bare = new RunnerServer({
      port: BARE_PORT,
      outputDir: path.join(scratch, 'bare-report'),
      dataDir: path.join(scratch, 'bare-data'),
      ui: [{ base: '/', dir: path.join(scratch, 'never-built'), name: 'Wizard' }],
    });
    await bare.start();
    try {
      const unbuilt = await get(BARE_PORT, '/');
      expect(unbuilt.status).toBe(503);
      expect(unbuilt.body).toContain('hasn’t been built yet');
    } finally {
      await bare.stop();
    }
  });
});
