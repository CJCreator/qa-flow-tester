import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import {
  runAccessChecks,
  checkSignedOutAccess,
  checkSessionIsolation,
  ACCESS_CHECKS_NOTE,
  type AccessFetcher,
} from '../src/access-control.js';

const PORT = 3097;
const BASE = `http://127.0.0.1:${PORT}`;
const requests: Array<{ method?: string; headers: http.IncomingHttpHeaders; url?: string }> = [];

const server = http.createServer((req, res) => {
  requests.push({ method: req.method, headers: req.headers, url: req.url });
  const cookie = req.headers.cookie ?? '';
  const who = /user=(\w+)/.exec(cookie)?.[1];
  res.setHeader('content-type', 'text/html');
  if (req.url === '/open') return void res.end(`<main>Private dashboard for ${who ?? 'nobody'}</main>`);
  if (req.url === '/closed') {
    if (!who) {
      res.statusCode = 302;
      res.setHeader('location', '/login');
      return void res.end();
    }
    return void res.end(`<main>Hello ${who}</main>`);
  }
  if (req.url === '/denied') {
    if (!who) {
      res.statusCode = 401;
      return void res.end('no');
    }
    return void res.end(`<main>Hello ${who}</main>`);
  }
  // Leaks the name of whoever asked first, to everyone after.
  if (req.url === '/mirror-leak') return void res.end(`<main>Account of alice_admin</main>`);
  if (req.url === '/mirror-ok') return void res.end(`<main>Account of ${who ?? 'nobody'}</main>`);
  res.statusCode = 404;
  res.end('x');
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function fetcher(user?: string): AccessFetcher {
  return async (url) => {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: user ? { cookie: `user=${user}` } : {},
    });
    return { status: res.status, location: res.headers.get('location') ?? undefined, body: await res.text() };
  };
}

const page = (urlPath: string, reachedBy = ['alice']) => ({ urlPath, reachedBy });

describe('pure checks', () => {
  it('200 with content is a Blocker; redirect to sign-in, 401, 403 are none', () => {
    expect(
      checkSignedOutAccess({ target: '/a', status: 200, redirectedToSignIn: false, hasProtectedContent: true })
        ?.severity
    ).toBe('Blocker');
    expect(
      checkSignedOutAccess({ target: '/a', status: 302, redirectedToSignIn: true, hasProtectedContent: false })
    ).toBeUndefined();
    expect(
      checkSignedOutAccess({ target: '/a', status: 401, redirectedToSignIn: false, hasProtectedContent: true })
    ).toBeUndefined();
    expect(
      checkSignedOutAccess({ target: '/a', status: 403, redirectedToSignIn: false, hasProtectedContent: true })
    ).toBeUndefined();
  });
  it('isolation needs the marker in role B', () => {
    expect(checkSessionIsolation({ target: '/a', roleA: 'a', roleB: 'b', markerSeenByB: false })).toBeUndefined();
    expect(checkSessionIsolation({ target: '/a', roleA: 'a', roleB: 'b', markerSeenByB: true })?.severity).toBe(
      'Blocker'
    );
  });
});

