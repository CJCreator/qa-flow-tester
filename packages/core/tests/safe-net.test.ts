import { describe, it, expect } from 'vitest';
import {
  makeRequestGuard,
  resolvePublic,
  safeGet,
  verifyDomainProof,
  type NetDeps,
  type PinnedRequest,
  type RawResponse,
} from '../src/safe-net.js';

/** A fake network: names map to answers (a list per lookup, so a name can change its answer). */
function fake(
  names: Record<string, string[] | string[][] | Error>,
  responses: Record<string, RawResponse | Error | ((r: PinnedRequest) => RawResponse)>
) {
  const lookups: string[] = [];
  const connects: PinnedRequest[] = [];
  const counts: Record<string, number> = {};
  const deps: NetDeps = {
    async lookup(host) {
      lookups.push(host);
      const answer = names[host];
      if (answer === undefined) throw new Error('ENOTFOUND');
      if (answer instanceof Error) throw answer;
      if (Array.isArray(answer[0])) {
        const n = (counts[host] = (counts[host] ?? 0) + 1);
        const list = answer as string[][];
        return list[Math.min(n, list.length) - 1];
      }
      return answer as string[];
    },
    async connect(req) {
      connects.push(req);
      const r = responses[req.url.toString()];
      if (r === undefined) throw new Error('refused');
      if (r instanceof Error) throw r;
      return typeof r === 'function' ? r(req) : r;
    },
  };
  return { deps, lookups, connects };
}

const ok = (body = '', status = 200): RawResponse => ({ status, headers: {}, body });
const redirect = (to: string, status = 302): RawResponse => ({ status, headers: { location: to }, body: '' });

describe('resolvePublic', () => {
  it('isTestHost fails closed on a mixed, empty, failed or slow lookup', async () => {
    const mixed = fake({ 'a.test': ['8.8.8.8', '10.0.0.1'] }, {});
    expect(await resolvePublic('a.test', mixed.deps)).toEqual({ ok: false, reason: 'private-address' });
    const empty = fake({ 'a.test': [] }, {});
    expect(await resolvePublic('a.test', empty.deps)).toEqual({ ok: false, reason: 'dns-failed' });
    const failed = fake({ 'a.test': new Error('SERVFAIL') }, {});
    expect(await resolvePublic('a.test', failed.deps)).toEqual({ ok: false, reason: 'dns-failed' });
    const slow = { lookup: () => Promise.reject(new Error('timeout')) };
    expect(await resolvePublic('a.test', slow)).toEqual({ ok: false, reason: 'dns-failed' });
    expect(await resolvePublic('', failed.deps)).toEqual({ ok: false, reason: 'dns-failed' });
  });

  it('accepts a name whose every address is public, preferring IPv4', async () => {
    const f = fake({ 'a.test': ['2606:4700:4700::1111', '93.184.216.34'] }, {});
    expect(await resolvePublic('a.test', f.deps)).toEqual({
      ok: true,
      address: '93.184.216.34',
      all: ['2606:4700:4700::1111', '93.184.216.34'],
    });
  });

  it('classifies a literal IP without a lookup, and refuses this machine’s names', async () => {
    const f = fake({}, {});
    expect(await resolvePublic('8.8.8.8', f.deps)).toMatchObject({ ok: true, address: '8.8.8.8' });
    expect(await resolvePublic('[::1]', f.deps)).toEqual({ ok: false, reason: 'private-address' });
    expect(await resolvePublic('127.0.0.1', f.deps)).toEqual({ ok: false, reason: 'private-address' });
    expect(await resolvePublic('localhost', f.deps)).toEqual({ ok: false, reason: 'private-address' });
    expect(f.lookups).toEqual([]);
  });
});

