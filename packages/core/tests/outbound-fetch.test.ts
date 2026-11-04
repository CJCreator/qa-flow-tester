/**
 * ADR 0031 (REQ-047): makeOutboundFetch is the one outbound path. Pinned, every hop re-checked, GET only,
 * body capped; private addresses only on a local run (no browser guard). Fake network only.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  makeOutboundFetch,
  safeGet,
  sameSiteUrl,
  type NetDeps,
  type PinnedRequest,
  type RawResponse,
} from '../src/safe-net.js';
import { setBrowserPolicy } from '../src/browser.js';

function fake(names: Record<string, string[]>, responses: Record<string, RawResponse>) {
  const lookups: string[] = [];
  const connects: PinnedRequest[] = [];
  const deps: NetDeps = {
    async lookup(host) {
      lookups.push(host);
      const answer = names[host];
      if (!answer) throw new Error('ENOTFOUND');
      return answer;
    },
    async connect(req) {
      connects.push(req);
      const r = responses[req.url.toString()];
      if (!r) throw new Error('refused');
      return r;
    },
  };
  return { deps, lookups, connects };
}

const ok = (body = '', status = 200): RawResponse => ({ status, headers: { 'content-type': 'text/plain' }, body });
const redirect = (to: string, status = 302): RawResponse => ({ status, headers: { location: to }, body: '' });
const guardOn = () => setBrowserPolicy({ guard: async () => true });

afterEach(() => setBrowserPolicy(null));

describe('makeOutboundFetch with a browser guard set (shared machine)', () => {
  it('AC-1: a host resolving to 127.0.0.1 or 169.254.169.254, or a literal private IP, is never connected to', async () => {
    guardOn();
    const f = fake(
      { 'loop.test': ['127.0.0.1'], 'meta.test': ['169.254.169.254'] },
      { 'http://loop.test/': ok('x'), 'http://meta.test/': ok('SECRET'), 'http://169.254.169.254/': ok('SECRET') }
    );
    const get = makeOutboundFetch({ deps: f.deps });
    expect(await get('http://loop.test/')).toBeNull();
    expect(await get('http://meta.test/')).toBeNull();
    expect(await get('http://169.254.169.254/')).toBeNull();
    expect(await get('http://localhost/')).toBeNull();
    expect(f.connects).toHaveLength(0);
  });

  it('AC-2: a public URL that redirects to a private address is refused at the redirect hop', async () => {
    guardOn();
    const f = fake(
      { 'good.test': ['93.184.216.34'], 'meta.test': ['169.254.169.254'] },
      { 'http://good.test/': redirect('http://meta.test/latest'), 'http://meta.test/latest': ok('SECRET') }
    );
    expect(await makeOutboundFetch({ deps: f.deps })('http://good.test/')).toBeNull();
    expect(f.connects.map((c) => c.url.hostname)).toEqual(['good.test']);
  });

  it('allowPrivate: true cannot widen past the guard', async () => {
    guardOn();
    const f = fake({ 'loop.test': ['127.0.0.1'] }, { 'http://loop.test/': ok('x') });
    expect(await makeOutboundFetch({ allowPrivate: true, deps: f.deps })('http://loop.test/')).toBeNull();
    expect(f.connects).toHaveLength(0);
  });

  it('a public host is fetched, pinned to the checked address', async () => {
    guardOn();
    const f = fake({ 'good.test': ['93.184.216.34'] }, { 'http://good.test/robots.txt': ok('User-agent: *') });
    const res = await makeOutboundFetch({ deps: f.deps })('http://good.test/robots.txt');
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe('User-agent: *');
    expect(res?.headers['content-type']).toBe('text/plain');
    expect(f.connects[0].address).toBe('93.184.216.34');
  });
});

describe('makeOutboundFetch with no browser guard (local run)', () => {
  it('AC-3: the same private target is fetched, still resolved once and pinned', async () => {
    const f = fake({ 'loop.test': ['::1', '127.0.0.1'] }, { 'http://loop.test/': ok('local') });
    const res = await makeOutboundFetch({ deps: f.deps })('http://loop.test/');
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe('local');
    expect(f.lookups).toEqual(['loop.test']);
    expect(f.connects).toHaveLength(1);
    expect(f.connects[0].address).toBe('127.0.0.1');
  });

  it('AC-3: a redirect to a private host is followed and re-resolved on that hop', async () => {
    const f = fake(
      { 'a.test': ['10.0.0.5'], 'b.test': ['192.168.1.9'] },
      { 'http://a.test/': redirect('http://b.test/x'), 'http://b.test/x': ok('hi') }
    );
    const res = await makeOutboundFetch({ deps: f.deps })('http://a.test/');
    expect(res?.status).toBe(200);
    expect(f.lookups).toEqual(['a.test', 'b.test']);
    expect(f.connects.map((c) => c.address)).toEqual(['10.0.0.5', '192.168.1.9']);
  });

  it('allowPrivate: false keeps a local run public only', async () => {
    const f = fake({ 'loop.test': ['127.0.0.1'] }, { 'http://loop.test/': ok('x') });
    expect(await makeOutboundFetch({ allowPrivate: false, deps: f.deps })('http://loop.test/')).toBeNull();
    expect(f.connects).toHaveLength(0);
  });

  it('localhost is looked up (not refused by name) on a local run', async () => {
    const f = fake({ localhost: ['127.0.0.1'] }, { 'http://localhost:4000/': ok('dev') });
    const res = await makeOutboundFetch({ deps: f.deps })('http://localhost:4000/');
    expect(res?.status).toBe(200);
    expect(f.connects[0].address).toBe('127.0.0.1');
  });
});

describe('makeOutboundFetch request shape', () => {
  it('sends GET only through the pinned connect (no method can be chosen) with the extra headers', async () => {
    const f = fake({ 'a.test': ['93.184.216.34'] }, { 'http://a.test/p': ok('x') });
    await makeOutboundFetch({ headers: { Cookie: 'sid=1' }, deps: f.deps })('http://a.test/p');
    expect(f.connects[0].headers).toEqual({ Cookie: 'sid=1' });
    expect(Object.keys(f.connects[0])).not.toContain('method');
  });

  it('caps the body: an over-cap body still returns its status, with an empty body', async () => {
    const f = fake(
      { 'a.test': ['93.184.216.34'] },
      { 'http://a.test/big': { status: 200, headers: {}, body: '', tooLarge: true } }
    );
    const res = await makeOutboundFetch({ maxBytes: 10, deps: f.deps })('http://a.test/big');
    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe('');
    expect(f.connects[0].maxBytes).toBe(10);
  });

  it('a PNG body round-trips byte-exact through bytes(); the text() view is unchanged', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]);
    const f = fake(
      { 'a.test': ['93.184.216.34'] },
      { 'http://a.test/i.png': { status: 200, headers: {}, body: png.toString('utf8'), raw: png } }
    );
    const res = await makeOutboundFetch({ maxBytes: 100, deps: f.deps })('http://a.test/i.png');
    const bytes = await res?.bytes();
    expect(Buffer.from(bytes ?? []).equals(png)).toBe(true);
    expect(await res?.text()).toBe(png.toString('utf8'));
  });

  it('bytes() of a text body is its UTF-8 bytes; an over-cap body gives zero bytes', async () => {
    const f = fake(
      { 'a.test': ['93.184.216.34'] },
      {
        'http://a.test/t': ok('héllo'),
        'http://a.test/big': { status: 200, headers: {}, body: '', tooLarge: true },
      }
    );
    const get = makeOutboundFetch({ maxBytes: 10, deps: f.deps });
    expect(Buffer.from(await (await get('http://a.test/t'))!.bytes()).toString('utf8')).toBe('héllo');
    const big = await get('http://a.test/big');
    expect(big?.status).toBe(200);
    expect((await big!.bytes()).length).toBe(0);
    expect(f.connects[1].maxBytes).toBe(10);
  });

  it('over a real local socket: binary bytes are exact and the cap applies to the raw bytes', async () => {
    const http = await import('http');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]);
    const server = http.createServer((_req, res) => res.end(png));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as { port: number };
    try {
      const url = `http://127.0.0.1:${port}/i.png`;
      const res = await makeOutboundFetch({ maxBytes: 100 })(url);
      expect(Buffer.from((await res?.bytes()) ?? []).equals(png)).toBe(true);
      const capped = await makeOutboundFetch({ maxBytes: png.length - 1 })(url);
      expect(capped?.status).toBe(200);
      expect((await capped!.bytes()).length).toBe(0);
    } finally {
      server.close();
    }
  });

  it('maxRedirects 0 returns the 3xx with its Location, no second hop', async () => {
    const f = fake({ 'a.test': ['93.184.216.34'] }, { 'http://a.test/': redirect('/login', 301) });
    const res = await makeOutboundFetch({ maxRedirects: 0, deps: f.deps })('http://a.test/');
    expect(res?.status).toBe(301);
    expect(res?.headers.location).toBe('/login');
    expect(f.connects).toHaveLength(1);
  });

  it('a redirect to another origin drops the Cookie but keeps Accept', async () => {
    const f = fake(
      { 'a.test': ['93.184.216.34'], 'b.test': ['8.8.8.8'] },
      { 'http://a.test/': redirect('http://b.test/'), 'http://b.test/': ok('x') }
    );
    await makeOutboundFetch({ headers: { Cookie: 'sid=1', Accept: 'text/xml' }, deps: f.deps })('http://a.test/');
    expect(f.connects[0].headers).toEqual({ Cookie: 'sid=1', Accept: 'text/xml' });
    expect(f.connects[1].headers).toEqual({ Accept: 'text/xml' });
  });

  it('a network error, timeout, bad scheme or unknown name returns null', async () => {
    const f = fake({ 'a.test': ['93.184.216.34'] }, {});
    const get = makeOutboundFetch({ deps: f.deps });
    expect(await get('http://a.test/')).toBeNull();
    expect(await get('file:///etc/passwd')).toBeNull();
    expect(await get('not a url')).toBeNull();
    expect(await get('http://nowhere.test/')).toBeNull();
  });
});

describe('safeGet allowPrivate', () => {
  it('is off by default: existing callers stay public only', async () => {
    const f = fake({ 'loop.test': ['127.0.0.1'] }, { 'http://loop.test/': ok('x') });
    expect(await safeGet('http://loop.test/', {}, f.deps)).toEqual({ ok: false, reason: 'private-address' });
    expect(f.connects).toHaveLength(0);
  });

  it('when set, still fails a failed or empty lookup', async () => {
    const f = fake({ 'empty.test': [] }, {});
    expect(await safeGet('http://empty.test/', { allowPrivate: true }, f.deps)).toEqual({
      ok: false,
      reason: 'dns-failed',
    });
    expect(await safeGet('http://nowhere.test/', { allowPrivate: true }, f.deps)).toEqual({
      ok: false,
      reason: 'dns-failed',
    });
  });
});

describe('sameSiteUrl', () => {
  it('matches the same host and its www twin only, http(s) only', () => {
    expect(sameSiteUrl('https://example.com/sitemap.xml', 'https://www.example.com/')).toBe(true);
    expect(sameSiteUrl(new URL('http://example.com:8080/a'), 'http://example.com:8080')).toBe(true);
    expect(sameSiteUrl('https://sitemaps.example.invalid/kaveri-sweets/sitemap.xml', 'http://127.0.0.1:4000')).toBe(
      false
    );
    expect(sameSiteUrl('https://app.example.com/', 'https://example.com/')).toBe(false);
    expect(sameSiteUrl('http://example.com:81/', 'http://example.com:80/')).toBe(false);
    expect(sameSiteUrl('ftp://example.com/', 'http://example.com/')).toBe(false);
    expect(sameSiteUrl('nonsense', 'http://example.com/')).toBe(false);
  });
});
