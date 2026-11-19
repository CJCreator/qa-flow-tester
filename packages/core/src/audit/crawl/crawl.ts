/**
 * Website Audit: the crawl (REQ-002 to REQ-006, REQ-036). Node only.
 * Drives the Deterministic Spider in Safe Interaction Mode: links and sitemap.xml only (no exploring clicks,
 * no form actions followed), no Roles, no credentials, no sign-in again. The browser context lets through
 * public addresses only (`makeRequestGuard`) and aborts every changing request (`blockChanges`). robots.txt
 * is honoured. 3 pages load at once to begin with, one more after every 25 healthy answers up to 8 on a local
 * runner (3 on the hosted copy), starts always 500 ms apart (ADR 0043, 0046); a robots Crawl-delay, or a host
 * that answers 429 or 503, brings it back to one at a time for good (ADR 0015).
 * Pages outside the limits, checkout paths and payment or sign-in pages are Skipped Pages: never opened
 * (limits, checkout paths) or opened and left untouched (card fields, provider frames, sign-in forms).
 * The start host (and its www twin) is resolved once, public only, before any request, and the audit's own
 * Chromium is pinned to exactly those addresses (ADR 0014); service workers are blocked so every request
 * passes the guard.
 */
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from 'playwright';
import type { AuditRequest, PageCoverage, PageLink, RouteSkipReason, SkippedPageInfo } from '@qa/types';
import { AUDIT_LIMIT_DEFAULTS } from '@qa/types';
import {
  BREAKPOINT_VIEWPORTS,
  getBrowserPolicy,
  installRequestGuard,
  WEBRTC_NO_DIRECT_UDP,
  type BrowserManager,
} from '../../browser.js';
import { isIpLiteral } from '../../address-class.js';
import { blockChanges } from '../../live-site.js';
import {
  defaultNetDeps,
  makeRequestGuard,
  privateAddressesAllowed,
  resolvePublic,
  type NetDeps,
} from '../../safe-net.js';
import { START_ADDRESS_MESSAGES, type AuditAddressCode } from './reachability.js';
import { makeCheckerFetch } from '../../checker-fetch.js';
import { RobotsPolicy, ROBOTS_USER_AGENT_TOKEN } from '../../competitive/robots.js';
import { HostPacer } from '../../host-pacer.js';
import { redactUrl } from '../../redact.js';
import {
  DeterministicSpider,
  type SpiderCrawlState,
  type SpiderPageInventoryItem,
} from '../../discovery/deterministic-spider.js';
import type { CrawlFrontierState } from '../../discovery/frontier.js';
import { skipKey } from '../analysis/broken-links.js';
import { isCheckoutPath, pageAreaVerdict } from './area-detect.js';
import { pathLimitVerdict } from './limits.js';
import {
  AuditCrawlBlockedError,
  addTunnelSkipHeaders,
  classifyInterstitial,
  readInterstitialSignals,
  type InterstitialKind,
} from './interstitial.js';

/** The user-agent token whose robots.txt group the audit follows (the Spider's, so one site rule fits both). */
export const AUDIT_ROBOTS_TOKEN = ROBOTS_USER_AGENT_TOKEN;
/** Least pause between two requests to the audited host, when robots.txt asks for none (ADR 0015). */
export const AUDIT_MIN_GAP_MS = 500;
/** How long an empty start page gets to render before it counts as an Interstitial Page. */
const EMPTY_START_WAIT_MS = 5_000;
/**
 * One page load's limit in a Website Audit (the Check-up keeps 10 s). Slow hosts, such as a dev server behind a
 * tunnel, took 10 to 25 s per page, so a 10 s limit skipped about half of a site as `timeout`.
 */
export const AUDIT_PAGE_TIMEOUT_MS = 30_000;
/**
 * The whole crawl's limit in a Website Audit, so a slow site is read to its page limit instead of stopping at
 * the Spider's 10 minutes. QA_CRAWL_MAX_MINUTES still overrides it.
 */
export const AUDIT_MAX_CRAWL_MS = 60 * 60 * 1000;
/**
 * Pages of one site loaded at once (ADR 0043), each with its own browser page; their starts stay
 * AUDIT_MIN_GAP_MS apart. One at a time when robots.txt sets a Crawl-delay or the site says it is busy.
 */
export const AUDIT_FETCH_IN_FLIGHT = AUDIT_LIMIT_DEFAULTS.fetchInFlight;
/**
 * The most pages of one site loaded at once after climbing (ADR 0046): 8 on a local runner, 3 on the hosted copy
 * (1 CPU, 2 GiB). The 500 ms gap between starts still holds, so a site never sees more than 2 starts a second.
 */
