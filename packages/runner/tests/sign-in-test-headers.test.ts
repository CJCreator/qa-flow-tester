/**
 * T-296: the sign-in test sends only the headers its own request carries, never another run's secrets.
 * The browser is stubbed, so nothing launches. Only obvious fake secrets here.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { BrowserManager } from '@qa/core';
import { RunnerServer } from '../src/server.js';
import { freePort } from './helpers/free-port.js';

const scratch = path.join(process.cwd(), '.tmp-sign-in-test-headers');

function post(port: number, rawPath: string, json: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(json);
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: rawPath,
        method: 'POST',
        headers: {
          host: `localhost:${port}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: text ? JSON.parse(text) : {} }));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

describe('T-296: the sign-in test uses only its own headers', () => {
  let server: RunnerServer;
  let port: number;
  const seen: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    port = await freePort();
    server = new RunnerServer({
      port,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
      beta: true,
    });
    await server.start();
  });

  afterAll(async () => {
    await server?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    seen.length = 0;
  });

  function stubBrowser() {
    vi.spyOn(BrowserManager.prototype, 'createContext').mockImplementation(async (opts) => {
      seen.push({ ...(opts ?? {}) });
      throw new Error('no browser in unit tests');
    });
    // Another tester's secrets are already in the session.
    server.session.secrets.set({
      headers: { 'X-Alice-Bypass': 'alice-secret-1' },
      tunnelAuth: 'alice:pw-2',
      headerHosts: ['alice.example'],
      userAgent: 'AliceAgent',
    });
  }

  const notAlices = (value: unknown) => {
    const text = JSON.stringify(value);
    for (const leak of ['alice-secret-1', 'alice:pw-2', 'alice.example', 'AliceAgent']) {
      expect(text).not.toContain(leak);
    }
  };

  it('sends none of another tester’s secrets when the request carries no headers', async () => {
    stubBrowser();
    const res = await post(port, '/api/sites/attacker.example', { addSignIn: { username: 'u', password: 'p' } });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('unreachable');
    expect(seen).toHaveLength(1);
    notAlices(seen[0]);
    expect(seen[0].customHeaders).toBeUndefined();
  });

  it('sends the request’s own headers and still nothing of the other tester’s', async () => {
    stubBrowser();
    const res = await post(port, '/api/sites/attacker.example', {
      addSignIn: { username: 'u', password: 'p' },
      customHeaders: 'X-Own: mine',
    });
    expect(res.status).toBe(422);
    expect(seen).toHaveLength(1);
    expect(seen[0].customHeaders).toEqual({ 'X-Own': 'mine' });
    notAlices(seen[0]);
  });

  it('refuses headers that are not valid, before any browser context', async () => {
    stubBrowser();
    const res = await post(port, '/api/sites/attacker.example', {
      addSignIn: { username: 'u', password: 'p' },
      customHeaders: 'no colon here',
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ERR_INVALID_HEADERS');
    expect(seen).toHaveLength(0);
  });
});
