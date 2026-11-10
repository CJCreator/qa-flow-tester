/**
 * T-80 / ADR 0042 / ADR 0043:
 * - Start page 4xx/5xx handling in browser (ERR_UNREACHABLE vs ERR_SITE_BLOCKED)
 * - Typed errors: ERR_SITE_BLOCKED, ERR_DNS, ERR_BROWSER_LAUNCH
 * - Retries for 5xx, timeout, net error
 * - Outage resilience (3 net failures -> pause & probe -> resume or stoppedAnsweringAfter)
 * - Per-page progress events matching T-79 shape
 */
import { describe, it, expect } from 'vitest';
import type { ElementInventoryItem } from '@qa/types';
import type { BrowserContext, Page } from 'playwright';
import {
  runAuditCrawl,
  AuditCrawlRefusedError,
  AuditBrowserLaunchError,
  type AuditCrawlProgress,
} from '../src/audit/crawl/crawl.js';
import { AuditCrawlBlockedError } from '../src/audit/crawl/interstitial.js';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';
import { HostPacer } from '../src/host-pacer.js';

interface MockRoute {
  status?: number;
  title?: string;
  text?: string;
  textFn?: () => string;
  elements?: ElementInventoryItem[];
  error?: Error;
  waitForFunction?: () => Promise<void>;
}

function makeMockBrowser(routes: Record<string, MockRoute | ((attempt: number) => MockRoute)>) {
  const attempts = new Map<string, number>();

  const createPage = (): Page => {
    let currentUrl = 'about:blank';
    let currentRoute: MockRoute = { status: 200, title: '', text: '' };

    const page = {
      isClosed: () => false,
      close: async () => {},
      url: () => currentUrl,
      title: async () => currentRoute.title ?? '',
      evaluate: async (fn: any, arg?: any) => {
        const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
        if (arg && arg.testIdAttributes) {
          return currentRoute.elements ?? [];
        }
        if (fnStr.includes('followFormActions')) {
          const links: Array<{ href: string; text: string }> = [];
          for (const el of currentRoute.elements ?? []) {
            if (el.href) {
              links.push({ href: el.href, text: el.name });
            }
          }
          return links;
        }
        if (fnStr.includes('dismissPattern')) {
          return null;
        }
        if (fnStr.includes('innerText')) {
          if (typeof currentRoute.textFn === 'function') return currentRoute.textFn();
          return currentRoute.text ?? '';
        }
        if (fnStr.includes('IGNORED')) {
          return 'mock-layout';
        }
        if (fnStr.includes('frameSrcs')) {
          return { inputs: [], frameSrcs: [] };
        }
        return '';
      },
      frames: () => [],
      $$eval: async (sel: string) => {
        return [];
      },
      goto: async (url: string) => {
        if (url === 'about:blank') {
          currentUrl = 'about:blank';
          return { status: () => 200 };
        }
        currentUrl = url;
        const count = (attempts.get(url) ?? 0) + 1;
        attempts.set(url, count);

        const routeOrFn = routes[url] ?? { status: 200, title: 'Default', text: 'Some text' };
        currentRoute = typeof routeOrFn === 'function' ? routeOrFn(count) : routeOrFn;

        if (currentRoute.error) {
          throw currentRoute.error;
        }

        return {
          status: () => currentRoute.status ?? 200,
          request: () => ({ redirectedFrom: () => null }),
          headers: () => ({}),
        };
      },
      waitForLoadState: async () => {},
      waitForTimeout: async () => {},
      waitForFunction: async () => {
        if (currentRoute.waitForFunction) return currentRoute.waitForFunction();
        if (!currentRoute.text || currentRoute.text.trim() === '') {
          throw new Error('timeout');
        }
      },
      locator: () => ({
        count: async () => 0,
        nth: () => ({ isVisible: async () => false }),
        first: () => ({
          waitFor: async () => {},
          click: async () => {},
        }),
      }),
    } as unknown as Page;

    return page;
  };

  const context = {
    route: async () => {},
    close: async () => {},
    newPage: async () => createPage(),
  } as unknown as BrowserContext;

  return {
    context,
    attempts,
    browserManager: {
      createContext: async () => context,
    },
  };
}