export function auditFetchCeiling(localRunner: boolean): number {
  return localRunner ? AUDIT_LIMIT_DEFAULTS.fetchInFlightLocal : AUDIT_LIMIT_DEFAULTS.fetchInFlightHosted;
}
/**
 * Addresses of one shape (`/p/<n>`, `/2026/11/19`) a Website Audit queues at most (T-401). The Check-up keeps
 * the Spider's 25; at 25 a shop with `/p/12345` product addresses stopped at 25 products.
 */
export const AUDIT_MAX_PER_SHAPE = 500;
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
  WEBRTC_NO_DIRECT_UDP,
];
/** A plain DNS name: nothing a `--host-resolver-rules` list could read as another rule or a pattern. */
const RULE_SAFE_HOST = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.?$/;
/** The words of the start address check (reachability.ts), for the same refusals. */
const REFUSALS: Record<AuditAddressCode, string> = {
  ERR_PRIVATE_ADDRESS: START_ADDRESS_MESSAGES.private,
  ERR_UNREACHABLE: START_ADDRESS_MESSAGES.error,
  ERR_DNS: START_ADDRESS_MESSAGES.dns,
};

/**
 * The start host did not resolve, or not to public addresses only, when the crawl began (DNS may have
 * changed since the start address check). Thrown before any request and before any browser is launched.
 */
export class AuditCrawlRefusedError extends Error {
  readonly code: AuditAddressCode;
  constructor(code: AuditAddressCode, message?: string) {
    super(message ?? REFUSALS[code]);
    this.name = 'AuditCrawlRefusedError';
    this.code = code;
  }
}

/** Thrown when the headless browser could not be launched. */
export class AuditBrowserLaunchError extends Error {
  readonly code = 'ERR_BROWSER_LAUNCH' as const;
  constructor(message = 'The browser could not be launched.') {
    super(message);
    this.name = 'AuditBrowserLaunchError';
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
  /** The crawl ran on a local runner with private addresses allowed (ADR 0042); the link check follows it. */
  allowPrivateAddresses?: boolean;
  /** When host stopped answering after an outage: number of pages recorded before stopping (ADR 0043). */
  stoppedAnsweringAfter?: number;
}

/**
 * Where a crawl stands (T-407): enough to carry on with the same limits after a stop or a restart. Saved every
 * AUDIT_CHECKPOINT_EVERY recorded pages, when the crawl is stopped, and when it ends.
 */
export interface AuditCrawlCheckpoint {
  /** Where the start page landed. */
  finalUrl: string;
  frontier: CrawlFrontierState;
  /** Addresses still to load: queued, or being loaded when the checkpoint was taken. */
  pending: Array<{ url: string; depth: number }>;
  /** Pages recorded so far, in crawl order. */
  pages: AuditCrawlPage[];
  skipped: SkippedPageInfo[];
  signInWalls: string[];
  /** The crawl ran to its end: a resume goes straight to the checks after the crawl. */
  crawlDone: boolean;
}

/** Recorded pages between two checkpoints (T-407). */
export const AUDIT_CHECKPOINT_EVERY = 25;

export type AuditCrawlPageState = 'queued' | 'loading' | 'recorded' | 'retrying' | 'skipped';

export interface AuditCrawlPageProgress {
  type: 'page';
  path: string;
  state: AuditCrawlPageState;
  reason?: RouteSkipReason;
}

export interface AuditCrawlSummaryProgress {
  stage: 'crawling';
  pagesFound: number;
  pagesRecorded: number;
  pagesSkipped: number;
  /** The page just recorded or skipped (redacted). */
  currentPath?: string;
}

export type AuditCrawlProgress = AuditCrawlSummaryProgress | AuditCrawlPageProgress;

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
  /** Test seam: clock function. Default: Date.now. */
  now?: () => number;
  /** Test seam: minimum gap between starts in ms. Default: AUDIT_MIN_GAP_MS (500). */
  minGapMs?: number;
  /** Test seam: sleep function for pacing and outage checks. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Test seam: pause in ms before retrying a network error. Default: 5000. */
  retryDelayMs?: number;
}

/** What the crawl hands to `onRenderedPage` besides the page: its pacer, so extra requests take turns too. */
export interface RenderedPageContext {
  pacer: HostPacer;
  /** The headers of the page's own (main frame) response, when one was seen. For technology detection only. */
  responseHeaders?: Record<string, string>;
  /** A new page in the crawl's browser context (same guards), for lab work off the crawl workers (T-404). */
  openPage?: () => Promise<Page>;
  /** Work the crawl awaits before it closes its browser, never before its next page (T-404). */
  defer?: (work: Promise<void>) => void;
  /** Lab pages open at once: 4 on a local runner, 2 on the hosted copy (T-404). */
  labInFlight?: number;
  /** The crawl's stop signal: lab work not yet started is dropped once it aborts. */
  signal?: AbortSignal;
}