describe('safeGet', () => {
  it('isTestHost: a redirect to 169.254.169.254 is refused and never connected to', async () => {
    const f = fake(
      { 'good.test': ['93.184.216.34'], 'internal.test': ['169.254.169.254'] },
      { 'http://good.test/': redirect('http://internal.test/'), 'http://internal.test/': ok('SECRET') }
    );
    const got = await safeGet('http://good.test/', {}, f.deps);
    expect(got).toEqual({ ok: false, reason: 'private-address' });
    expect(f.connects).toHaveLength(1);
    expect(f.connects[0].url.hostname).toBe('good.test');
  });

  it('isTestHost: a redirect to a literal 127.0.0.1, [::1], a mapped address or a non-http scheme is refused', async () => {
    for (const [to, reason] of [
      ['http://127.0.0.1/', 'private-address'],
      ['http://[::1]/', 'private-address'],
      ['http://[::ffff:7f00:1]/', 'private-address'],
      ['http://localhost/', 'private-address'],
      ['file:///etc/passwd', 'bad-scheme'],
      ['ftp://good.test/', 'bad-scheme'],
    ] as const) {
      const f = fake({ 'good.test': ['93.184.216.34'] }, { 'http://good.test/': redirect(to) });
      expect(await safeGet('http://good.test/', {}, f.deps), to).toEqual({ ok: false, reason });
      expect(f.connects, to).toHaveLength(1);
    }
  });

  it('isTestHost: a redirect loop stops after 5 hops', async () => {
    const f = fake({ 'loop.test': ['93.184.216.34'] }, { 'http://loop.test/': redirect('http://loop.test/') });
    expect(await safeGet('http://loop.test/', {}, f.deps)).toEqual({ ok: false, reason: 'redirected' });
    expect(f.connects).toHaveLength(6); // the first request and 5 hops
  });

  it('follows a redirect to another public host and checks the new host afresh', async () => {
    const f = fake(
      { 'a.test': ['93.184.216.34'], 'b.test': ['8.8.8.8'] },
      { 'http://a.test/': redirect('http://b.test/x'), 'http://b.test/x': ok('hi') }
    );
    const got = await safeGet('http://a.test/', {}, f.deps);
    expect(got).toMatchObject({ ok: true, status: 200, finalUrl: 'http://b.test/x', body: 'hi' });
    expect(f.lookups).toEqual(['a.test', 'b.test']);
  });

  it('isTestHost: a name that turns private on the second lookup is refused', async () => {
    // First answer public, then private: the redirect back to the same name is a new hop with a new lookup.
    const f = fake(
      { 'rebind.test': [['93.184.216.34'], ['127.0.0.1']] },
      { 'http://rebind.test/': redirect('http://rebind.test/again') }
    );
    const got = await safeGet('http://rebind.test/', {}, f.deps);
    expect(got).toEqual({ ok: false, reason: 'private-address' });
    expect(f.lookups).toEqual(['rebind.test', 'rebind.test']);
    expect(f.connects).toHaveLength(1);
  });

  it('connects to the checked address, not the name, with one lookup per hop', async () => {
    const f = fake({ 'a.test': ['93.184.216.34'] }, { 'https://a.test/p?q=1': ok('x') });
    await safeGet('https://a.test/p?q=1', { headers: { 'X-One': '1' } }, f.deps);
    expect(f.lookups).toEqual(['a.test']);
    expect(f.connects[0].address).toBe('93.184.216.34');
    expect(f.connects[0].url.hostname).toBe('a.test');
    expect(f.connects[0].headers['X-One']).toBe('1');
  });

  it('refuses a literal private address and a non-http address before any connection', async () => {
    const f = fake({}, {});
    expect(await safeGet('http://10.0.0.1/', {}, f.deps)).toEqual({ ok: false, reason: 'private-address' });
    expect(await safeGet('http://[::ffff:a9fe:a9fe]/', {}, f.deps)).toEqual({ ok: false, reason: 'private-address' });
    expect(await safeGet('file:///etc/passwd', {}, f.deps)).toEqual({ ok: false, reason: 'bad-scheme' });
    expect(await safeGet('nonsense', {}, f.deps)).toEqual({ ok: false, reason: 'bad-scheme' });
    expect(f.connects).toHaveLength(0);
  });

  it('reports a timeout, a too-large body and a refused connection', async () => {
    const t = fake({ 'a.test': ['8.8.8.8'] }, { 'http://a.test/': new Error('timeout') });
    expect(await safeGet('http://a.test/', {}, t.deps)).toEqual({ ok: false, reason: 'timeout' });
    const big = fake(
      { 'a.test': ['8.8.8.8'] },
      { 'http://a.test/': { status: 200, headers: {}, body: '', tooLarge: true } }
    );
    expect(await safeGet('http://a.test/', {}, big.deps)).toMatchObject({
      ok: false,
      reason: 'too-large',
      status: 200,
    });
    const e = fake({ 'a.test': ['8.8.8.8'] }, {});
    expect(await safeGet('http://a.test/', {}, e.deps)).toEqual({ ok: false, reason: 'error' });
  });
});

