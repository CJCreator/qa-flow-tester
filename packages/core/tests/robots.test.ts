import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { RobotsPolicy, MAX_CRAWL_DELAY_MS } from '../src/competitive/robots.js';
import { makeOutboundFetch, type NetDeps, type PinnedRequest, type RawResponse } from '../src/safe-net.js';
import { setBrowserPolicy } from '../src/browser.js';

const outboundOptions: Array<{ allowPrivate?: boolean } | undefined> = [];
let stubOutbound = false;
vi.mock('../src/safe-net.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/safe-net.js')>();
  return {
    ...actual,
    makeOutboundFetch: (opts?: Parameters<typeof actual.makeOutboundFetch>[0]) => {
      outboundOptions.push(opts);
      if (stubOutbound) return async () => null; // no real network
      return actual.makeOutboundFetch(opts);
    },
  };
});

const UA = 'QA-Benchmarking-Bot';

describe('RobotsPolicy', () => {
  it('allows everything when there are no rules', () => {
    expect(RobotsPolicy.parse('', UA).isAllowed('/pricing')).toBe(true);
    expect(RobotsPolicy.allowAll().isAllowed('/anything')).toBe(true);
  });

  it('applies the wildcard group when no group names our bot', () => {
    const policy = RobotsPolicy.parse('User-agent: *\nDisallow: /admin\n', UA);
    expect(policy.isAllowed('/admin/users')).toBe(false);
    expect(policy.isAllowed('/pricing')).toBe(true);
  });

  it('prefers a group naming our bot over the wildcard group', () => {
    const txt = ['User-agent: *', 'Disallow: /', '', 'User-agent: qa-benchmarking-bot', 'Disallow: /private'].join(
      '\n'
    );
    const policy = RobotsPolicy.parse(txt, UA);
    expect(policy.isAllowed('/pricing')).toBe(true);
    expect(policy.isAllowed('/private/x')).toBe(false);
  });

  it('lets the longest matching rule win, with Allow winning ties', () => {
    const policy = RobotsPolicy.parse('User-agent: *\nDisallow: /docs\nAllow: /docs/public\n', UA);
    expect(policy.isAllowed('/docs/internal')).toBe(false);
    expect(policy.isAllowed('/docs/public/intro')).toBe(true);
  });

  it('supports * and $ wildcards', () => {
    const policy = RobotsPolicy.parse('User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?session=\n', UA);
    expect(policy.isAllowed('/files/guide.pdf')).toBe(false);
    expect(policy.isAllowed('/files/guide.pdf.html')).toBe(true);
    expect(policy.isAllowed('/cart?session=abc')).toBe(false);
  });

  it('treats an empty Disallow as allow-all and ignores comments', () => {
    const policy = RobotsPolicy.parse('User-agent: * # everyone\nDisallow:\n', UA);
    expect(policy.isAllowed('/')).toBe(true);
  });
});

describe('RobotsPolicy Crawl-delay (REQ-035)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.QA_DEBUG;
  });

  it('is undefined when the file sets none', () => {
    expect(RobotsPolicy.parse('User-agent: *\nDisallow: /private\n', UA).crawlDelayMs).toBeUndefined();
    expect(RobotsPolicy.allowAll().crawlDelayMs).toBeUndefined();
  });

  it('reads the wildcard group in seconds, as milliseconds', () => {
    expect(RobotsPolicy.parse('User-agent: *\nDisallow: /private\nCrawl-delay: 1\n', UA).crawlDelayMs).toBe(1000);
    expect(RobotsPolicy.parse('User-agent: *\ncrawl-delay: 0.5\n', UA).crawlDelayMs).toBe(500);
    expect(RobotsPolicy.parse('User-agent: *\nCrawl-delay: 0\n', UA).crawlDelayMs).toBe(0);
  });

  it('takes the group naming our bot over the wildcard group', () => {
    const txt = ['User-agent: *', 'Crawl-delay: 10', '', 'User-agent: qa-benchmarking-bot', 'Crawl-delay: 2'].join(
      '\n'
    );
    expect(RobotsPolicy.parse(txt, UA).crawlDelayMs).toBe(2000);
  });

  it('uses no delay when our group sets none, even if the wildcard group does', () => {
    const txt = ['User-agent: *', 'Crawl-delay: 10', '', 'User-agent: qa-benchmarking-bot', 'Disallow: /x'].join('\n');
    expect(RobotsPolicy.parse(txt, UA).crawlDelayMs).toBeUndefined();
  });

  it('ignores a delay set for another bot', () => {
    expect(RobotsPolicy.parse('User-agent: otherbot\nCrawl-delay: 5\n', UA).crawlDelayMs).toBeUndefined();
  });

  it('ignores malformed and negative values, keeping a valid one', () => {
    for (const bad of ['soon', '-1', '', '1e3', 'Infinity', 'NaN', '1s', '0x10']) {
      expect(RobotsPolicy.parse(`User-agent: *\nCrawl-delay: ${bad}\n`, UA).crawlDelayMs).toBeUndefined();
    }
    expect(RobotsPolicy.parse('User-agent: *\nCrawl-delay: soon\nCrawl-delay: 3\n', UA).crawlDelayMs).toBe(3000);
  });

  it('caps a very long delay at 30 s and logs it', () => {
    process.env.QA_DEBUG = 'crawl';
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')));
    expect(RobotsPolicy.parse('User-agent: *\nCrawl-delay: 3600\n', UA).crawlDelayMs).toBe(MAX_CRAWL_DELAY_MS);
    expect(MAX_CRAWL_DELAY_MS).toBe(30_000);
    expect(logs.some((l) => l.includes('Crawl-delay capped'))).toBe(true);
    expect(RobotsPolicy.parse('User-agent: *\nCrawl-delay: 30\n', UA).crawlDelayMs).toBe(30_000);
  });
});

