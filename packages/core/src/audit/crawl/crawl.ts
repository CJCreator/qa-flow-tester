/**
 * Website Audit: the crawl (REQ-002 to REQ-006, REQ-036). Node only.
 * Drives the Deterministic Spider in Safe Interaction Mode: links and sitemap.xml only (no exploring clicks,
 * no form actions followed), no Roles, no credentials, no sign-in again. The browser context lets through
 * public addresses only (`makeRequestGuard`) and aborts every changing request (`blockChanges`). robots.txt
 * is honoured and one request at a time goes to the host, Crawl-delay apart (ADR 0015).
 * Pages outside the limits, checkout paths and payment or sign-in pages are Skipped Pages: never opened
 * (limits, checkout paths) or opened and left untouched (card fields, provider frames, sign-in forms).
 * The start host (and its www twin) is resolved once, public only, before any request, and the audit's own
 * Chromium is pinned to exactly those addresses (ADR 0014); service workers are blocked so every request
 * passes the guard.
 */
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright';
import type { AuditRequest, PageCoverage, PageLink, SkippedPageInfo } from '@qa/types';
import { BREAKPOINT_VIEWPORTS, getBrowserPolicy, installRequestGuard, type BrowserManager } from '../../browser.js';
import { isIpLiteral } from '../../address-class.js';
import { blockChanges } from '../../live-site.js';
import { defaultNetDeps, makeRequestGuard, resolvePublic, type NetDeps } from '../../safe-net.js';
import type { AuditAddressCode } from './reachability.js';
import { makeCheckerFetch } from '../../checker-fetch.js';
import { RobotsPolicy } from '../../competitive/robots.js';
import { HostPacer } from '../../host-pacer.js';
import { redactUrl } from '../../redact.js';
import { DeterministicSpider, type SpiderPageInventoryItem } from '../../discovery/deterministic-spider.js';
import { skipKey } from '../analysis/broken-links.js';
import { isCheckoutPath, pageAreaVerdict } from './area-detect.js';
import { pathLimitVerdict } from './limits.js';

/** The user-agent token whose robots.txt group the audit follows (the Spider's, so one site rule fits both). */
export const AUDIT_ROBOTS_TOKEN = 'QA-Benchmarking-Bot';
/** Least pause between two requests to the audited host, when robots.txt asks for none (ADR 0015). */
export const AUDIT_MIN_GAP_MS = 500;
/** robots.txt and sitemap fetches: same limit as a page load. */
const SITE_FILE_TIMEOUT_MS = 10_000;
const SITE_FILE_REDIRECTS = 5;
/** Route rows kept in the coverage, as the Check-up does. */
const MAX_ROUTES = 500;
/** BrowserManager's Chromium launch flags (browser.ts), without its global pins. */
const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
];
/** A plain DNS name: nothing a `--host-resolver-rules` list could read as another rule or a pattern. */
const RULE_SAFE_HOST = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?$/;
/** The words of the start address check (reachability.ts), for the same refusals. */
const REFUSALS: Record<AuditAddressCode, string> = {
  ERR_PRIVATE_ADDRESS:
    'This address points to a private or local network. A Website Audit only checks public websites.',
  ERR_UNREACHABLE: 'The site name could not be found. Check the address for typos.',
};

/**
 * The start host did not resolve, or not to public addresses only, when the crawl began (DNS may have
 * changed since the start address check). Thrown before any request and before any browser is launched.
 */
export class AuditCrawlRefusedError extends Error {
  readonly code: AuditAddressCode;
  constructor(code: AuditAddressCode) {
    super(REFUSALS[code]);
    this.name = 'AuditCrawlRefusedError';
    this.code = code;
  }
}

/** Launches the audit's own browser. */
export type AuditBrowserLauncher = (options: LaunchOptions) => Promise<Pick<Browser, 'newContext' | 'close'>>;