/** Lab pages (axe, timing, phone layout) open at once, off the crawl workers (T-404). */
export function auditLabInFlight(localRunner: boolean): number {
  return localRunner ? 4 : 2;
}

export interface AuditCrawlOptions {
  /** Once aborted, no more pages are opened and the crawl returns what it found so far. */
  signal?: AbortSignal;
  onProgress?: (progress: AuditCrawlProgress) => void;
  /** Awaited for each recorded page while it is still rendered (Page Content extraction, REQ-005). */
  onRenderedPage?: (page: Page, info: AuditCrawlPage, context: RenderedPageContext) => Promise<void>;
  /** Folder for a small screenshot of each recorded page. None when absent. */
  screenshotDir?: string;
  /**
   * A local runner only (ADR 0042: not a beta copy, bound to this computer), set by the runner and never from
   * the start body: localhost and LAN addresses are crawled, nothing is pinned, and the browser guard lets any
   * web address through. A shared machine's browser policy still applies when one is set.
   */
  allowPrivateAddresses?: boolean;
  /** Carry on from this checkpoint (T-407): its pages count toward the page limit and are not loaded again. */
  resume?: AuditCrawlCheckpoint;
  /**
   * Saves a checkpoint every `every` recorded pages (default AUDIT_CHECKPOINT_EVERY), when the crawl is stopped
   * and when it ends (T-407). Saves run one at a time; a failed save is ignored and the crawl goes on.
   */
  checkpoint?: { every?: number; save: (checkpoint: AuditCrawlCheckpoint) => Promise<void> };
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
    throw new AuditCrawlRefusedError(checked.reason === 'private-address' ? 'ERR_PRIVATE_ADDRESS' : 'ERR_DNS');
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
  // A local runner may audit this computer and its network; a shared machine's browser policy still wins.
  const allowPrivate = opts.allowPrivateAddresses === true && privateAddressesAllowed(true);

  // Before any request: the start host must still be public, and the browser gets exactly that address. A
  // local run pins nothing: the browser resolves `localhost` itself and reaches ::1 or 127.0.0.1, whichever
  // the dev server listens on.
  const pins = allowPrivate ? [] : await pinSiteHosts(start, netDeps);

  // robots.txt first, through the pinned outbound path: public addresses only, unless local (ADR 0031).
  const robots = await RobotsPolicy.fetch(
    start.origin,
    AUDIT_ROBOTS_TOKEN,
    makeCheckerFetch({
      allowPrivate,
      maxRedirects: SITE_FILE_REDIRECTS,
      timeoutMs: SITE_FILE_TIMEOUT_MS,
      deps: netDeps,
    })
  );
  // One pacer per Website Audit: page loads, robots.txt and sitemaps take turns on the host.
  const pacer = new HostPacer({
    minGapMs: deps.minGapMs ?? AUDIT_MIN_GAP_MS,
    crawlDelayMs: robots.crawlDelayMs,
    maxInFlight: AUDIT_FETCH_IN_FLIGHT,
    // `allowPrivateAddresses` is set by a local runner only (ADR 0042), so it also tells local from hosted.
    ceiling: auditFetchCeiling(opts.allowPrivateAddresses === true),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });
  const siteFetch = makeCheckerFetch({
    allowPrivate,
    maxRedirects: SITE_FILE_REDIRECTS,
    timeoutMs: SITE_FILE_TIMEOUT_MS,
    pacer,
    deps: netDeps,
  });

  const launch: AuditBrowserLauncher = deps.launchBrowser ?? ((options) => chromium.launch(options));
  let browser: Pick<Browser, 'newContext' | 'close'> | undefined;
  let context: BrowserContext | undefined;
  /** Lab work handed back by `onRenderedPage` (T-404): awaited before the browser closes. */
  const labWork: Promise<void>[] = [];

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

  const resume = opts.resume;
  for (const p of resume?.pages ?? []) recordedKeys.add(skipKey(p.urlPath));
  for (const s of resume?.skipped ?? []) skippedKeys.add(skipKey(s.urlPath));

