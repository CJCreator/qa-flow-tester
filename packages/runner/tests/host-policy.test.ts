/**
 * Whether an address is a Test Copy where the runner decides it (ADR 0014): local mode keeps the
 * text-only rule; a shared machine (beta) needs marked AND public AND a Verified Domain proof.
 */
import { describe, it, expect } from 'vitest';
import type { NetDeps, RawResponse } from '@qa/core';
import { testCopyFor } from '../src/host-policy.js';

const PROOF = 'https://preview.example.com/.well-known/qa-verify.txt';

function net(opts: { names?: Record<string, string[]>; files?: Record<string, RawResponse> } = {}) {
  const lookups: string[] = [];
  const connects: string[] = [];
  const deps: NetDeps = {
    lookup: async (host) => {
      lookups.push(host);
      const a = (opts.names ?? { 'preview.example.com': ['93.184.216.34'] })[host];
      if (!a) throw new Error('ENOTFOUND');
      return a;
    },
    connect: async (req) => {
      connects.push(req.url.toString());
      const r = (opts.files ?? {})[req.url.toString()];
      if (!r) throw new Error('refused');
      return r;
    },
  };
  return { deps, lookups, connects };
}

const file = (body: string): RawResponse => ({ status: 200, headers: {}, body });

function ask(over: Partial<Parameters<typeof testCopyFor>[0]>, deps?: NetDeps): Promise<boolean> {
  return testCopyFor({
    beta: true,
    hostname: 'preview.example.com',
    origin: 'https://preview.example.com',
    marked: true,
    token: () => 'tok',
    deps,
    ...over,
  });
}

describe('testCopyFor on a shared machine (isTestHost, ADR 0014)', () => {
  it('beta: marked + public + no proof -> not a test copy', async () => {
    const n = net({ files: {} });
    expect(await ask({}, n.deps)).toBe(false);
  });

  it('beta: marked + proof -> test copy', async () => {
    const n = net({ files: { [PROOF]: file('qa-verify=tok\n') } });
    expect(await ask({}, n.deps)).toBe(true);
  });

  it('beta: proof but not marked -> not a test copy, and no fetch is made', async () => {
    const n = net({ files: { [PROOF]: file('qa-verify=tok') } });
    expect(await ask({ marked: false }, n.deps)).toBe(false);
    expect(n.connects).toEqual([]);
  });

  it('beta: another session’s token or no token -> not a test copy', async () => {
    const n = net({ files: { [PROOF]: file('qa-verify=tok') } });
    expect(await ask({ token: () => 'someone-else' }, n.deps)).toBe(false);
    expect(await ask({ token: () => undefined }, n.deps)).toBe(false);
  });

  it('beta: a redirecting proof file or a private-resolving name -> not a test copy', async () => {
    const redirecting = net({
      files: { [PROOF]: { status: 302, headers: { location: 'https://preview.example.com/x' }, body: '' } },
    });
    expect(await ask({}, redirecting.deps)).toBe(false);
    const rebinding = net({
      names: { 'preview.example.com': ['93.184.216.34', '127.0.0.1'] },
      files: { [PROOF]: file('qa-verify=tok') },
    });
    expect(await ask({}, rebinding.deps)).toBe(false);
    expect(rebinding.connects).toEqual([]);
  });

  it('beta: devtunnels.ms name, localhost, private ranges and http origins are no longer a test copy', async () => {
    const n = net({
      names: { 'abc-3050.uks1.devtunnels.ms': ['20.50.1.1'] },
      files: { 'https://abc-3050.uks1.devtunnels.ms/.well-known/qa-verify.txt': file('qa-verify=tok') },
    });
    expect(
      await ask(
        { hostname: 'abc-3050.uks1.devtunnels.ms', origin: 'http://abc-3050.uks1.devtunnels.ms', marked: false },
        n.deps
      )
    ).toBe(false);
    for (const hostname of ['localhost', '127.0.0.1', '10.0.0.4', '192.168.1.5', 'host.docker.internal']) {
      expect(await ask({ hostname, origin: `https://${hostname}`, marked: false }, n.deps), hostname).toBe(false);
      expect(await ask({ hostname, origin: `https://${hostname}`, marked: true }, n.deps), hostname).toBe(false);
    }
  });

  it('beta: an http origin is not a test copy even when marked and public', async () => {
    const n = net({ files: { [PROOF]: file('qa-verify=tok') } });
    expect(await ask({ origin: 'http://preview.example.com' }, n.deps)).toBe(false);
    expect(n.connects).toEqual([]);
  });

  it('run on shared machine: owner + marked + unverified -> readOnly true; verified -> readOnly false', async () => {
    const decide = async (proofBody: string | null, owner: boolean) => {
      const n = net({ files: proofBody === null ? {} : { [PROOF]: file(proofBody) } });
      const testHost = await ask({}, n.deps);
      return !(owner && testHost); // the server's own rule for readOnly
    };
    expect(await decide(null, true)).toBe(true);
    expect(await decide('qa-verify=tok', true)).toBe(false);
    expect(await decide('qa-verify=tok', false)).toBe(true);
  });

  it('owner false -> readOnly; live host -> readOnly, on both modes', async () => {
    const n = net();
    const local = (hostname: string, marked = false) =>
      testCopyFor({
        beta: false,
        hostname,
        origin: `http://${hostname}`,
        marked,
        token: () => undefined,
        deps: n.deps,
      });
    const readOnlyFor = async (owner: boolean, host: string) => !(owner && (await local(host)));
    expect(await readOnlyFor(false, 'localhost')).toBe(true);
    expect(await readOnlyFor(true, 'www.example.com')).toBe(true);
    expect(await readOnlyFor(true, 'localhost')).toBe(false);
    expect(await ask({ marked: false }, n.deps)).toBe(false);
  });
});

describe('testCopyFor in local mode (isTestHost unchanged)', () => {
  it('local: localhost, 10.x, devtunnel and marked hosts are test copies exactly as before', async () => {
    const local = (hostname: string, marked = false) =>
      testCopyFor({ beta: false, hostname, origin: `http://${hostname}`, marked, token: () => undefined });
    for (const host of [
      'localhost',
      '127.0.0.1',
      '10.0.0.4',
      '192.168.1.20',
      'host.docker.internal',
      'abc-3050.uks1.devtunnels.ms',
    ]) {
      expect(await local(host), host).toBe(true);
    }
    expect(await local('www.example.com')).toBe(false);
    expect(await local('www.example.com', true)).toBe(true);
    expect(await local('172.32.0.1')).toBe(false);
  });

  it('local: no DNS lookup and no proof fetch is made', async () => {
    const n = net();
    for (const host of ['localhost', 'www.example.com', 'staging.example.com']) {
      await testCopyFor({
        beta: false,
        hostname: host,
        origin: `https://${host}`,
        marked: true,
        token: () => 'tok',
        deps: n.deps,
      });
    }
    expect(n.lookups).toEqual([]);
    expect(n.connects).toEqual([]);
  });
});