/** One recorded page: what later stages need, without the element inventory. */
export interface AuditCrawlPage {
  /** Path and query, redacted. */
  urlPath: string;
  title: string;
  /** Link steps from the start address (the start page is 0). */
  depth: number;
  layoutGroup?: string;
  links: PageLink[];
  screenshotPath?: string;
}

/** A link that leaves the site (REQ-003 AC-2): never requested, listed with the pages it is on. */
export interface AuditLeavingLink {
  /** The redacted address. */
  to: string;
  /** Recorded pages that link to it, in crawl order. */
  from: string[];
}

export interface AuditCrawlResult {
  /** The address the audit was asked to start from. */
  startUrl: string;
  /** Where the start page landed after redirects; the start address when it was not recorded. */
  finalUrl: string;
  pages: AuditCrawlPage[];
  coverage: PageCoverage;
  leavingSite: AuditLeavingLink[];
  /** Pages that are nothing but a sign-in form, or answered 401 (REQ-006). */
  signInWalls: string[];
  /** Payment areas: checkout paths, card-number fields, payment-provider frames (REQ-036). */
  paymentAreas: string[];
  /** The pacer the crawl used, so later stages (link and sitemap checks) share its turns on the host (ADR 0015). */
  pacer: HostPacer;
  /** The robots.txt Crawl-delay the crawl used, in ms; null when the site sets none. */
  crawlDelayMs: number | null;
  /** The robots.txt policy the crawl followed, so the link check refuses the same addresses (ADR 0015). */
  robots?: Pick<RobotsPolicy, 'isAllowed'>;
}

export interface AuditCrawlProgress {
  stage: 'crawling';
  pagesFound: number;
  pagesRecorded: number;
  pagesSkipped: number;
  /** The page just recorded or skipped (redacted). */
  currentPath?: string;
}

/**
 * In-process seams for tests only (the fixture runs on 127.0.0.1). Nothing in an AuditRequest reaches
 * these, so a request can never turn the public-only guard off.
 */
export interface AuditCrawlDeps {
  /**
   * Fixtures only: a context from a browser the test launched with its own resolver rules. The crawl then
   * launches no browser and pins nothing. Production never sets it.
   */
  browserManager?: Pick<BrowserManager, 'createContext'>;
  /** Launches the audit's own pinned Chromium, closed when the crawl ends. Default: `chromium.launch`. */
  launchBrowser?: AuditBrowserLauncher;
  /** The browser's per-request guard. Default: `makeRequestGuard(netDeps)`, public addresses only. */
  requestGuard?: (url: string, redirected: boolean) => Promise<boolean>;
  /** Name lookup and connection for the guard, robots.txt and sitemaps. Default: the real network. */
  netDeps?: NetDeps;
}

export interface AuditCrawlOptions {
  /** Once aborted, no more pages are opened and the crawl returns what it found so far. */
  signal?: AbortSignal;
  onProgress?: (progress: AuditCrawlProgress) => void;
  /** Awaited for each recorded page while it is still rendered (Page Content extraction, REQ-005). */
  onRenderedPage?: (page: Page, info: AuditCrawlPage) => Promise<void>;
  /** Folder for a small screenshot of each recorded page. None when absent. */
  screenshotDir?: string;
  deps?: AuditCrawlDeps;
}

function toAuditPage(item: SpiderPageInventoryItem): AuditCrawlPage {
  return {
    urlPath: item.urlPath,
    title: item.title,
    depth: item.depth ?? 0,
    ...(item.layoutGroup ? { layoutGroup: item.layoutGroup } : {}),
    links: item.links ?? [],
    ...(item.screenshotPath ? { screenshotPath: item.screenshotPath } : {}),
  };
}