  // Checkpoints (T-407): what this crawl recorded and skipped, beside what the checkpoint it resumed holds.
  const crawlPages: AuditCrawlPage[] = [];
  const crawlSkipped: SkippedPageInfo[] = [];
  let readState: (() => SpiderCrawlState) | undefined;
  let saving: Promise<void> = Promise.resolve();
  const checkpointEvery = Math.max(1, opts.checkpoint?.every ?? AUDIT_CHECKPOINT_EVERY);
  const saveCheckpoint = (crawlDone: boolean): Promise<void> => {
    const save = opts.checkpoint?.save;
    if (!save || !readState) return saving;
    const state = readState();
    const skippedNow = [...(resume?.skipped ?? []), ...crawlSkipped];
    const checkpoint: AuditCrawlCheckpoint = {
      finalUrl,
      frontier: state.frontier,
      pending: crawlDone ? [] : state.pending,
      pages: [...(resume?.pages ?? []), ...crawlPages],
      skipped: skippedNow,
      signInWalls: [
        ...new Set([
          ...(resume?.signInWalls ?? []),
          ...skippedNow.filter((s) => s.why === 'sign-in').map((s) => s.urlPath),
        ]),
      ],
      crawlDone,
    };
    saving = saving.then(() => save(checkpoint)).catch(() => {});
    return saving;
  };

  let finalUrl = resume?.finalUrl ?? request.url;
  // A start page that is a tunnel warning or a bot check stops the crawl: the site itself was never read.
  let blocked: InterstitialKind | null = null;
  let startError: { code: AuditAddressCode; message: string } | null = null;
  const blockedStop = new AbortController();
  const crawlSignal = opts.signal ? AbortSignal.any([opts.signal, blockedStop.signal]) : blockedStop.signal;

