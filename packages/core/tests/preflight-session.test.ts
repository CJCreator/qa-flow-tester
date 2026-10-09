import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { PreFlightChecker } from '../src/preflight.js';
import { BrowserManager } from '../src/browser.js';

const SENTINEL = 'SENTINEL-session-value-7f3a9c';

const LOGIN_FORM = `<form method="post" action="/login">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="password">Password</label><input id="password" name="password" type="password">
  <button type="submit">Sign in</button>
</form>`;
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

describe('Pre-flight with a supplied saved session', () => {
  const PORT = 3511;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-preflight-session');
  let server: http.Server;
  let signInRequests = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const signedIn = (req.headers.cookie || '').includes(`session=${SENTINEL}`);
      const send = (html: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      };
      if (url.pathname === '/login' && req.method === 'POST') {
        signInRequests++;
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (new URLSearchParams(body).get('password') === 'pw') {
            res.writeHead(302, { 'Set-Cookie': `session=${SENTINEL}; Path=/`, Location: '/account' });
            res.end();
          } else send(page('Sign in', '<p role="alert">Wrong email or password</p>' + LOGIN_FORM));
        });
        return;
      }
      if (url.pathname === '/login') return send(page('Sign in', LOGIN_FORM));
      if (url.pathname === '/account') {
        if (!signedIn) {
          res.writeHead(302, { Location: '/login' });
          return res.end();
        }
        return send(page('My account', '<p>Hello</p>'));
      }
      // Home page: sends a signed-out visitor to the sign-in page, like a gated app.
      if (!signedIn) {
        res.writeHead(302, { Location: '/login' });
        return res.end();
      }
      res.writeHead(302, { Location: '/account' });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  const cookie = (value: string) => ({
    name: 'session',
    value,
    domain: 'localhost',
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  });
  const profile = {
    name: 'Gated',
    productId: 'gated',
    roles: [{ role: 'member', username: 'member@example.com', password: 'pw', loginPath: '/login' }],
  };

  it('uses a valid session without any sign-in request, keeps it in memory, and writes nothing to disk', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const bm = new BrowserManager();
    try {
      const before = signInRequests;
      const authDir = path.join(outputDir, 'auth-valid');
      const result = await new PreFlightChecker().runPreFlight(baseUrl, profile, undefined, {
        browserManager: bm,
        authDir,
        suppliedSessions: { member: { cookies: [cookie(SENTINEL)], origins: [] } },
      });
      expect(signInRequests).toBe(before);
      expect(result.roleAuthResults.member).toBe(true);
      expect(result.roleFailures).toBeUndefined();
      expect(typeof result.roleStorageStates?.member).toBe('object');
      expect(result.roleLandingPaths?.member).toBe('/account');

      // The value is only in the in-memory object: not on disk, not in anything logged.
      const files = await fs.readdir(authDir).catch(() => [] as string[]);
      for (const f of files) expect(await fs.readFile(path.join(authDir, f), 'utf8')).not.toContain(SENTINEL);
      expect(JSON.stringify(log.mock.calls)).not.toContain(SENTINEL);
      const { roleStorageStates, ...rest } = result;
      expect(JSON.stringify(rest)).not.toContain(SENTINEL);
      void roleStorageStates;
    } finally {
      log.mockRestore();
      await bm.close();
    }
  }, 60000);

  it('reports session-expired when the site shows the sign-in form', async () => {
    const bm = new BrowserManager();
    try {
      const result = await new PreFlightChecker().runPreFlight(baseUrl, profile, undefined, {
        browserManager: bm,
        authDir: path.join(outputDir, 'auth-expired'),
        suppliedSessions: { member: { cookies: [cookie('old-value')], origins: [] } },
      });
      expect(result.roleAuthResults.member).toBe(false);
      expect(result.roleFailures).toEqual({ member: 'session-expired' });
      expect(result.roleStorageStates?.member).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('old-value');
    } finally {
      await bm.close();
    }
  }, 60000);

  it('records the reason for a role that signs in with details and fails', async () => {
    const bm = new BrowserManager();
    try {
      const result = await new PreFlightChecker().runPreFlight(
        baseUrl,
        { ...profile, roles: [{ ...profile.roles[0], password: 'badpass' }] },
        undefined,
        { browserManager: bm, authDir: path.join(outputDir, 'auth-fail') }
      );
      expect(result.roleAuthResults.member).toBe(false);
      expect(result.roleFailures?.member).toBe('wrong-details');
    } finally {
      await bm.close();
    }
  }, 60000);
});
