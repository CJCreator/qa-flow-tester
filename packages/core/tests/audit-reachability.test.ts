import { describe, it, expect } from 'vitest';
import { checkAuditAddress } from '../src/audit/crawl/reachability.js';
import type { NetDeps, PinnedRequest, RawResponse } from '../src/safe-net.js';

/** A fake network: no real DNS or sockets. Names map to addresses, URLs to responses. */
function fake(
  names: Record<string, string[] | Error>,
  responses: Record<string, RawResponse | Error | (() => Promise<RawResponse>)>
) {
  const connects: PinnedRequest[] = [];
  const deps: NetDeps = {
    async lookup(host) {
      const answer = names[host];
      if (answer === undefined) throw new Error('ENOTFOUND');
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async connect(req) {
      connects.push(req);
      const r = responses[req.url.toString()];
      if (r === undefined) throw new Error('ECONNREFUSED');
      if (r instanceof Error) throw r;
      return typeof r === 'function' ? r() : r;
    },
  };
  return { deps, connects };
}

const ok = (status = 200): RawResponse => ({ status, headers: {}, body: '<html></html>' });
const redirect = (to: string, status = 301): RawResponse => ({ status, headers: { location: to }, body: '' });
const PUBLIC = ['93.184.216.34'];
const INTERNALS = /ENOTFOUND|ECONNREFUSED|93\.184|10\.0\.0|127\.0|169\.254|stack|Error/;

describe('checkAuditAddress', () => {
  it('returns ok with the final URL for a public host answering below 400 (AC-1)', async () => {
    const net = fake({ 'site.test': PUBLIC }, { 'https://site.test/': ok() });
    expect(await checkAuditAddress('https://site.test/', { netDeps: net.deps })).toEqual({
      ok: true,
      finalUrl: 'https://site.test/',
      status: 200,
    });
    expect(net.connects[0].address).toBe(PUBLIC[0]);
  });

  it('follows redirects and returns the final URL and status', async () => {
    const net = fake(
      { 'site.test': PUBLIC, 'www.site.test': ['93.184.216.35'] },
      {
        'http://site.test/': redirect('https://www.site.test/'),
        'https://www.site.test/': redirect('/home', 302),
        'https://www.site.test/home': ok(204),
      }
    );
    expect(await checkAuditAddress('http://site.test/', { netDeps: net.deps })).toEqual({
      ok: true,
      finalUrl: 'https://www.site.test/home',
      status: 204,
    });
    expect(net.connects).toHaveLength(3);
  });

  it('refuses private, loopback and link-local hosts without sending a request (Q-22)', async () => {
    for (const addr of ['10.0.0.5', '192.168.1.2', '127.0.0.1', '169.254.169.254', '::1', 'fe80::1']) {
      const net = fake({ 'inside.test': [addr] }, { 'https://inside.test/': ok() });
      const res = await checkAuditAddress('https://inside.test/', { netDeps: net.deps });
      expect(res).toMatchObject({ ok: false, code: 'ERR_PRIVATE_ADDRESS' });
      expect(net.connects).toHaveLength(0);
    }
  });

  it('on a local runner (allowPrivateAddresses) accepts localhost and LAN addresses (ADR 0042)', async () => {
    const local = fake({ localhost: ['::1', '127.0.0.1'] }, { 'http://localhost:3000/': ok() });
    expect(
      await checkAuditAddress('http://localhost:3000/', { netDeps: local.deps, allowPrivateAddresses: true })
    ).toEqual({ ok: true, finalUrl: 'http://localhost:3000/', status: 200 });

    const lan = fake({}, { 'http://192.168.1.20:8080/': ok() });
    expect(
      await checkAuditAddress('http://192.168.1.20:8080/', { netDeps: lan.deps, allowPrivateAddresses: true })
    ).toMatchObject({ ok: true, status: 200 });

    // The same address without the runner's permission is refused before any request.
    const refused = fake({ localhost: ['::1', '127.0.0.1'] }, { 'http://localhost:3000/': ok() });
    expect(await checkAuditAddress('http://localhost:3000/', { netDeps: refused.deps })).toMatchObject({
      ok: false,
      code: 'ERR_PRIVATE_ADDRESS',
    });
    expect(refused.connects).toHaveLength(0);
  });

  it('refuses a mixed answer and literal private addresses and localhost', async () => {
    const mixed = fake({ 'mixed.test': ['8.8.8.8', '10.0.0.1'] }, { 'https://mixed.test/': ok() });
    expect(await checkAuditAddress('https://mixed.test/', { netDeps: mixed.deps })).toMatchObject({
      code: 'ERR_PRIVATE_ADDRESS',
    });
    for (const url of ['http://127.0.0.1:3000/', 'http://[::1]/', 'http://localhost/', 'http://169.254.169.254/']) {
      const net = fake({ localhost: ['127.0.0.1'] }, { [url]: ok() });
      expect(await checkAuditAddress(url, { netDeps: net.deps })).toMatchObject({ code: 'ERR_PRIVATE_ADDRESS' });
      expect(net.connects).toHaveLength(0);
    }
    expect(mixed.connects).toHaveLength(0);
  });

  it('refuses a redirect hop to a private address and never connects to it (Q-22)', async () => {
    const net = fake(
      { 'site.test': PUBLIC, 'internal.test': ['10.0.0.9'] },
      { 'https://site.test/': redirect('http://internal.test/admin'), 'http://internal.test/admin': ok() }
    );
    const res = await checkAuditAddress('https://site.test/', { netDeps: net.deps });
    expect(res).toMatchObject({ ok: false, code: 'ERR_PRIVATE_ADDRESS' });
    expect(net.connects.map((c) => c.url.toString())).toEqual(['https://site.test/']);
    expect(net.connects.every((c) => c.address === PUBLIC[0])).toBe(true);
  });

  it('a redirect to a literal loopback address is refused before connecting', async () => {
    const net = fake({ 'site.test': PUBLIC }, { 'https://site.test/': redirect('http://127.0.0.1:8080/') });
    expect(await checkAuditAddress('https://site.test/', { netDeps: net.deps })).toMatchObject({
      code: 'ERR_PRIVATE_ADDRESS',
    });
    expect(net.connects).toHaveLength(1);
  });

  it('reports a name that does not resolve as unreachable (AC-2)', async () => {
    const net = fake({}, {});
    const res = await checkAuditAddress('https://nowhere.test/', { netDeps: net.deps });
    expect(res).toEqual({ ok: false, code: 'ERR_UNREACHABLE', reason: expect.stringMatching(/could not be found/) });
    const empty = fake({ 'empty.test': [] }, {});
    expect(await checkAuditAddress('https://empty.test/', { netDeps: empty.deps })).toMatchObject({
      code: 'ERR_UNREACHABLE',
    });
  });

  it('reports 400 and above as unreachable with the status (AC-2)', async () => {
    for (const status of [400, 404, 500, 503]) {
      const net = fake({ 'site.test': PUBLIC }, { 'https://site.test/': ok(status) });
      const res = await checkAuditAddress('https://site.test/', { netDeps: net.deps });
      expect(res).toEqual({ ok: false, code: 'ERR_UNREACHABLE', reason: `The site answered with error ${status}.` });
    }
  });

  it('a 399 is still reachable (boundary)', async () => {
    const net = fake({ 'site.test': PUBLIC }, { 'https://site.test/': ok(399) });
    expect(await checkAuditAddress('https://site.test/', { netDeps: net.deps })).toMatchObject({
      ok: true,
      status: 399,
    });
  });

  it('a final 4xx after a redirect is unreachable', async () => {
    const net = fake(
      { 'site.test': PUBLIC },
      { 'https://site.test/': redirect('/gone'), 'https://site.test/gone': ok(410) }
    );
    expect(await checkAuditAddress('https://site.test/', { netDeps: net.deps })).toMatchObject({
      code: 'ERR_UNREACHABLE',
      reason: 'The site answered with error 410.',
    });
  });

  it('reports a host that does not answer within the timeout as unreachable (AC-2)', async () => {
    const net = fake({ 'slow.test': PUBLIC }, { 'https://slow.test/': () => new Promise<RawResponse>(() => {}) });
    const started = Date.now();
    const res = await checkAuditAddress('https://slow.test/', { netDeps: net.deps, timeoutMs: 50 });
    expect(res).toEqual({ ok: false, code: 'ERR_UNREACHABLE', reason: 'The site did not answer in time.' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('a slow DNS lookup counts against the same timeout', async () => {
    const deps: NetDeps = {
      lookup: () => new Promise<string[]>(() => {}),
      connect: async () => ok(),
    };
    expect(await checkAuditAddress('https://slow-dns.test/', { netDeps: deps, timeoutMs: 50 })).toEqual({
      ok: false,
      code: 'ERR_UNREACHABLE',
      reason: 'The site did not answer in time.',
    });
  });

  it('passes the time left as the per-hop connect timeout', async () => {
    const net = fake({ 'site.test': PUBLIC }, { 'https://site.test/': ok() });
    await checkAuditAddress('https://site.test/', { netDeps: net.deps, timeoutMs: 3000 });
    expect(net.connects[0].timeoutMs).toBeGreaterThan(0);
    expect(net.connects[0].timeoutMs).toBeLessThanOrEqual(3000);
  });

  it('a connect timeout from the transport is unreachable in time', async () => {
    const net = fake({ 'site.test': PUBLIC }, { 'https://site.test/': new Error('timeout') });
    expect(await checkAuditAddress('https://site.test/', { netDeps: net.deps })).toMatchObject({
      code: 'ERR_UNREACHABLE',
      reason: 'The site did not answer in time.',
    });
  });

  it('a refused connection is unreachable', async () => {
    const net = fake({ 'site.test': PUBLIC }, {});
    expect(await checkAuditAddress('https://site.test/', { netDeps: net.deps })).toEqual({
      ok: false,
      code: 'ERR_UNREACHABLE',
      reason: 'The site could not be reached.',
    });
  });

  it('a response cut at the byte cap with a status below 400 counts as reachable', async () => {
    const net = fake(
      { 'site.test': PUBLIC },
      {
        'https://site.test/': redirect('/big'),
        'https://site.test/big': { status: 200, headers: {}, body: '', tooLarge: true },
      }
    );
    expect(await checkAuditAddress('https://site.test/', { netDeps: net.deps })).toEqual({
      ok: true,
      finalUrl: 'https://site.test/big',
      status: 200,
    });
  });

  it('a response cut at the byte cap with 400 or above is unreachable', async () => {
    const net = fake(
      { 'site.test': PUBLIC },
      { 'https://site.test/': { status: 500, headers: {}, body: '', tooLarge: true } }
    );
    expect(await checkAuditAddress('https://site.test/', { netDeps: net.deps })).toMatchObject({
      code: 'ERR_UNREACHABLE',
      reason: 'The site answered with error 500.',
    });
  });

  it('too many redirects is unreachable', async () => {
    const net = fake(
      { 'site.test': PUBLIC },
      { 'https://site.test/a': redirect('/b'), 'https://site.test/b': redirect('/a') }
    );
    expect(await checkAuditAddress('https://site.test/a', { netDeps: net.deps })).toMatchObject({
      code: 'ERR_UNREACHABLE',
      reason: 'The site redirected too many times.',
    });
  });

  it('non-web schemes and malformed input are refused without a request', async () => {
    const net = fake({ 'site.test': PUBLIC }, {});
    for (const url of ['ftp://site.test/', 'file:///etc/passwd', 'not a url', '']) {
      expect(await checkAuditAddress(url, { netDeps: net.deps })).toMatchObject({ ok: false, code: 'ERR_UNREACHABLE' });
    }
    expect(net.connects).toHaveLength(0);
  });

  it('messages carry no internals (addresses, error codes)', async () => {
    const cases: [string, ReturnType<typeof fake>][] = [
      ['https://a.test/', fake({}, {})],
      ['https://b.test/', fake({ 'b.test': PUBLIC }, {})],
      ['https://c.test/', fake({ 'c.test': ['10.0.0.1'] }, {})],
      ['https://d.test/', fake({ 'd.test': ['169.254.169.254'] }, {})],
    ];
    for (const [url, net] of cases) {
      const res = await checkAuditAddress(url, { netDeps: net.deps });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).not.toMatch(INTERNALS);
    }
  });
});
