import http from 'http';
import type { AddressInfo } from 'net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeOutboundFetch, resolvePublic, safeGet, type NetDeps, type PinnedRequest, type RawResponse } from '../src/safe-net.js';

/** Fake DNS and connect: each name has one answer, and every connect is recorded. */
function fakeNet(answers: Record<string, string[]>, respond: (req: PinnedRequest) => RawResponse) {
  const connects: PinnedRequest[] = [];
  const deps: NetDeps = {
    lookup: async (host) => {
      const found = answers[host];
      if (!found) throw new Error('ENOTFOUND');
      return found;
    },
    connect: async (req) => {
      connects.push(req);
      return respond(req);
    },
  };
  return { deps, connects };
}

const redirectTo = (location: string): RawResponse => ({ status: 302, headers: { location }, body: '' });
const page = (body = 'ok'): RawResponse => ({ status: 200, headers: {}, body });

describe('resolvePublic (ADR 0031)', () => {
  it('refuses loopback, metadata, private and text hosts when private addresses are not allowed', async () => {
    for (const host of ['127.0.0.1', '169.254.169.254', '10.0.0.5', '[::1]', 'localhost']) {
      expect((await resolvePublic(host)).ok, host).toBe(false);
    }
  });

  it('refuses a name when any one of its addresses is private', async () => {
    const { deps } = fakeNet({ 'mixed.test': ['93.184.216.34', '127.0.0.1'] }, () => page());
    expect(await resolvePublic('mixed.test', deps)).toEqual({ ok: false, reason: 'private-address' });
  });

  it('accepts a public name and returns the address it checked', async () => {
    const { deps } = fakeNet({ 'site.test': ['93.184.216.34'] }, () => page());
    expect(await resolvePublic('site.test', deps)).toEqual({
      ok: true,
      address: '93.184.216.34',
      all: ['93.184.216.34'],
    });
  });

  it('with allowPrivate (a local run) accepts loopback names and addresses', async () => {
    const { deps } = fakeNet({ 'app.test': ['127.0.0.1'], localhost: ['127.0.0.1'] }, () => page());
    expect((await resolvePublic('app.test', deps, true)).ok).toBe(true);
    expect((await resolvePublic('localhost', deps, true)).ok).toBe(true);
    expect((await resolvePublic('127.0.0.1', deps, true)).ok).toBe(true);
  });
});

describe('safeGet on a shared machine', () => {
  it('does not follow a redirect to loopback or the metadata address', async () => {
    for (const target of ['http://127.0.0.1:8080/admin', 'http://169.254.169.254/latest/meta-data/']) {
      const { deps, connects } = fakeNet({ 'shop.test': ['93.184.216.34'] }, (req) =>
        req.url.hostname === 'shop.test' ? redirectTo(target) : page('secret')
      );
      expect(await safeGet('https://shop.test/go', {}, deps)).toEqual({ ok: false, reason: 'private-address' });
      expect(connects.map((c) => c.address)).toEqual(['93.184.216.34']);
    }
  });

  it('refuses a name that resolves to loopback before any connection is made', async () => {
    const { deps, connects } = fakeNet({ 'evil.test': ['127.0.0.1'] }, () => page());
    expect(await safeGet('http://evil.test/', {}, deps)).toEqual({ ok: false, reason: 'private-address' });
    expect(connects).toHaveLength(0);
  });

  it('still follows a redirect to a public host (external Navigation Check)', async () => {
    const { deps, connects } = fakeNet({ 'a.test': ['93.184.216.34'], 'b.test': ['93.184.216.35'] }, (req) =>
      req.url.hostname === 'a.test' ? redirectTo('https://b.test/landing') : page('ok')
    );
    const got = await safeGet('https://a.test/', { maxRedirects: 10 }, deps);
    expect(got.ok && got.status).toBe(200);
    expect(connects.map((c) => c.address)).toEqual(['93.184.216.34', '93.184.216.35']);
  });

  it('with allowPrivate a local target and its same-machine redirect still work', async () => {
    const { deps } = fakeNet({ localhost: ['127.0.0.1'] }, (req) =>
      req.url.pathname === '/' ? redirectTo('http://localhost/about') : page('about')
    );
    const got = await safeGet('http://localhost/', { allowPrivate: true }, deps);
    expect(got.ok).toBe(true);
  });
});

describe('makeOutboundFetch (checker GET)', () => {
  it('returns status, headers and body for a public address', async () => {
    const { deps } = fakeNet({ 'site.test': ['93.184.216.34'] }, () => ({
      status: 200,
      headers: { sourcemap: 'a.map', 'x-multi': ['a', 'b'] },
      body: 'hello',
    }));
    const get = makeOutboundFetch({ allowPrivate: false, timeoutMs: 3000 }, deps);
    const res = await get('https://site.test/a.js');
    expect(res?.status).toBe(200);
    expect(res?.headers).toEqual({ sourcemap: 'a.map', 'x-multi': 'a, b' });
    expect(await res?.text()).toBe('hello');
  });

  it('returns null for a private target, and for a redirect when maxRedirects is 0', async () => {
    const { deps, connects } = fakeNet({ 'site.test': ['93.184.216.34'] }, () => redirectTo('https://site.test/other'));
    expect(await makeOutboundFetch({ allowPrivate: false, timeoutMs: 3000, maxRedirects: 0 }, deps)('https://site.test/robots')).toBeNull();
    expect(await makeOutboundFetch({ allowPrivate: false, timeoutMs: 3000 }, deps)('http://127.0.0.1/x')).toBeNull();
    expect(connects).toHaveLength(1);
  });
});

describe('loopback server: refused addresses get no hits', () => {
  let server: http.Server;
  let port: number;
  let hits: number;

  beforeEach(async () => {
    hits = 0;
    server = http.createServer((_req, res) => {
      hits++;
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('a GET from a shared machine never reaches 127.0.0.1, and the checker GET returns null', async () => {
    expect(await safeGet(`http://127.0.0.1:${port}/`)).toEqual({ ok: false, reason: 'private-address' });
    const get = makeOutboundFetch({ allowPrivate: false, timeoutMs: 3000 });
    expect(await get(`http://127.0.0.1:${port}/`)).toBeNull();
    expect(hits).toBe(0);
  });

  it('a public host that redirects to the loopback server is not followed (0 hits)', async () => {
    const { deps } = fakeNet({ 'shop.test': ['93.184.216.34'] }, () => redirectTo(`http://127.0.0.1:${port}/`));
    expect((await safeGet('https://shop.test/', {}, deps)).ok).toBe(false);
    expect(hits).toBe(0);
  });

  it('a local run (allowPrivate) does reach the loopback server', async () => {
    const got = await safeGet(`http://127.0.0.1:${port}/`, { allowPrivate: true });
    expect(got.ok && got.status).toBe(200);
    expect(hits).toBe(1);
  });
});
