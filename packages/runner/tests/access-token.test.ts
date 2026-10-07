/**
 * A runner shared through a tunnel (`pnpm tunnel`) answers only requests that carry its access key:
 * from the link's ?access=<key>, which is moved into a cookie, or from an X-QA-Access header. A runner
 * without a key works as before.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { RunnerServer } from '../src/server.js';

const KEYED_PORT = 3561;
const OPEN_PORT = 3562;
const KEY = 'k3y-0123456789abcdefABCDEF';
const scratch = path.join(process.cwd(), '.tmp-access-token');

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function get(port: number, rawPath: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: 'localhost', port, path: rawPath, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
      })
      .on('error', reject);
  });
}

describe('A runner shared with an access key', () => {
  let keyed: RunnerServer;
  let open: RunnerServer;

  beforeAll(async () => {
    keyed = new RunnerServer({
      port: KEYED_PORT,
      outputDir: path.join(scratch, 'keyed-report'),
      dataDir: path.join(scratch, 'keyed-data'),
      accessToken: KEY,
    });
    open = new RunnerServer({
      port: OPEN_PORT,
      outputDir: path.join(scratch, 'open-report'),
      dataDir: path.join(scratch, 'open-data'),
    });
    await keyed.start();
    await open.start();
  });

  afterAll(async () => {
    await keyed?.stop();
    await open?.stop();
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it('turns away pages and API calls without the key', async () => {
    const page = await get(KEYED_PORT, '/');
    expect(page.status).toBe(401);
    expect(page.body).toContain('shared privately');

    const api = await get(KEYED_PORT, '/api/runner/status');
    expect(api.status).toBe(401);
    expect(JSON.parse(api.body).error).toContain('access key');
  });

  it('turns away a wrong key, however it is sent', async () => {
    expect((await get(KEYED_PORT, '/api/runner/status', { cookie: 'qa_access=wrong' })).status).toBe(401);
    expect((await get(KEYED_PORT, '/api/runner/status', { 'x-qa-access': 'wrong' })).status).toBe(401);

    const link = await get(KEYED_PORT, '/?access=wrong');
    expect(link.status).toBe(401);
    expect(link.headers['set-cookie']).toBeUndefined();
  });

  it('moves the key from the link into a cookie and reloads the page without it', async () => {
    const link = await get(KEYED_PORT, `/reports?access=${KEY}&site=shop`);
    expect(link.status).toBe(303);
    expect(link.headers.location).toBe('/reports?site=shop');

    const cookie = link.headers['set-cookie']?.[0] || '';
    expect(cookie).toContain(`qa_access=${KEY}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('marks the cookie Secure when the tunnel says the visit was https', async () => {
    const link = await get(KEYED_PORT, `/?access=${KEY}`, { 'x-forwarded-proto': 'https' });
    expect(link.status).toBe(303);
    expect(link.headers['set-cookie']?.[0]).toContain('Secure');
  });

  it('lets in requests that carry the key in the cookie or the X-QA-Access header', async () => {
    expect((await get(KEYED_PORT, '/api/runner/status', { cookie: `theme=dark; qa_access=${KEY}` })).status).toBe(200);
    expect((await get(KEYED_PORT, '/api/runner/status', { 'x-qa-access': KEY })).status).toBe(200);
  });

  it('changes nothing for a runner without a key', async () => {
    expect((await get(OPEN_PORT, '/api/runner/status')).status).toBe(200);
  });
});