describe('runAccessChecks against a local server', () => {
  it('flags the open page, not the closed or 401 ones; GET only, no Origin, no body', async () => {
    requests.length = 0;
    const out = await runAccessChecks({
      targetUrl: BASE,
      pages: [page('/open'), page('/closed'), page('/denied')],
      signedOut: fetcher(),
      roles: { alice: fetcher('alice') },
      markers: { alice: 'alice' },
    });
    expect(out.findings.map((f) => f.where.urlPath)).toEqual(['/open']);
    expect(out.notes).toContain(ACCESS_CHECKS_NOTE);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(['GET', 'HEAD']).toContain(r.method);
      expect(r.headers.origin).toBeUndefined();
      expect(r.headers['content-length']).toBeUndefined();
    }
  });

  it('skips pages a visitor reached and risky paths', async () => {
    requests.length = 0;
    const out = await runAccessChecks({
      targetUrl: BASE,
      pages: [page('/open', ['visitor', 'alice']), page('/logout'), page('/delete-account')],
      signedOut: fetcher(),
      roles: { alice: fetcher('alice') },
      markers: {},
    });
    expect(out.findings).toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it('two roles: leak variant is found, own-session variant is not', async () => {
    const roles = { alice_admin: fetcher('alice_admin'), bob_user: fetcher('bob_user') };
    const markers = { alice_admin: 'alice_admin', bob_user: 'bob_user' };
    const leak = await runAccessChecks({
      targetUrl: BASE,
      pages: [page('/mirror-leak', ['alice_admin'])],
      signedOut: fetcher(),
      roles,
      markers,
    });
    const iso = leak.findings.filter((f) => f.id.startsWith('F-ACCESS-ISOLATION'));
    expect(iso).toHaveLength(1);
    expect(iso[0].where.role).toBe('bob_user');

    const ok = await runAccessChecks({
      targetUrl: BASE,
      pages: [page('/mirror-ok', ['alice_admin'])],
      signedOut: fetcher(),
      roles,
      markers,
    });
    expect(ok.findings.filter((f) => f.id.startsWith('F-ACCESS-ISOLATION'))).toEqual([]);
  });

  it('one role: isolation skipped with a note', async () => {
    const out = await runAccessChecks({
      targetUrl: BASE,
      pages: [page('/closed')],
      signedOut: fetcher(),
      roles: { alice: fetcher('alice') },
      markers: { alice: 'alice' },
    });
    expect(out.findings).toEqual([]);
    expect(out.notes.join(' ')).toMatch(/isolation check was not run/);
  });

  it('caps at 25 paths and says so; a refused host is not requested', async () => {
    requests.length = 0;
    const pages = Array.from({ length: 30 }, (_, i) => page(`/closed?n=${i}`));
    const out = await runAccessChecks({
      targetUrl: BASE,
      pages,
      signedOut: fetcher(),
      roles: { alice: fetcher('alice') },
      markers: {},
    });
    expect(out.checkedPaths).toBe(25);
    expect(out.notes.join(' ')).toMatch(/5 more were not checked/);

    requests.length = 0;
    await runAccessChecks({
      targetUrl: BASE,
      pages: [page('/open')],
      signedOut: fetcher(),
      roles: { alice: fetcher('alice') },
      markers: {},
      allow: async () => false,
    });
    expect(requests).toHaveLength(0);
  });

  it('sentinel cookie value and username stay out of findings and notes', async () => {
    const out = await runAccessChecks({
      targetUrl: BASE,
      pages: [page('/open', ['zed_sentinel_user'])],
      signedOut: fetcher(),
      roles: { zed_sentinel_user: fetcher('zed_sentinel_user'), other: fetcher('other') },
      markers: { zed_sentinel_user: 'zed_sentinel_user', other: 'other' },
    });
    expect(out.findings.length).toBeGreaterThan(0);
    const text = JSON.stringify(out);
    expect(text).not.toContain('user=zed_sentinel_user');
  });
});

describe('contract', () => {
  it('no reader of activeChecksConsent in core src; ADR 0030 links its siblings', async () => {
    const dir = path.resolve(__dirname, '../src');
    const files = (await fs.readdir(dir, { recursive: true })) as string[];
    for (const f of files.filter((n) => n.endsWith('.ts'))) {
      const text = await fs.readFile(path.join(dir, f), 'utf8');
      expect(text, f).not.toContain('activeChecksConsent');
    }
    const adr = await fs.readFile(
      path.resolve(__dirname, '../../../docs/adr/0030-passive-vs-active-security-boundary.md'),
      'utf8'
    );
    for (const n of ['0003-', '0014-', '0022-']) expect(adr).toContain(n);
  });
});