/** The address without its fragment, for `finalUrl`. */
function withoutHash(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

/** A `--host-resolver-rules` address: IPv6 in brackets, as browser.ts writes it. */
function ruleAddress(ip: string): string {
  return ip.includes(':') ? `[${ip.replace(/^\[|\]$/g, '')}]` : ip;
}

/**
 * Resolves the start host once with the public-only resolver and returns the resolver rules that make the
 * audit's Chromium use exactly the checked address, so a second lookup can never swap it (DNS rebinding).
 * The www twin, the same site to the crawl, is pinned too, or made unresolvable in the browser when it has
 * no public address. An IP address needs no rule. Throws AuditCrawlRefusedError when the start host is not
 * public, does not resolve, or is not a plain name.
 */
async function pinSiteHosts(start: URL, deps: Pick<NetDeps, 'lookup'>): Promise<string[]> {
  const host = start.hostname.toLowerCase();
  const literal = isIpLiteral(host);
  if (!literal && !RULE_SAFE_HOST.test(host)) throw new AuditCrawlRefusedError('ERR_UNREACHABLE');
  const checked = await resolvePublic(host, deps);
  if (!checked.ok) {
    throw new AuditCrawlRefusedError(checked.reason === 'private-address' ? 'ERR_PRIVATE_ADDRESS' : 'ERR_UNREACHABLE');
  }
  if (literal) return [];
  const rules = [`MAP ${host} ${ruleAddress(checked.address)}`];
  const twin = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  if (RULE_SAFE_HOST.test(twin)) {
    const twinChecked = await resolvePublic(twin, deps);
    rules.push(`MAP ${twin} ${twinChecked.ok ? ruleAddress(twinChecked.address) : '~NOTFOUND'}`);
  }
  return rules;
}

/** Closes the audit's own browser; one that hangs is left after 3 s, as BrowserManager.close does. */
async function closeBrowser(browser: Pick<Browser, 'close'>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 3000);
    }),
  ]);
  clearTimeout(timer);
}