describe('runAuditCrawl start page and typed errors', () => {
  it('start page answering 403 without interstitial throws ERR_UNREACHABLE with status', async () => {
    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 403,
        title: 'Forbidden',
        text: 'Access Denied: You do not have permission to view this directory.',
      },
    });

    await expect(
      runAuditCrawl(
        {
          url: 'https://example.com/',
          limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
          language: 'en',
        },
        {
          allowPrivateAddresses: true,
          deps: { browserManager: mock.browserManager },
        }
      )
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(AuditCrawlRefusedError);
      expect(err.code).toBe('ERR_UNREACHABLE');
      expect(err.message).toBe('The site answered with error 403.');
      return true;
    });
  });

  it('start page answering 500 throws ERR_UNREACHABLE with status', async () => {
    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 500,
        title: 'Server Error',
        text: 'Internal Server Error occurred on the server.',
      },
    });

    await expect(
      runAuditCrawl(
        {
          url: 'https://example.com/',
          limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
          language: 'en',
        },
        {
          allowPrivateAddresses: true,
          deps: { browserManager: mock.browserManager },
        }
      )
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(AuditCrawlRefusedError);
      expect(err.code).toBe('ERR_UNREACHABLE');
      expect(err.message).toBe('The site answered with error 500.');
      return true;
    });
  });

  it('a start page answering 503 once is retried and the audit goes on', async () => {
    const mock = makeMockBrowser({
      'https://example.com/': (attempt) => {
        if (attempt === 1) return { status: 503, title: 'Busy', text: 'Service Unavailable' };
        return { status: 200, title: 'Home', text: 'Welcome Home' };
      },
    });

    const result = await runAuditCrawl(
      {
        url: 'https://example.com/',
        limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
        language: 'en',
      },
      {
        allowPrivateAddresses: true,
        deps: { browserManager: mock.browserManager },
      }
    );

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].urlPath).toBe('/');
  });

  it('start page showing bot challenge throws AuditCrawlBlockedError with ERR_SITE_BLOCKED', async () => {
    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 403,
        title: 'Attention Required! | Cloudflare',
        text: 'Checking your browser before accessing example.com.',
      },
    });

    await expect(
      runAuditCrawl(
        {
          url: 'https://example.com/',
          limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
          language: 'en',
        },
        {
          allowPrivateAddresses: true,
          deps: { browserManager: mock.browserManager },
        }
      )
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(AuditCrawlBlockedError);
      expect(err.code).toBe('ERR_SITE_BLOCKED');
      expect(err.kind).toBe('bot-check');
      return true;
    });
  });

  it('start page with empty body throws AuditCrawlBlockedError with ERR_SITE_BLOCKED and kind empty', async () => {
    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 200,
        title: '',
        text: '   ',
      },
    });

    await expect(
      runAuditCrawl(
        {
          url: 'https://example.com/',
          limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
          language: 'en',
        },
        {
          allowPrivateAddresses: true,
          deps: { browserManager: mock.browserManager },
        }
      )
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(AuditCrawlBlockedError);
      expect(err.code).toBe('ERR_SITE_BLOCKED');
      expect(err.kind).toBe('empty');
      return true;
    });
  });

  it('an empty start page that fills in is audited', async () => {
    let calls = 0;
    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 200,
        title: 'Shop',
        textFn: () => {
          calls++;
          return calls === 1 ? '' : 'Welcome to the shop';
        },
        waitForFunction: async () => {},
      },
    });

    const result = await runAuditCrawl(
      {
        url: 'https://example.com/',
        limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
        language: 'en',
      },
      {
        allowPrivateAddresses: true,
        deps: { browserManager: mock.browserManager },
      }
    );

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].urlPath).toBe('/');
  });

  it('start host DNS failure throws AuditCrawlRefusedError with ERR_DNS', async () => {
    const netDeps = {
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
    };

    await expect(
      runAuditCrawl(
        {
          url: 'https://doesnotexist.example.com/',
          limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
          language: 'en',
        },
        {
          deps: { netDeps },
        }
      )
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(AuditCrawlRefusedError);
      expect(err.code).toBe('ERR_DNS');
      return true;
    });
  });

  it('browser launch failure throws AuditBrowserLaunchError with ERR_BROWSER_LAUNCH', async () => {
    const netDeps = {
      lookup: async () => ['93.184.216.34'],
      connect: async () => ({ status: 200, headers: {}, body: 'ok' }),
    };

    await expect(
      runAuditCrawl(
        {
          url: 'https://example.com/',
          limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
          language: 'en',
        },
        {
          deps: {
            netDeps,
            launchBrowser: async () => {
              throw new Error('spawn chromium ENOENT');
            },
          },
        }
      )
    ).rejects.toSatisfy((err: any) => {
      expect(err).toBeInstanceOf(AuditBrowserLaunchError);
      expect(err.code).toBe('ERR_BROWSER_LAUNCH');
      return true;
    });
  });
});