describe('verifyDomainProof', () => {
  const PROOF = 'https://shop.example.com/.well-known/qa-verify.txt';
  const names = { 'shop.example.com': ['93.184.216.34'] };

  it('passes only for the exact line, fetched over https from the exact origin', async () => {
    const f = fake(names, { [PROOF]: ok('qa-verify=tok123\n') });
    expect(await verifyDomainProof('https://shop.example.com', 'tok123', f.deps)).toEqual({ ok: true });
    expect(f.connects[0].maxBytes).toBe(4096);
    expect(await verifyDomainProof('https://shop.example.com', 'wrong', f.deps)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('verifyDomainProof: 3xx is a failure, no redirect followed', async () => {
    const f = fake(names, {
      [PROOF]: redirect('https://shop.example.com/proof-here'),
      'https://shop.example.com/proof-here': ok('qa-verify=tok123'),
    });
    expect(await verifyDomainProof('https://shop.example.com', 'tok123', f.deps)).toEqual({
      ok: false,
      reason: 'redirected',
    });
    expect(f.connects).toHaveLength(1);
  });

  it('verifyDomainProof: private-resolving host refused', async () => {
    const f = fake({ 'shop.example.com': ['10.0.0.9'] }, { [PROOF]: ok('qa-verify=tok123') });
    expect(await verifyDomainProof('https://shop.example.com', 'tok123', f.deps)).toEqual({
      ok: false,
      reason: 'private-address',
    });
    expect(f.connects).toHaveLength(0);
  });

  it('verifyDomainProof: body over 4 KB refused', async () => {
    const f = fake(names, { [PROOF]: { status: 200, headers: {}, body: '', tooLarge: true } });
    expect(await verifyDomainProof('https://shop.example.com', 'tok123', f.deps)).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  it('verifyDomainProof: http origin refused (not-https), and no fetch is made', async () => {
    const f = fake(names, { 'http://shop.example.com/.well-known/qa-verify.txt': ok('qa-verify=tok123') });
    expect(await verifyDomainProof('http://shop.example.com', 'tok123', f.deps)).toEqual({
      ok: false,
      reason: 'not-https',
    });
    expect(f.connects).toHaveLength(0);
    expect(f.lookups).toHaveLength(0);
  });

  it('verifyDomainProof: shared-suffix host: a proof on a sibling or parent host does not verify this origin', async () => {
    const f = fake(
      { 'a.vercel.app': ['76.76.21.21'], 'b.vercel.app': ['76.76.21.22'] },
      { 'https://b.vercel.app/.well-known/qa-verify.txt': ok('qa-verify=tok123') }
    );
    expect(await verifyDomainProof('https://b.vercel.app', 'tok123', f.deps)).toEqual({ ok: true });
    expect(await verifyDomainProof('https://a.vercel.app', 'tok123', f.deps)).toEqual({
      ok: false,
      reason: 'not-found',
    });
    // The port is part of the exact origin.
    expect(await verifyDomainProof('https://b.vercel.app:8443', 'tok123', f.deps)).toMatchObject({ ok: false });
  });

  it('is not found on an error status or a missing file, and fails on a DNS error', async () => {
    const f = fake(names, { [PROOF]: ok('nope', 404) });
    expect(await verifyDomainProof('https://shop.example.com', 'tok123', f.deps)).toEqual({
      ok: false,
      reason: 'not-found',
    });
    const d = fake({}, {});
    expect(await verifyDomainProof('https://shop.example.com', 'tok123', d.deps)).toEqual({
      ok: false,
      reason: 'dns-failed',
    });
  });

  it('refuses IP literals and this machine’s names as a proof origin', async () => {
    const f = fake({}, {});
    for (const origin of [
      'https://8.8.8.8',
      'https://127.0.0.1',
      'https://localhost',
      'https://u:p@shop.example.com',
    ]) {
      expect(await verifyDomainProof(origin, 'tok', f.deps), origin).toMatchObject({ ok: false });
    }
    expect(f.connects).toHaveLength(0);
  });
});

describe('makeRequestGuard', () => {
  it('lets public hosts and non-network pages through, and refuses private ones', async () => {
    const f = fake({ 'a.test': ['8.8.8.8'], 'p.test': ['10.0.0.1'] }, {});
    const guard = makeRequestGuard(f.deps);
    expect(await guard('https://a.test/x', false)).toBe(true);
    expect(await guard('https://p.test/x', false)).toBe(false);
    expect(await guard('data:text/plain,hi', false)).toBe(true);
    expect(await guard('blob:https://a.test/1', false)).toBe(true);
    expect(await guard('about:blank', false)).toBe(true);
    expect(await guard('http://127.0.0.1:3000/', false)).toBe(false);
    expect(await guard('http://[::1]/', false)).toBe(false);
    expect(await guard('http://169.254.169.254/latest/meta-data', false)).toBe(false);
    expect(await guard('file:///etc/passwd', false)).toBe(false);
    expect(await guard('not a url', false)).toBe(false);
  });

  it('fails closed on a DNS error and does not cache an answer', async () => {
    const f = fake({ 'flip.test': [['8.8.8.8'], ['127.0.0.1'], []] }, {});
    const guard = makeRequestGuard(f.deps);
    expect(await guard('https://flip.test/', false)).toBe(true);
    expect(await guard('https://flip.test/', false)).toBe(false);
    expect(await guard('https://flip.test/', false)).toBe(false);
    expect(await guard('https://gone.test/', false)).toBe(false);
    expect(f.lookups.filter((h) => h === 'flip.test')).toHaveLength(3);
  });
});
