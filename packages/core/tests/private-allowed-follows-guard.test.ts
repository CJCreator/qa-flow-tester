import { describe, it, expect, afterEach } from 'vitest';
import {
  GuardedFetchBlockedError,
  makeGuardedFetch,
  makeOutboundFetch,
  privateAddressesAllowed,
  type NetDeps,
  type PinnedRequest,
  type RawResponse,
} from '../src/safe-net.js';
import { setBrowserPolicy } from '../src/browser.js';

function fakeNet(addresses: string[] = ['127.0.0.1']) {
  const connects: PinnedRequest[] = [];
  const deps: NetDeps = {
    lookup: async () => addresses,
    connect: async (req: PinnedRequest): Promise<RawResponse> => {
      connects.push(req);
      return { status: 200, headers: {}, body: 'ok' };
    },
  };
  return { deps, connects };
}

afterEach(() => {
  setBrowserPolicy(null);
});

describe('privateAddressesAllowed follows the guard', () => {
  it('undefined and true with no policy -> true, false -> false', () => {
    expect(privateAddressesAllowed(undefined)).toBe(true);
    expect(privateAddressesAllowed(true)).toBe(true);
    expect(privateAddressesAllowed(false)).toBe(false);
  });

  it('with pinned policy -> true', () => {
    setBrowserPolicy({ pinned: { 'app.test': '127.0.0.1' } });
    expect(privateAddressesAllowed(undefined)).toBe(true);
    expect(privateAddressesAllowed(true)).toBe(true);
    expect(privateAddressesAllowed(false)).toBe(false);
  });

  it('with guard policy -> false', () => {
    setBrowserPolicy({ guard: async () => true });
    expect(privateAddressesAllowed(undefined)).toBe(false);
    expect(privateAddressesAllowed(true)).toBe(false);
    expect(privateAddressesAllowed(false)).toBe(false);
  });
});

describe('makeOutboundFetch follows the guard', () => {
  it('with only a pin set: one connect to 127.0.0.1, a response with status 200', async () => {
    const { deps, connects } = fakeNet(['127.0.0.1']);
    setBrowserPolicy({ pinned: { 'app.test': '127.0.0.1' } });
    const fetch = makeOutboundFetch({ deps });
    const res = await fetch('http://app.test/');
    expect(connects).toHaveLength(1);
    expect(connects[0].address).toBe('127.0.0.1');
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
  });

  it('with a guard set: no connect, the result is null', async () => {
    const { deps, connects } = fakeNet(['127.0.0.1']);
    setBrowserPolicy({ guard: async () => true });
    const fetch = makeOutboundFetch({ deps });
    const res = await fetch('http://app.test/');
    expect(connects).toHaveLength(0);
    expect(res).toBeNull();
  });
});

describe('makeGuardedFetch follows the guard', () => {
  it('with only a pin set: answers 200', async () => {
    const { deps, connects } = fakeNet(['127.0.0.1']);
    setBrowserPolicy({ pinned: { 'app.test': '127.0.0.1' } });
    const fetch = makeGuardedFetch({ deps });
    const res = await fetch('http://app.test/');
    expect(connects).toHaveLength(1);
    expect(connects[0].address).toBe('127.0.0.1');
    expect(res.status).toBe(200);
  });

  it('with a guard set: rejects with GuardedFetchBlockedError', async () => {
    const { deps, connects } = fakeNet(['127.0.0.1']);
    setBrowserPolicy({ guard: async () => true });
    const fetch = makeGuardedFetch({ deps });
    await expect(fetch('http://app.test/')).rejects.toThrow(GuardedFetchBlockedError);
    expect(connects).toHaveLength(0);
  });
});