describe('DeterministicSpider retries on subpages', () => {
  it('retries 500 once and records page if retry succeeds', async () => {
    const progress: any[] = [];
    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 200,
        title: 'Home',
        text: 'Welcome',
        elements: [
          {
            role: 'link',
            name: 'Page 1',
            selector: 'a[href="/page1"]',
            href: '/page1',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
        ],
      },
      'https://example.com/page1': (attempt) => {
        if (attempt === 1) return { status: 500, title: 'Error', text: 'Fail' };
        return { status: 200, title: 'Page 1 OK', text: 'Success' };
      },
    });

    const spider = new DeterministicSpider([], 5);
    const pacer = new HostPacer();
    const result = await spider.crawl(mock.context, 'https://example.com/', {
      concurrency: 1,
      retryBusyHost: true,
      pacer,
      onPageProgress: (e) => progress.push(e),
    });

    expect(result.pages).toHaveLength(2);
    expect(result.pages[1].urlPath).toBe('/page1');
    expect(progress.some((p) => p.type === 'page' && p.path === '/page1' && p.state === 'retrying')).toBe(true);
  });

  it('retries 500 once and skips as http-error if retry also fails', async () => {
    const progress: any[] = [];
    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 200,
        title: 'Home',
        text: 'Welcome',
        elements: [
          {
            role: 'link',
            name: 'Page 1',
            selector: 'a[href="/page1"]',
            href: '/page1',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
        ],
      },
      'https://example.com/page1': {
        status: 500,
        title: 'Error',
        text: 'Persistent Server Error',
      },
    });

    const spider = new DeterministicSpider([], 5);
    const pacer = new HostPacer();
    const result = await spider.crawl(mock.context, 'https://example.com/', {
      concurrency: 1,
      retryBusyHost: true,
      pacer,
      onPageProgress: (e) => progress.push(e),
    });

    expect(result.pages).toHaveLength(1);
    expect(result.skipped?.some((s) => s.urlPath === '/page1' && s.why === 'http-error' && s.status === 500)).toBe(
      true
    );
    expect(
      progress.some(
        (p) => p.type === 'page' && p.path === '/page1' && p.state === 'skipped' && p.reason === 'http-error'
      )
    ).toBe(true);
  });

  it('retries timeout once and skips as timeout if still failing', async () => {
    const progress: any[] = [];
    const timeoutErr = new Error('page.goto: Timeout 1000ms exceeded.');
    timeoutErr.name = 'TimeoutError';

    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 200,
        title: 'Home',
        text: 'Welcome',
        elements: [
          {
            role: 'link',
            name: 'Slow',
            selector: 'a[href="/slow"]',
            href: '/slow',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
        ],
      },
      'https://example.com/slow': {
        error: timeoutErr,
      },
    });

    const spider = new DeterministicSpider([], 5);
    const pacer = new HostPacer();
    const result = await spider.crawl(mock.context, 'https://example.com/', {
      concurrency: 1,
      retryBusyHost: true,
      pacer,
      onPageProgress: (e) => progress.push(e),
    });

    expect(result.pages).toHaveLength(1);
    expect(result.skipped?.some((s) => s.urlPath === '/slow' && s.why === 'timeout')).toBe(true);
  });
});

