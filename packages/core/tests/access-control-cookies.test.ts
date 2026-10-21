import { describe, it, expect } from 'vitest';
import { cookieHeaderFor, safeGet, type NetDeps, type PinnedRequest, type RawResponse } from '../src/safe-net.js';
import { roleFetcher } from '../src/access-control.js';

/** Fake DNS and connect: each name has one answer, and every connect is recorded. */
function fakeNet(respond: (req: PinnedRequest) => RawResponse) {
  const connects: PinnedRequest[] = [];
  const deps: NetDeps = {
    lookup: async () => ['93.184.216.34'],
    connect: async (req) => {
      connects.push(req);
      return respond(req);
    },
  };
  return { deps, connects };
}

const cookie = { name: 'sid', value: 'abc', domain: 'app.example.com', path: '/', secure: true, expires: -1 };

describe('cookieHeaderFor (ADR 0031)', () => {
  it('sends a cookie only to a matching host, path and scheme', () => {
    expect(cookieHeaderFor(new URL('https://app.example.com/dashboard'), [cookie])).toBe('sid=abc');
    expect(cookieHeaderFor(new URL('https://other.example.net/'), [cookie])).toBeUndefined();
    expect(cookieHeaderFor(new URL('http://app.example.com/'), [cookie])).toBeUndefined();
    expect(cookieHeaderFor(new URL('https://app.example.com/'), [{ ...cookie, path: '/admin' }])).toBeUndefined();
  });

  it('matches a domain cookie on its subdomains and skips expired cookies', () => {
    const domainCookie = { ...cookie, domain: '.example.com', secure: false };
    expect(cookieHeaderFor(new URL('http://shop.example.com/'), [domainCookie])).toBe('sid=abc');
    expect(cookieHeaderFor(new URL('http://example.com.evil.test/'), [domainCookie])).toBeUndefined();
    expect(cookieHeaderFor(new URL('http://example.com/'), [{ ...domainCookie, expires: 1 }])).toBeUndefined();
  });
});

describe('safeGet with cookies', () => {
  it('sends the cookie to the first hop and not to a redirected host', async () => {
    const { deps, connects } = fakeNet((req) =>
      req.url.hostname === 'app.example.com'
        ? { status: 302, headers: { location: 'https://cdn.other.test/x' }, body: '' }
        : { status: 200, headers: {}, body: 'ok' }
    );
    const out = await safeGet('https://app.example.com/dashboard', { maxRedirects: 2, cookies: [cookie] }, deps);
    expect(out.ok).toBe(true);
    expect(connects[0].headers.Cookie).toBe('sid=abc');
    expect(connects[1].headers.Cookie).toBeUndefined();
  });
});

describe('roleFetcher', () => {
  it('returns no answer when the storage state has no readable cookies', async () => {
    const fetcher = await roleFetcher({ cookies: [], origins: [] }, { allowPrivate: false, timeoutMs: 1000 });
    expect(await fetcher('https://app.example.com/dashboard')).toBeUndefined();
  });
});
