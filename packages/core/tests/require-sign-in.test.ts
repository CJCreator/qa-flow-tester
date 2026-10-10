import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';
import { SignInFailedError } from '../src/index.js';

const LOGIN_FORM = `<form method="post" action="/login">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="password">Password</label><input id="password" name="password" type="password">
  <button type="submit">Sign in</button>
</form>`;
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

describe('requireSignIn', () => {
  const PORT = 3547;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-require-sign-in');
  const USER = 'member-user@example.com';
  const PASS = 'correct-pw-91x';
  const BAD = 'wrong-pw-77q';
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const signedIn = (req.headers.cookie || '').includes('session=ok');
      const send = (html: string) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      };
      if (url.pathname === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (new URLSearchParams(body).get('password') === PASS) {
            res.writeHead(302, { 'Set-Cookie': 'session=ok; Path=/', Location: '/account' });
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

  const run = (password: string, requireSignIn: boolean, sub: string, events: string[]) =>
    new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'gated',
      outputDir: path.join(outputDir, sub),
      requireSignIn,
      profile: {
        name: 'Gated',
        productId: 'gated',
        roles: [{ role: 'member', username: USER, password, loginPath: '/login' }],
      },
      onProgress: (p: { stage: string }) => events.push(p.stage),
    } as never);

  it('wrong password: rejects with SignInFailedError before any crawl, without leaking details', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const events: string[] = [];
    try {
      const err = await run(BAD, true, 'wrong', events).then(
        () => undefined,
        (e: unknown) => e
      );
      expect(err).toBeInstanceOf(SignInFailedError);
      const e = err as SignInFailedError;
      expect(e.reason).toBe('wrong-details');
      expect(e.role).toBe('member');
      expect(e.code).toBe('ERR_SIGN_IN_FAILED');
      expect(e.message).not.toContain(BAD);
      expect(e.message).not.toContain(USER);
      expect(e.message).not.toContain(baseUrl);
      expect(events).not.toContain('crawling');
    } finally {
      log.mockRestore();
    }
  }, 90000);

  it('correct password: the crawl proceeds', async () => {
    const events: string[] = [];
    const draft = await run(PASS, true, 'right', events);
    expect(events).toContain('crawling');
    expect(draft).toBeTruthy();
  }, 90000);

  describe.each([
    ['home page returns 500', 3548, (res: http.ServerResponse) => { res.writeHead(500); res.end('boom'); }],
    ['connection dropped', 3549, (res: http.ServerResponse) => { res.socket?.destroy(); }],
  ] as const)('unreachable home page: %s', (_name, port, respond) => {
    it('requireSignIn: throws reason unreachable, no crawl', async () => {
      const down = http.createServer((_req, res) => respond(res));
      await new Promise<void>((resolve) => down.listen(port, resolve));
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const events: string[] = [];
      try {
        const err = await new DiscoveryAgent()
          .discover({
            targetUrl: `http://localhost:${port}`,
            productId: 'down',
            outputDir: path.join(outputDir, `down-${port}`),
            requireSignIn: true,
            profile: {
              name: 'Down',
              productId: 'down',
              roles: [{ role: 'member', username: USER, password: PASS, loginPath: '/login' }],
            },
            onProgress: (p: { stage: string }) => events.push(p.stage),
          } as never)
          .then(
            () => undefined,
            (e: unknown) => e
          );
        expect(err).toBeInstanceOf(SignInFailedError);
        expect((err as SignInFailedError).reason).toBe('unreachable');
        expect(events).not.toContain('crawling');
      } finally {
        log.mockRestore();
        await new Promise<void>((resolve) => down.close(() => resolve()));
      }
    }, 90000);
  });

  it('requireSignIn false with a wrong password: no throw, crawl runs', async () => {
    const events: string[] = [];
    const draft = await run(BAD, false, 'optional', events);
    expect(events).toContain('crawling');
    expect(draft).toBeTruthy();
  }, 90000);
});