export async function runAuditCrawl(request: AuditRequest, opts: AuditCrawlOptions = {}): Promise<AuditCrawlResult> {
  const deps = opts.deps ?? {};
  const netDeps = deps.netDeps ?? defaultNetDeps;
  const start = new URL(request.url);
  const startPath = start.pathname;

  // Before any request: the start host must still be public, and the browser gets exactly that address.
  const pins = await pinSiteHosts(start, netDeps);

  // robots.txt first, through the pinned outbound path: public addresses only (ADR 0031).
  const robots = await RobotsPolicy.fetch(
    start.origin,
    AUDIT_ROBOTS_TOKEN,
    makeCheckerFetch({
      allowPrivate: false,
      maxRedirects: SITE_FILE_REDIRECTS,
      timeoutMs: SITE_FILE_TIMEOUT_MS,
      deps: netDeps,
    })
  );
  // One pacer per Website Audit: page loads, robots.txt and sitemaps take turns on the host.
  const pacer = new HostPacer({ minGapMs: AUDIT_MIN_GAP_MS, crawlDelayMs: robots.crawlDelayMs });
  const siteFetch = makeCheckerFetch({
    allowPrivate: false,
    maxRedirects: SITE_FILE_REDIRECTS,
    timeoutMs: SITE_FILE_TIMEOUT_MS,
    pacer,
    deps: netDeps,
  });

  const launch: AuditBrowserLauncher = deps.launchBrowser ?? ((options) => chromium.launch(options));
  let browser: Pick<Browser, 'newContext' | 'close'> | undefined;
  let context: BrowserContext | undefined;

  // Progress: counted as pages are recorded and skipped, each path once.
  const recordedKeys = new Set<string>();
  const skippedKeys = new Set<string>();
  const report = (currentPath?: string) =>
    opts.onProgress?.({
      stage: 'crawling',
      pagesFound: recordedKeys.size + skippedKeys.size,
      pagesRecorded: recordedKeys.size,
      pagesSkipped: skippedKeys.size,
      ...(currentPath !== undefined ? { currentPath: redactUrl(currentPath) } : {}),
    });

  let finalUrl = request.url;
  let startRecorded = false;

  try {
    if (deps.browserManager) {
      context = await deps.browserManager.createContext({ baseUrl: request.url });
    } else {
      // The audit's own Chromium: never the shared BrowserManager, whose pins belong to another run.
      browser = await launch({
        headless: true,
        args: [...CHROMIUM_ARGS, ...(pins.length ? [`--host-resolver-rules=${pins.join(', ')}`] : [])],
      });
      context = await browser.newContext({
        viewport: BREAKPOINT_VIEWPORTS['1440px'],
        baseURL: request.url,
        ignoreHTTPSErrors: true,
        // route() never sees a service worker's requests: blocked, every request passes the guard.
        serviceWorkers: 'block',
      });
      // A shared machine's own guard (ADR 0014), as BrowserManager.createContext installs it.
      const policyGuard = getBrowserPolicy()?.guard;
      if (policyGuard) await installRequestGuard(context, policyGuard);
    }
    // The guard is the first route; blockChanges, added after, runs first and falls back to it.
    await installRequestGuard(context, deps.requestGuard ?? makeRequestGuard(netDeps));
    await blockChanges(context);

    const spider = new DeterministicSpider([], request.limits.maxPages);
    const result = await spider.crawl(context, request.url, {
      maxDepth: request.limits.maxDepth,
      exploreClicks: false,
      followFormActions: false,
      seedSitemap: true,
      robots,
      pacer,
      outboundFetch: siteFetch,
      signal: opts.signal,
      ...(opts.screenshotDir ? { screenshotDir: opts.screenshotDir, screenshotPrefix: 'audit' } : {}),
      // Asked before an address is queued (never for the start page): refused ones are never requested.
      admitPath: (url) => {
        if (pathLimitVerdict(url.pathname, request.limits, startPath)) return { why: 'excluded' };
        if (isCheckoutPath(url.pathname)) return { why: 'payment', detail: 'checkout-path' };
        return undefined;
      },
      inspectPage: pageAreaVerdict,
      onPage: (page) => {
        recordedKeys.add(skipKey(page.urlPath));
        report(page.urlPath);
      },
      onSkipped: (info) => {
        skippedKeys.add(skipKey(info.urlPath));
        report(info.urlPath);
      },
      onRecordedPage: async (page, item) => {
        if (!startRecorded && item.depth === 0) {
          startRecorded = true;
          finalUrl = withoutHash(page.url());
        }
        if (opts.onRenderedPage) await opts.onRenderedPage(page, toAuditPage(item));
      },
    });

    const pages = result.pages.map(toAuditPage);
    const recorded = new Set(pages.map((p) => skipKey(p.urlPath)));

    // One Skipped Page per path, never one that was also recorded.
    const seen = new Set<string>();
    const skipped: SkippedPageInfo[] = [];
    for (const s of result.skipped ?? []) {
      const key = skipKey(s.urlPath);
      if (recorded.has(key) || seen.has(key)) continue;
      seen.add(key);
      skipped.push(s);
    }

    const leaving = new Map<string, AuditLeavingLink>();
    for (const page of pages) {
      for (const link of page.links) {
        if (!link.leavesSite) continue;
        const entry = leaving.get(link.to) ?? { to: link.to, from: [] };
        if (!entry.from.includes(page.urlPath)) entry.from.push(page.urlPath);
        leaving.set(link.to, entry);
      }
    }

    const routes = (result.routes ?? []).slice(0, MAX_ROUTES);
    const coverage: PageCoverage = {
      found: pages.length + skipped.length,
      reached: pages.length,
      skipped,
      ...(routes.length > 0 ? { routes } : {}),
    };

    opts.onProgress?.({
      stage: 'crawling',
      pagesFound: coverage.found,
      pagesRecorded: pages.length,
      pagesSkipped: skipped.length,
    });

    return {
      startUrl: request.url,
      finalUrl,
      pages,
      coverage,
      leavingSite: [...leaving.values()],
      signInWalls: [...new Set(result.signInWalls)],
      paymentAreas: [...new Set(skipped.filter((s) => s.why === 'payment').map((s) => s.urlPath))],
      pacer,
      crawlDelayMs: robots.crawlDelayMs ?? null,
      robots,
    };
  } finally {
    await context?.close().catch(() => {});
    if (browser) await closeBrowser(browser);
  }
}