describe('RobotsPolicy.fetch (ADR 0031: pinned outbound path)', () => {
  afterEach(() => setBrowserPolicy(null));

  function net(address: string, robots: RawResponse | Error) {
    const connects: PinnedRequest[] = [];
    const deps: NetDeps = {
      lookup: async () => [address],
      connect: async (req) => {
        connects.push(req);
        if (robots instanceof Error) throw robots;
        return robots;
      },
    };
    return { deps, connects };
  }

  it('reads <origin>/robots.txt through the given FetchFn', async () => {
    const asked: string[] = [];
    const policy = await RobotsPolicy.fetch('https://shop.test', UA, async (url) => {
      asked.push(url);
      return { status: 200, headers: {}, text: async () => 'User-agent: *\nDisallow: /admin\n' };
    });
    expect(asked).toEqual(['https://shop.test/robots.txt']);
    expect(policy.isAllowed('/admin/x')).toBe(false);
  });

  it('a missing, refused or unreachable robots.txt means allow all', async () => {
    const notFound = await RobotsPolicy.fetch('https://shop.test', UA, async () => ({
      status: 404,
      headers: {},
      text: async () => 'User-agent: *\nDisallow: /\n',
    }));
    expect(notFound.isAllowed('/x')).toBe(true);
    expect((await RobotsPolicy.fetch('https://shop.test', UA, async () => null)).isAllowed('/x')).toBe(true);
    const down = net('93.184.216.34', new Error('ECONNREFUSED'));
    const unreachable = await RobotsPolicy.fetch('https://shop.test', UA, makeOutboundFetch({ deps: down.deps }));
    expect(unreachable.isAllowed('/x')).toBe(true);
  });

  it('AC-1: with a browser guard set, a host resolving to 169.254.169.254 is never connected to', async () => {
    setBrowserPolicy({ guard: async () => true });
    const n = net('169.254.169.254', { status: 200, headers: {}, body: 'User-agent: *\nDisallow: /\n' });
    const policy = await RobotsPolicy.fetch('http://meta.test', UA, makeOutboundFetch({ deps: n.deps }));
    expect(policy.isAllowed('/x')).toBe(true);
    expect(n.connects).toHaveLength(0);
  });

  it('the default fetch is public only even with no browser guard (callers use it for sites not on this machine)', async () => {
    // A literal private address needs no lookup, so the default network is never touched.
    const policy = await RobotsPolicy.fetch('http://127.0.0.1:9', UA);
    expect(policy.isAllowed('/anything')).toBe(true);
  });

  it("the default fetch reads the robots.txt of a local origin (the user's own build)", async () => {
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/plain');
      res.end(req.url === '/robots.txt' ? 'User-agent: *\nDisallow: /private/admin\n' : 'nope');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const { port } = server.address() as AddressInfo;
      for (const host of ['127.0.0.1', 'localhost']) {
        const policy = await RobotsPolicy.fetch(`http://${host}:${port}`, UA);
        expect(policy.isAllowed('/private/admin/x')).toBe(false);
        expect(policy.isAllowed('/pricing')).toBe(true);
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('a local origin is still refused on a shared machine (browser guard set)', async () => {
    const server = http.createServer((_req, res) => res.end('User-agent: *\nDisallow: /\n'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      setBrowserPolicy({ guard: async () => true });
      const { port } = server.address() as AddressInfo;
      const policy = await RobotsPolicy.fetch(`http://127.0.0.1:${port}`, UA);
      expect(policy.isAllowed('/x')).toBe(true);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it('the default fetch for a public origin keeps allowPrivate false; a local origin gets true', async () => {
    outboundOptions.length = 0;
    stubOutbound = true;
    try {
      await RobotsPolicy.fetch('https://shop.test', UA);
      await RobotsPolicy.fetch('http://192.168.1.20:3000', UA);
      await RobotsPolicy.fetch('http://93.184.216.34', UA);
    } finally {
      stubOutbound = false;
    }
    expect(outboundOptions.map((o) => o?.allowPrivate)).toEqual([false, true, false]);
    // A caller-supplied fetch (the Website Audit crawl) builds no default fetch at all.
    outboundOptions.length = 0;
    await RobotsPolicy.fetch('http://127.0.0.1:9', UA, async () => null);
    expect(outboundOptions).toHaveLength(0);
  });

  it('a public host is read pinned to its checked address', async () => {
    const n = net('93.184.216.34', { status: 200, headers: {}, body: 'User-agent: *\nDisallow: /private\n' });
    const policy = await RobotsPolicy.fetch('https://shop.test', UA, makeOutboundFetch({ deps: n.deps }));
    expect(policy.isAllowed('/private/a')).toBe(false);
    expect(n.connects).toHaveLength(1);
    expect(n.connects[0].address).toBe('93.184.216.34');
    expect(n.connects[0].url.toString()).toBe('https://shop.test/robots.txt');
  });
});
