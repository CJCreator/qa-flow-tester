import { describe, it, expect, vi, afterEach } from 'vitest';
import { GuardedFetchBlockedError, makeGuardedFetch, defaultNetDeps, type NetDeps, type PinnedRequest, type RawResponse } from '../src/safe-net.js';
import { setBrowserPolicy } from '../src/browser.js';
import { PreFlightChecker } from '../src/preflight.js';

const PUBLIC = '93.184.216.34';

/** Names map to addresses; any other name fails the lookup. */
function names(map: Record<string, string[]>): Pick<NetDeps, 'lookup'> {
  return {
    lookup: async (host: string): Promise<string[]> => {
      const answer = map[host];
      if (!answer) throw new Error('ENOTFOUND');
      return answer;
    },
  };
}

/** A pinned connect fake: records every request (URL and the address it was sent to), answers from a script keyed by URL. */
function fakeNet(map: Record<string, string[]>, script: Record<string, RawResponse> = {}) {
  const sent: Array<{ url: string; address: string }> = [];
  const connect = async (req: PinnedRequest): Promise<RawResponse> => {
    const url = req.url.toString();
    sent.push({ url, address: req.address });
    return script[url] ?? { status: 200, headers: {}, body: 'ok' };
  };
  return { deps: { ...names(map), connect }, sent };
}

function redirect(location: string, status = 302): RawResponse {
  return { status, headers: { location }, body: '' };
}

afterEach(() => {
  vi.restoreAllMocks();
  setBrowserPolicy(null);
});

describe('makeGuardedFetch (S1)', () => {
  it('sends a request to a public address, pinned to the checked address, and returns the response', async () => {
    const net = fakeNet({ 'a.test': [PUBLIC] });
    const f = makeGuardedFetch({ deps: net.deps });
    const res = await f('https://a.test/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(net.sent).toEqual([{ url: 'https://a.test/health', address: PUBLIC }]);
  });

  it('refuses a private literal and a name that resolves to a private address, sending nothing', async () => {
    const net = fakeNet({ 'meta.test': ['169.254.169.254'], 'mixed.test': [PUBLIC, '10.0.0.5'] });
    const f = makeGuardedFetch({ allowPrivate: false, deps: net.deps });
    await expect(f('http://127.0.0.1:9/')).rejects.toBeInstanceOf(GuardedFetchBlockedError);
    await expect(f('http://[::1]/')).rejects.toBeInstanceOf(GuardedFetchBlockedError);
    await expect(f('http://meta.test/latest/meta-data')).rejects.toBeInstanceOf(GuardedFetchBlockedError);
    await expect(f('http://mixed.test/')).rejects.toBeInstanceOf(GuardedFetchBlockedError);
    await expect(f('http://gone.test/')).rejects.toBeInstanceOf(GuardedFetchBlockedError);
    expect(net.sent).toEqual([]);
  });

  it('refuses a redirect to a private address and never sends the second hop', async () => {
    const net = fakeNet(
      { 'a.test': [PUBLIC] },
      { 'https://a.test/go': redirect('http://169.254.169.254/latest/meta-data') }
    );
    const f = makeGuardedFetch({ allowPrivate: false, deps: net.deps });
    await expect(f('https://a.test/go')).rejects.toBeInstanceOf(GuardedFetchBlockedError);
    expect(net.sent.map((s) => s.url)).toEqual(['https://a.test/go']);
  });

  it('follows a redirect to a public address, checking the target', async () => {
    const net = fakeNet(
      { 'a.test': [PUBLIC], 'b.test': [PUBLIC] },
      { 'https://a.test/old': redirect('https://b.test/new') }
    );
    const f = makeGuardedFetch({ deps: net.deps });
    const res = await f('https://a.test/old');
    expect(res.status).toBe(200);
    expect(net.sent.map((s) => s.url)).toEqual(['https://a.test/old', 'https://b.test/new']);
  });

  it('redirect: manual returns the 3xx itself, with its Location header, and sends no second hop', async () => {
    const net = fakeNet(
      { 'a.test': [PUBLIC] },
      { 'https://a.test/old': redirect('https://a.test/new') }
    );
    const f = makeGuardedFetch({ deps: net.deps });
    const res = await f('https://a.test/old', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://a.test/new');
    expect(net.sent.map((s) => s.url)).toEqual(['https://a.test/old']);
  });

  it('returns the last 3xx once the redirect limit is reached', async () => {
    const net = fakeNet({ 'a.test': [PUBLIC] }, { 'https://a.test/1': redirect('https://a.test/2') });
    const f = makeGuardedFetch({ deps: net.deps, maxRedirects: 0 });
    const res = await f('https://a.test/1');
    expect(res.status).toBe(302);
    expect(net.sent.map((s) => s.url)).toEqual(['https://a.test/1']);
  });

  it('allowPrivate (a local run) lets a loopback address through, but still refuses other schemes', async () => {
    const net = fakeNet({ 'localhost': ['127.0.0.1'] });
    const f = makeGuardedFetch({ allowPrivate: true, deps: net.deps });
    expect((await f('http://localhost:3000/')).status).toBe(200);
    await expect(f('file:///etc/passwd')).rejects.toBeInstanceOf(GuardedFetchBlockedError);
    expect(net.sent).toEqual([{ url: 'http://localhost:3000/', address: '127.0.0.1' }]);
  });

  it('a browser policy (shared machine) narrows allowPrivate to public only', async () => {
    const net = fakeNet({});
    setBrowserPolicy({ guard: async () => true });
    const f = makeGuardedFetch({ allowPrivate: true, deps: net.deps });
    await expect(f('http://127.0.0.1:3000/')).rejects.toBeInstanceOf(GuardedFetchBlockedError);
    expect(net.sent).toEqual([]);
  });

  it('uses no native fetch: the global fetch is never called', async () => {
    const nativeFetch = vi.fn(async () => new Response('x'));
    vi.stubGlobal('fetch', nativeFetch);
    const net = fakeNet({ 'a.test': [PUBLIC] });
    await makeGuardedFetch({ deps: net.deps })('https://a.test/');
    expect(nativeFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('an aborted signal rejects and sends nothing', async () => {
    const net = fakeNet({ 'a.test': [PUBLIC] });
    const ac = new AbortController();
    ac.abort();
    await expect(makeGuardedFetch({ deps: net.deps })('https://a.test/', { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(net.sent).toEqual([]);
  });
});

describe('PreFlightChecker.checkUrlReachable uses the guarded fetch (S1)', () => {
  it('reports a refused address as not reachable, without sending a request', async () => {
    const connect = vi.spyOn(defaultNetDeps, 'connect');
    setBrowserPolicy({ guard: async () => true });
    const check = await new PreFlightChecker().checkUrlReachable('http://127.0.0.1:9/');
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/not a public web address/);
    expect(connect).not.toHaveBeenCalled();
  });
});