  try {
    if (deps.browserManager) {
      context = await deps.browserManager.createContext({ baseUrl: request.url });
    } else {
      // The audit's own Chromium: never the shared BrowserManager, whose pins belong to another run.
      try {
        const egressProxy = getBrowserPolicy()?.proxy;
        browser = await launch({
          headless: true,
          args: [...CHROMIUM_ARGS, ...(pins.length ? [`--host-resolver-rules=${pins.join(', ')}`] : [])],
          ...(egressProxy ? { proxy: { server: egressProxy } } : {}),
        });
      } catch (err) {
        throw new AuditBrowserLaunchError(err instanceof Error ? err.message : undefined);
      }
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
    await installRequestGuard(context, deps.requestGuard ?? makeRequestGuard(netDeps, { allowPrivate }));
    await blockChanges(context);
    // Added last, so it runs first: same-site requests carry the tunnel skip headers into the routes above.
    await addTunnelSkipHeaders(context, start);

    // The headers of each page's own response, for technology detection (never stored whole: readPage drops
    // cookies and authorization).
    const mainHeaders = new WeakMap<Page, Record<string, string>>();
    if (typeof context.on === 'function') {
      context.on('response', (response) => {
        try {
          const req = response.request();
          const frame = req.frame();
          if (!req.isNavigationRequest() || frame.parentFrame() !== null) return;
          mainHeaders.set(frame.page(), response.headers());
        } catch {
          // A response of a page that is already closed: nothing to record.
        }
      });
    }

    // A resumed crawl records only the pages its checkpoint is short of, from where the start page landed.
    const spider = new DeterministicSpider([], Math.max(0, request.limits.maxPages - (resume?.pages.length ?? 0)));
    if (resume) report();
    const result = await spider.crawl(context, resume ? resume.finalUrl : request.url, {
      ...(resume ? { resume: { frontier: resume.frontier, pending: resume.crawlDone ? [] : resume.pending } } : {}),
      exposeState: (read) => {
        readState = read;
      },
      maxDepth: request.limits.maxDepth,
      maxPerShape: AUDIT_MAX_PER_SHAPE,
      pageTimeoutMs: AUDIT_PAGE_TIMEOUT_MS,
      // One worker per page the pacer may let through at once after climbing, so all of them are used (ADR 0046).
      concurrency: pacer.ceiling,
      maxConcurrency: pacer.ceiling,
      retryBusyHost: true,
      retryDelayMs: deps.retryDelayMs ?? 5000,
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      onPageProgress: (event) => opts.onProgress?.(event),
      ...(process.env.QA_CRAWL_MAX_MINUTES ? {} : { maxDurationMs: AUDIT_MAX_CRAWL_MS }),
      exploreClicks: false,
      followFormActions: false,
      seedSitemap: true,
      robots,
      pacer,
      outboundFetch: siteFetch,
      signal: crawlSignal,
      ...(opts.screenshotDir ? { screenshotDir: opts.screenshotDir, screenshotPrefix: 'audit' } : {}),
      // Asked before an address is queued (never for the start page): refused ones are never requested.
      admitPath: (url) => {
        if (pathLimitVerdict(url.pathname, request.limits, startPath)) return { why: 'excluded' };
        if (isCheckoutPath(url.pathname)) return { why: 'payment', detail: 'checkout-path' };
        return undefined;
      },
      inspectPage: pageAreaVerdict,
      onStartPage: async (page, navRes) => {
        finalUrl = withoutHash(page.url());
        let kind = classifyInterstitial(await readInterstitialSignals(page));
        if (kind === 'empty') {
          // A page that renders in the browser can be empty for a moment: wait once, then look again (ADR 0042).
          await page
            .waitForFunction(() => !!document.body && document.body.innerText.trim() !== '', null, {
              timeout: EMPTY_START_WAIT_MS,
            })
            .catch(() => {});
          kind = classifyInterstitial(await readInterstitialSignals(page));
        }
        if (kind) {
          blocked = kind;
          blockedStop.abort();
          return { blocked: kind };
        }
        if (!navRes.ok) {
          const isDns =
            navRes.error?.kind === 'net' &&
            // The error text includes the address, so a bare "dns" would match a host like dnschecker.org.
            /ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo/i.test(navRes.error?.detail ?? '');
          const code: AuditAddressCode = isDns ? 'ERR_DNS' : 'ERR_UNREACHABLE';
          const message = isDns ? REFUSALS.ERR_DNS : REFUSALS.ERR_UNREACHABLE;
          startError = { code, message };
          blockedStop.abort();
          return { startError: { code, message } };
        }
        if (navRes.status && navRes.status >= 400) {
          const message = `The site answered with error ${navRes.status}.`;
          startError = { code: 'ERR_UNREACHABLE', message };
          blockedStop.abort();
          return { startError: { code: 'ERR_UNREACHABLE', message } };
        }
      },
      onPage: (page) => {
        recordedKeys.add(skipKey(page.urlPath));
        report(page.urlPath);
      },
      onSkipped: (info) => {
        crawlSkipped.push(info);
        skippedKeys.add(skipKey(info.urlPath));
        report(info.urlPath);
      },
      onRecordedPage: async (page, item) => {
        crawlPages.push(toAuditPage(item));
        if (opts.checkpoint && crawlPages.length % checkpointEvery === 0) void saveCheckpoint(false);
        if (opts.onRenderedPage) {
          const responseHeaders = mainHeaders.get(page);
          const crawlContext = context!;
          await opts.onRenderedPage(page, toAuditPage(item), {
            pacer,
            ...(responseHeaders ? { responseHeaders } : {}),
            openPage: () => crawlContext.newPage(),
            defer: (work) => labWork.push(work),
            labInFlight: auditLabInFlight(allowPrivate),
            signal: crawlSignal,
          });
        }
      },
    });
    if (blocked || result.blocked) throw new AuditCrawlBlockedError((blocked || result.blocked)!);
    if (startError || result.startRefused) {
      const err = (startError || result.startRefused)!;
      throw new AuditCrawlRefusedError(err.code as AuditAddressCode, err.message);
    }

    // The last checkpoint: after a stop it is where a resume starts; after the end, the checks can start from it.
    if (opts.checkpoint) {
      await Promise.allSettled(labWork);
      await saveCheckpoint(!opts.signal?.aborted);
    }

    // A resumed crawl's pages come first; a page is listed once, the first time it was recorded.
    const pages: AuditCrawlPage[] = [];
    const recorded = new Set<string>();
    for (const page of [...(resume?.pages ?? []), ...result.pages.map(toAuditPage)]) {
      const key = skipKey(page.urlPath);
      if (recorded.has(key)) continue;
      recorded.add(key);
      pages.push(page);
    }

    // One Skipped Page per path, never one that was also recorded.
    const seen = new Set<string>();
    const skipped: SkippedPageInfo[] = [];
    for (const s of [...(resume?.skipped ?? []), ...(result.skipped ?? [])]) {
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
      signInWalls: [...new Set([...(resume?.signInWalls ?? []), ...result.signInWalls])],
      paymentAreas: [...new Set(skipped.filter((s) => s.why === 'payment').map((s) => s.urlPath))],
      pacer,
      crawlDelayMs: robots.crawlDelayMs ?? null,
      robots,
      allowPrivateAddresses: allowPrivate,
      ...(result.stoppedAnsweringAfter !== undefined ? { stoppedAnsweringAfter: result.stoppedAnsweringAfter } : {}),
    };
  } finally {
    // Lab work (T-404) uses pages of this context: it ends before the browser closes, never before the next page.
    await Promise.allSettled(labWork);
    await context?.close().catch(() => {});
    if (browser) await closeBrowser(browser);
  }
}