describe('Outage resilience (ADR 0043)', () => {
  it('after 3 network failures in a row, pauses and resumes when outageCheck answers, retrying failed pages', async () => {
    let clockTime = 1000;
    const now = () => clockTime;
    const sleep = async (ms: number) => {
      clockTime += ms;
    };

    let probeCount = 0;
    const outageCheck = async () => {
      probeCount++;
      // Probe succeeds on 2nd check (after 20s)
      return probeCount >= 2;
    };

    let p1Attempts = 0;
    let p2Attempts = 0;
    let p3Attempts = 0;

    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 200,
        title: 'Home',
        text: 'Home page',
        elements: [
          {
            role: 'link',
            name: 'p1',
            selector: 'a[href="/p1"]',
            href: '/p1',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
          {
            role: 'link',
            name: 'p2',
            selector: 'a[href="/p2"]',
            href: '/p2',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
          {
            role: 'link',
            name: 'p3',
            selector: 'a[href="/p3"]',
            href: '/p3',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
        ],
      },
      'https://example.com/p1': () => {
        p1Attempts++;
        if (p1Attempts <= 2) throw new Error('net::ERR_CONNECTION_REFUSED');
        return { status: 200, title: 'P1 Recovered', text: 'Content 1' };
      },
      'https://example.com/p2': () => {
        p2Attempts++;
        if (p2Attempts <= 2) throw new Error('net::ERR_CONNECTION_RESET');
        return { status: 200, title: 'P2 Recovered', text: 'Content 2' };
      },
      'https://example.com/p3': () => {
        p3Attempts++;
        if (p3Attempts <= 2) throw new Error('net::ERR_CONNECTION_REFUSED');
        return { status: 200, title: 'P3 Recovered', text: 'Content 3' };
      },
    });

    const spider = new DeterministicSpider([], 5);
    const pacer = new HostPacer({ now, sleep: async () => {} });
    const progress: any[] = [];

    const result = await spider.crawl(mock.context, 'https://example.com/', {
      concurrency: 1,
      retryBusyHost: true,
      pacer,
      now,
      sleep,
      outageCheck,
      onPageProgress: (e) => progress.push(e),
    });

    expect(probeCount).toBe(2);
    // All 4 pages recorded (start page + 3 recovered pages)
    expect(result.pages).toHaveLength(4);
    expect(result.stoppedAnsweringAfter).toBeUndefined();
  });

  it('stops crawl and reports stoppedAnsweringAfter when outageCheck does not answer', async () => {
    let clockTime = 1000;
    const now = () => clockTime;
    const sleep = async (ms: number) => {
      clockTime += ms;
    };

    let probeCalls = 0;
    const outageCheck = async () => {
      probeCalls++;
      return false; // Server never answers
    };

    const mock = makeMockBrowser({
      'https://example.com/': {
        status: 200,
        title: 'Home',
        text: 'Home page',
        elements: [
          {
            role: 'link',
            name: 'p1',
            selector: 'a[href="/p1"]',
            href: '/p1',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
          {
            role: 'link',
            name: 'p2',
            selector: 'a[href="/p2"]',
            href: '/p2',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
          {
            role: 'link',
            name: 'p3',
            selector: 'a[href="/p3"]',
            href: '/p3',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
          {
            role: 'link',
            name: 'p4',
            selector: 'a[href="/p4"]',
            href: '/p4',
            visible: true,
            enabled: true,
            tagName: 'a',
          },
        ],
      },
      'https://example.com/p1': {
        error: new Error('net::ERR_CONNECTION_REFUSED'),
      },
      'https://example.com/p2': {
        error: new Error('net::ERR_CONNECTION_REFUSED'),
      },
      'https://example.com/p3': {
        error: new Error('net::ERR_CONNECTION_REFUSED'),
      },
      'https://example.com/p4': {
        status: 200,
        title: 'P4',
        text: 'Should never be reached',
      },
    });

    const spider = new DeterministicSpider([], 10);
    const pacer = new HostPacer({ now, sleep: async () => {} });

    const result = await spider.crawl(mock.context, 'https://example.com/', {
      concurrency: 1,
      retryBusyHost: true,
      pacer,
      now,
      sleep,
      outageCheck,
    });

    expect(probeCalls).toBe(6); // 10s * 6 = 60s
    expect(result.stoppedAnsweringAfter).toBe(1); // Only Home was recorded
    expect(result.pages).toHaveLength(1);
  });
});
