/**
 * The shared-machine request guard in the browser (ADR 0014): every request is checked afresh, a
 * redirected request is checked the same way, and the guard only ever adds a refusal.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import type { BrowserContext } from 'playwright';
import { BrowserManager, installRequestGuard, setBrowserPolicy, getBrowserPolicy } from '../src/browser.js';
import { blockChanges } from '../src/live-site.js';
import { makeRequestGuard, type NetDeps } from '../src/safe-net.js';

type Handler = (route: FakeRoute) => Promise<unknown> | unknown;

interface FakeRoute {
  request(): { url(): string; redirectedFrom(): unknown; method(): string };
  abort(reason?: string): Promise<void>;
  fallback(): Promise<void>;
  continue(): Promise<void>;
}

/** A browser context that only records the routes it was given; later routes run first, as in Playwright. */
function fakeContext() {
  const handlers: Handler[] = [];
  const context = {
    route: async (_pattern: string, handler: Handler) => {
      handlers.push(handler);
    },
  } as unknown as BrowserContext;
  /** Sends a request through the routes, latest first, and says how it ended. */
  async function send(url: string, opts: { redirected?: boolean; method?: string } = {}) {
    const outcome = { aborted: false, continued: false };
    let index = handlers.length - 1;
    const route: FakeRoute = {
      request: () => ({
        url: () => url,
        redirectedFrom: () => (opts.redirected ? {} : null),
        method: () => opts.method ?? 'GET',
      }),
      abort: async () => {
        outcome.aborted = true;
      },
      continue: async () => {
        outcome.continued = true;
      },
      fallback: async () => {
        index--;
        if (index < 0) outcome.continued = true;
        else await handlers[index](route);
      },
    };
    await handlers[index](route);
    return outcome;
  }
  return { context, send };
}

function fakeLookup(answers: Record<string, string[][]>) {
  const counts: Record<string, number> = {};
  const calls: string[] = [];
  const deps: NetDeps = {
    lookup: async (host) => {
      calls.push(host);
      const list = answers[host];
      if (!list) throw new Error('ENOTFOUND');
      const n = (counts[host] = (counts[host] ?? 0) + 1);
      return list[Math.min(n, list.length) - 1];
    },
    connect: async () => {
      throw new Error('not used');
    },
  };
  return { deps, calls };
}

afterEach(() => setBrowserPolicy(null));

describe('the shared-machine request guard (isTestHost, rebinding and redirects)', () => {
  it('request guard checks every request afresh', async () => {
    const { deps, calls } = fakeLookup({ 'rebind.test': [['8.8.8.8'], ['127.0.0.1']] });
    const { context, send } = fakeContext();
    await installRequestGuard(context, makeRequestGuard(deps));
    expect(await send('https://rebind.test/a')).toEqual({ aborted: false, continued: true });
    expect(await send('https://rebind.test/b')).toEqual({ aborted: true, continued: false });
    expect(calls).toEqual(['rebind.test', 'rebind.test']);
  });

  it('a redirected request to a private address is aborted', async () => {
    const { deps } = fakeLookup({ 'internal.test': [['169.254.169.254']], 'ok.test': [['8.8.8.8']] });
    const { context, send } = fakeContext();
    await installRequestGuard(context, makeRequestGuard(deps));
    expect((await send('http://internal.test/latest/meta-data', { redirected: true })).aborted).toBe(true);
    expect((await send('http://127.0.0.1:3000/', { redirected: true })).aborted).toBe(true);
    expect((await send('https://ok.test/', { redirected: true })).continued).toBe(true);
  });

  it('a guard that throws aborts the request (fail closed)', async () => {
    const { context, send } = fakeContext();
    await installRequestGuard(context, async () => {
      throw new Error('boom');
    });
    expect((await send('https://ok.test/')).aborted).toBe(true);
  });

  it('the guard does not widen confinement: it never consults an allowed host list, only refuses', async () => {
    const { deps } = fakeLookup({ 'other.test': [['8.8.8.8']] });
    const guard = makeRequestGuard(deps);
    // Confinement lives in same-site checks; the guard has no allow-list parameter at all.
    expect(guard.length).toBeLessThanOrEqual(2);
    expect(await guard('https://other.test/', false)).toBe(true); // passes the guard, confinement decides elsewhere
    expect(await guard('https://localhost/', false)).toBe(false);
  });

  it('blockChanges still aborts POST, PUT, PATCH and DELETE when the shared-machine guard is also installed', async () => {
    const { deps } = fakeLookup({ 'ok.test': [['8.8.8.8']], 'bad.test': [['10.0.0.1']] });
    for (const order of ['guard-first', 'block-first'] as const) {
      const { context, send } = fakeContext();
      if (order === 'guard-first') {
        await installRequestGuard(context, makeRequestGuard(deps));
        await blockChanges(context);
      } else {
        await blockChanges(context);
        await installRequestGuard(context, makeRequestGuard(deps));
      }
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect((await send('https://ok.test/save', { method })).aborted, `${order} ${method}`).toBe(true);
      }
      expect(await send('https://ok.test/page', { method: 'GET' }), order).toEqual({ aborted: false, continued: true });
      // A private address is refused even for a GET: the guard still runs when blockChanges lets it by.
      expect((await send('https://bad.test/', { method: 'GET' })).aborted, order).toBe(true);
    }
  });
});

describe('the guard in a real browser (needs Chromium)', () => {
  let server: http.Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function listen(): Promise<number> {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><h1>fixture</h1></body></html>');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    return (server.address() as AddressInfo).port;
  }

  it('with the shared-machine policy a page on loopback is blocked; with no policy it loads', async () => {
    const port = await listen();
    const url = `http://127.0.0.1:${port}/`;

    expect(getBrowserPolicy()).toBeNull();
    const open = new BrowserManager();
    try {
      const { page } = await open.openPage();
      await page.goto(url, { timeout: 8000 });
      expect(await page.textContent('h1')).toBe('fixture');
    } finally {
      await open.close();
    }

    setBrowserPolicy({ guard: makeRequestGuard({ lookup: async () => ['8.8.8.8'] }) });
    const guarded = new BrowserManager();
    try {
      const { page } = await guarded.openPage();
      await expect(page.goto(url, { timeout: 8000 })).rejects.toThrow();
    } finally {
      await guarded.close();
    }
  }, 60_000);
});
