import { describe, it, expect, vi } from 'vitest';
import { runAccessChecks, guardedFetcher, type GuardedFetch } from '../src/access-control.js';

const TARGET = 'https://app.example.com';
const page = { urlPath: '/dashboard', reachedBy: ['alice'] };
const signedInOk = async () => ({ status: 200, location: undefined, body: '<main>Dashboard</main>' });

function fakeFetch(status: number, body: string): GuardedFetch {
  return async () => ({ status, headers: {}, text: async () => body });
}

describe('guardedFetcher', () => {
  it('skips the request when no fetchFn is injected', async () => {
    expect(await guardedFetcher()('https://app.example.com/dashboard')).toBeUndefined();
  });

  it('maps the pinned response to status, location and body', async () => {
    const fetchFn = vi.fn(async (_url: string) => ({
      status: 302,
      headers: { location: '/login' },
      text: async () => 'moved',
    }));
    const out = await guardedFetcher(fetchFn)('https://app.example.com/dashboard');
    expect(fetchFn).toHaveBeenCalledWith('https://app.example.com/dashboard');
    expect(out).toEqual({ status: 302, location: '/login', body: 'moved' });
  });

  it('returns undefined when the guarded request is refused or fails', async () => {
    const refused = async () => null;
    expect(await guardedFetcher(refused)('https://app.example.com/dashboard')).toBeUndefined();
  });
});

describe('runAccessChecks with the guarded signed-out request', () => {
  it('flags an open page when the guarded request gets the content', async () => {
    const out = await runAccessChecks({
      targetUrl: TARGET,
      pages: [page],
      signedOut: guardedFetcher(fakeFetch(200, '<main>Dashboard</main>')),
      roles: { alice: signedInOk },
      markers: {},
    });
    expect(out.findings.map((f) => f.id)).toEqual(['F-ACCESS-OPEN-_dashboard']);
  });

  it('reports nothing when no fetchFn is injected, so no direct request is made', async () => {
    const out = await runAccessChecks({
      targetUrl: TARGET,
      pages: [page],
      signedOut: guardedFetcher(),
      roles: { alice: signedInOk },
      markers: {},
    });
    expect(out.findings).toEqual([]);
  });
});
