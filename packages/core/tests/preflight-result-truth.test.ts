/**
 * T-302 (LC-005, LC-006, LC-007). The pre-flight result must not claim what it did not check: a Role is
 * signed in only after a sign-in ran, `loginReachable` is true only when the sign-in page answered, and a
 * start address that answers 4xx carries its warning (and is still "reachable", deliberately).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import type { ProductProfile } from '@qa/types';
import { PreFlightChecker } from '../src/preflight.js';

let BASE = '';

const html = (body: string) => `<!doctype html><html lang="en"><body>${body}</body></html>`;
const SIGN_IN_FORM = `<form method="post" action="/login">
  <input id="email" name="email" type="email">
  <input id="password" name="password" type="password">
  <button type="submit">Sign in</button>
</form>`;

const profileWith = (loginPath?: string): ProductProfile => ({
  name: 'Truth',
  productId: 'truth',
  roles: [
    {
      role: 'member',
      username: 'member@example.com',
      password: 'member-pass',
      ...(loginPath ? { loginPath } : {}),
    },
  ],
});

describe('pre-flight result truth (T-302)', () => {
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = new URL(req.url || '/', BASE).pathname;
      const send = (body: string, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html' });
        res.end(body);
      };
      switch (path) {
        case '/':
          return send(html('<h1>Home</h1>'));
        case '/login':
          return send(html(SIGN_IN_FORM));
        case '/restricted':
          return send(html('<h1>Sign in</h1>'), 401);
        default:
          return send('Not found', 404);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    BASE = `http://localhost:${addr && typeof addr === 'object' ? addr.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reports no Role as signed in when there is no browser to sign in with', async () => {
    const result = await new PreFlightChecker().runPreFlight(BASE, profileWith('/login'), undefined, {});

    expect(result.roleAuthResults.member).not.toBe(true);
    expect(result.roleDiagnostics.member).toMatchObject({ ok: false, attempts: 0 });
    expect(result.roleStorageStates?.member).toBeUndefined();
    // The reachability part still ran, so the sign-in page that answered is reported truthfully.
    expect(result.loginReachable).toBe(true);
    expect(result.ok).toBe(false);
  }, 30000);

  it('reports loginReachable false when the sign-in page does not answer', async () => {
    const result = await new PreFlightChecker().runPreFlight(BASE, profileWith('/gone'), undefined, {});

    expect(result.loginReachable).toBe(false);
    expect(result.roleAuthResults.member).not.toBe(true);
  }, 30000);

  it('fails a Role whose own sign-in page never answered as `unreachable`', async () => {
    const result = await new PreFlightChecker().runPreFlight(BASE, profileWith('/gone'), undefined, {});

    expect(result.roleFailures?.member).toBe('unreachable');
    expect(result.roleDiagnostics.member).toMatchObject({ ok: false, failedStep: 'goto' });
  }, 30000);

  it('judges each Role by its own sign-in page, not by whichever was asked last', async () => {
    const profile: ProductProfile = {
      name: 'Truth',
      productId: 'truth',
      roles: [
        { role: 'member', username: 'member@example.com', password: 'member-pass', loginPath: '/login' },
        { role: 'auditor', username: 'auditor@example.com', password: 'auditor-pass', loginPath: '/gone' },
      ],
    };

    const result = await new PreFlightChecker().runPreFlight(BASE, profile, undefined, {});

    expect(result.loginReachable).toBe(false);
    expect(result.roleAuthResults).toMatchObject({ member: false, auditor: false });
    expect(result.roleFailures?.auditor).toBe('unreachable');
    // One unreachable page is enough to make the whole answer false.
    expect(result.loginReachable).toBe(false);
  }, 30000);

  it('carries the 4xx start warning only for a 4xx start address', async () => {
    const checker = new PreFlightChecker();

    const ok = await checker.checkUrlReachable(BASE);
    expect(ok).toMatchObject({ ok: true, status: 200 });
    expect(ok.startWarning).toBeUndefined();

    const asking = await checker.checkUrlReachable(`${BASE}/restricted`);
    expect(asking).toMatchObject({ ok: true, status: 401 });
    expect(asking.startWarning).toBeUndefined();

    const missing = await checker.checkUrlReachable(`${BASE}/gone`);
    expect(missing).toMatchObject({ ok: false, status: 404, startWarning: 'start-4xx' });
  }, 30000);

  it('keeps the start warning on the pre-flight result for a 4xx start address', async () => {
    const result = await new PreFlightChecker().runPreFlight(`${BASE}/gone`, undefined, undefined, {});

    expect(result).toMatchObject({ ok: false, statusCode: 404, startWarning: 'start-4xx' });
  }, 30000);
});
