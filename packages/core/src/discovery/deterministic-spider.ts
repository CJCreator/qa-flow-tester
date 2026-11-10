import { promises as fs } from 'fs';
import path from 'path';
import type { BrowserContext, Page } from 'playwright';
import type {
  TestCaseStep,
  PageInventoryItem,
  SensitiveAction,
  AmbiguityQuestion,
  ElementInventoryItem,
  PageLink,
  RouteTelemetry,
  SkippedPageInfo,
  RouteSkipReason,
} from '@qa/types';
import { SafetyFilter } from './safety-filter.js';
import { collectElementInventory, TEST_ID_ATTRIBUTES } from './element-inventory.js';
import { redactUrl } from '../redact.js';
import { isSameSite } from '../same-site.js';
import { makeOutboundFetch, sameSiteUrl } from '../safe-net.js';
import type { FetchFn } from '@qa/checkers';
import { readLayoutFingerprint } from '../competitive/safe-crawler.js';
import type { RobotsPolicy } from '../competitive/robots.js';
import type { HostPacer } from '../host-pacer.js';
import { exploreInteractiveStates, type ReadForm } from './interactive-states.js';
import { inferCrud, readCrudStructure, probeDeleteConfirm } from './crud-facts.js';
import { navigate, toTelemetry, looksLikeLogin, type NavigateResult } from '../navigate.js';
import type { InterstitialKind } from '../audit/crawl/interstitial.js';
import { debugLog } from '../debug-log.js';
import { normalizeRoute, CrawlFrontier } from './frontier.js';
import { dismissOverlays } from './overlay.js';

export interface FormInputInfo {
  /** The HTML name attribute (may be empty). */
  name: string;
  /** What a person would call the field: its label, then placeholder, then id, then name attribute. */
  label: string;
  type: string;
  selector: string;
  defaultValue?: string;
  required?: boolean;
  pattern?: string;
  min?: string;
  max?: string;
  minLength?: number;
  maxLength?: number;
}

export interface DiscoveredFormInfo {
  id?: string;
  action: string;
  method: string;
  urlPath: string;
  inputs: FormInputInfo[];
  submitButtonSelector?: string;
  /** Steps that open the form first (a tab, drawer or dialog), recorded while exploring. */
  opening?: TestCaseStep[];
}

export interface SpiderPageInventoryItem extends PageInventoryItem {
  exploreErrors?: number;
  /** Link steps from the start address (the start page is 0). Always set on pages the Spider records. */
  depth?: number;
}

/** Why a page found by the crawl is left alone: it becomes a Skipped Page with this reason. */
export interface SpiderSkipVerdict {
  why: RouteSkipReason;
  /** Short fixed wording, never page text. */
  detail?: string;
}

export interface SpiderResult {
  pages: SpiderPageInventoryItem[];
  forms: DiscoveredFormInfo[];
  sensitiveActions: SensitiveAction[];
  ambiguityQuestions: AmbiguityQuestion[];
  /** Pages that sent the crawler to a sign-in form instead of opening. */
  signInWalls: string[];
  /** Same-site pages robots.txt asked crawlers to leave alone. */
  skippedByRobots?: string[];
  /** Pages found but not reached, and why. Paths only, never a query string. */
  skipped?: SkippedPageInfo[];
  routes?: RouteTelemetry[];
  sessionLost?: boolean;
  startRedirectedOffSite?: boolean;
  /** When host stopped answering after an outage: number of pages recorded before stopping (ADR 0043). */
  stoppedAnsweringAfter?: number;
  blocked?: InterstitialKind;
  startRefused?: { code: string; message: string };
}

export type SkippedPage = SkippedPageInfo;

export interface CrawlOptions {
  /** Where to start besides the target URL, e.g. the page a role landed on after signing in. */
  startPaths?: string[];
  /** Click script-driven links and navigation buttons to find pages links alone don't reach. Default true. */
  exploreClicks?: boolean;
  /** Pages robots.txt asks crawlers to leave alone are skipped (public sites). */
  robots?: RobotsPolicy;
  /** Minimum pause between page loads, to go easy on a site we don't own. Default 100ms. Unused with `pacer`. */
  pageDelayMs?: number;
  /**
   * One request at a time per host (ADR 0015): every page load, click and the robots/sitemap fetches wait
   * for the host's turn, so workers never load two pages of one host at once. Replaces `pageDelayMs`
   * pacing; share it with the run's other fetches (`makeOutboundFetch({ pacer })`).
   */
  pacer?: HostPacer;
  /** Number of concurrent page evaluations (1 to 5, default 2). */
  concurrency?: number;
  /** Custom HTTP headers sent with every request (e.g. X-QA-Bypass-Token). */
  customHeaders?: Record<string, string>;
  /** Folder for a small screenshot of each page, shown on the plan map. None when absent. */
  screenshotDir?: string;
  /** Start of each screenshot's file name, so crawls as different roles don't overwrite each other. */
  screenshotPrefix?: string;
  /** Told about each page as it's recorded, for progress. */
  onPage?: (page: PageInventoryItem, pagesSoFar: number, forms: SpiderResult['forms']) => void;
  /** Once aborted, no more pages are opened: the crawl returns what it found so far. */
  signal?: AbortSignal;
  /** Maximum navigation attempts before giving up (default maxPages * 3) */
  maxAttempts?: number;
  /** Known login paths for detecting bounce / auth walls */
  knownLoginPaths?: string[];
  /** How many consecutive sign-in walls / 401s before session is declared lost (default 3) */
  stopAfterWalls?: number;
  /** Role name (e.g. 'visitor', 'admin', 'manager') */
  role?: string;
  /** Whether the crawl is signed in */
  isSignedIn?: boolean;
  /** Maximum crawl depth from start URL (default 8) */
  maxDepth?: number;
  /** Maximum pages per route shape to bound crawler traps (default 25) */
  maxPerShape?: number;
  /** Maximum duration of crawl in milliseconds (default 10 min) */
  maxDurationMs?: number;
  /** Time one page load may take before it counts as a timeout; its one retry gets 1.5 times this (default 10 s). */
  pageTimeoutMs?: number;
  /**
   * With a pacer (the Website Audit, ADR 0043): a page answered 429 or 503 slows its host down (`pacer.slowDown`,
   * honouring Retry-After) and is loaded once more in a later turn. Default false: the Check-up keeps
   * recording such a page as an `http-error` skip.
   */
  retryBusyHost?: boolean;
  /** Epoch ms deadline shared across crawls */
  deadlineAt?: number;
  /** Allowed query parameters included in canonical route key */
  routeQueryParams?: string[];
  /** Whether to include hash fragment in route key */
  includeHash?: boolean;
  /** Whether to seed crawl with /sitemap.xml (default true) */
  seedSitemap?: boolean;
  /** GET used for robots.txt and sitemaps (ADR 0031). Defaults to `makeOutboundFetch` (pinned, guard-aware). */
  outboundFetch?: FetchFn;
  /** On-demand session re-authenticator when consecutive auth walls are hit */
  reloginHandler?: () => Promise<boolean>;
  /**
   * Asked for every address found (links, sitemaps, clicks), never for the start addresses, before it is
   * queued. A verdict makes it a Skipped Page that is never requested (Website Audit: `excluded`, checkout
   * paths as `payment`). Asked once per address.
   */
  admitPath?: (url: URL, depth: number) => SpiderSkipVerdict | undefined;
  /**
   * Asked once a page has loaded and passed the sign-in, redirect and status checks, before anything on it
   * is read or clicked. A verdict makes it a Skipped Page: nothing on it is clicked, none of its links are
   * followed, and a `sign-in` verdict also lists it in `signInWalls`.
   */
  inspectPage?: (page: Page, landed: URL) => Promise<SpiderSkipVerdict | undefined>;
  /** Follow the action address of a GET form with no required fields, as a link. Default true. */
  followFormActions?: boolean;
  /** Awaited after a page is recorded, while the rendered page is still open (Page Content extraction). */
  onRecordedPage?: (page: Page, item: SpiderPageInventoryItem) => Promise<void>;
  /** Told about each Skipped Page as it is listed, for progress. */
  onSkipped?: (info: SkippedPageInfo) => void;
  /** Pause in ms before retrying a network error (ADR 0043), default 0. */
  retryDelayMs?: number;
  /** Per-page progress events (ADR 0042 / T-79). */
  onPageProgress?: (event: {
    type: 'page';
    path: string;
    state: 'queued' | 'loading' | 'recorded' | 'retrying' | 'skipped';
    reason?: RouteSkipReason;
  }) => void;
  /** Clock seam for tests. */
  now?: () => number;
  /** Timer seam for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Check start address during outage probe (default: probes startUrl with outboundFetch). */
  outageCheck?: (url: string) => Promise<boolean>;
  /** Called when the start page is loaded to check for interstitial or refusal before crawl proceeds. */
  onStartPage?: (
    page: Page,
    navRes: NavigateResult
  ) => Promise<{ blocked?: InterstitialKind; startError?: { code: string; message: string } } | void>;
}

/** Links and buttons that would end a signed-in session. */
export const SESSION_ENDING = /log\s*-?\s*out|sign\s*-?\s*out|log\s*off|signoff/i;
/** Never clicked while exploring: they change or send things. */
export const RISKY_TO_CLICK =
  /reset|delete|remove|destroy|clear|cancel|pay|purchase|buy|place order|subscribe|send|submit|finish|confirm|save|apply|upload|download|print|share|invite|deactivate|close/i;
/** Buttons whose name suggests they only move to another screen. */
export const NAVIGATION_WORDS =
  /checkout|cart|basket|bag|view|details|more|next|continue|back|browse|shop|start|explore|profile|account|settings|dashboard|home|open|target/i;
/** Fields a sign-in form asks for: a password, an e-mail address, a user name or a one-time code. */
const CREDENTIAL_FIELD = /user|email|login|otp|code|phone|token/i;

/**
 * Whether the page is nothing but the site's way in: exactly one visible form asks for a password, it is
 * the only visible form, and every field in it could be a sign-in field. A page that shows a password
 * field beside other fields — a change-password form, a two-factor step — is a page like any other, not a
 * wall a Role has to get past (LC-002).
 */
export function isSignInOnlyForm(forms: ReadForm[]): boolean {
  const visible = forms.filter((f) => f.visible);
  const withPassword = visible.filter((f) => f.inputs.some((i) => i.type === 'password'));
  if (withPassword.length !== 1) return false;
  if (visible.some((f) => f !== withPassword[0])) return false;
  return withPassword[0].inputs.every(
    (i) =>
      i.type === 'password' || i.type === 'email' || i.type === 'tel' || CREDENTIAL_FIELD.test(`${i.name} ${i.label}`)
  );
}

const MAX_CLICKS_PER_PAGE = 8;
const MAX_EXPLORATION_CLICKS = 100;
/** Pages a crawl visits at most: enough to list a whole site, not so many that a shop's catalogue runs for hours. */
export const DEFAULT_MAX_PAGES = 200;
/** Bytes read per robots.txt or sitemap file while seeding; a larger file is skipped. */
const SITEMAP_MAX_BYTES = 10_000_000;

function isLoopback(h: string): boolean {
  const hostWithoutPort = h.replace(/:\d+$/, '').toLowerCase();
  return hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1';
}

function isSameSiteOrLoopback(h1: string, h2: string): boolean {
  if (isSameSite(h1, h2)) return true;
  const p1 = h1.match(/:(\d+)$/)?.[1] || '';
  const p2 = h2.match(/:(\d+)$/)?.[1] || '';
  if (p1 === p2 && isLoopback(h1) && isLoopback(h2)) return true;
  return false;
}

/**
 * The page's visible links and where each goes, from its element inventory: the facts Navigation
 * Checks are planned from. Links that end a session, open mail or phone apps, or point at the same
 * page from its content are left out. A link on the site keeps only its path, the way pages are told apart.
 */
export function pageLinks(elements: ElementInventoryItem[], pageUrl: string, onSite: (u: URL) => boolean): PageLink[] {
  const here = new URL(pageUrl);
  const links: PageLink[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    if (el.role !== 'link' || !el.href || !el.visible || el.transient) continue;
    if (el.href.startsWith('#') || /^(javascript|mailto|tel|sms):/i.test(el.href)) continue;
    if (SESSION_ENDING.test(el.name) || SESSION_ENDING.test(el.href)) continue;
    let target: URL;
    try {
      target = new URL(el.href, pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(target.protocol) || seen.has(el.selector)) continue;
    const leavesSite = !onSite(target);
    // A link to this same page is kept in a menu (the menu is the same on every page) but not in the content.
    if (!leavesSite && target.pathname === here.pathname && !el.landmark) continue;
    seen.add(el.selector);
    links.push({
      name: el.name,
      selector: el.selector,
      to: leavesSite ? redactUrl(target.origin + target.pathname + target.search) : target.pathname,
      leavesSite: leavesSite || undefined,
      landmark: el.landmark,
    });
  }
  return links;
}

/** A short fingerprint of a page's controls and forms: the same on the next run when the page hasn't changed. */
export function contentKeyOf(elements: ElementInventoryItem[], formCount: number): string {
  const text = [...elements.map((el) => `${el.role}|${el.name}|${el.selector}`).sort(), `forms:${formCount}`].join(
    '\n'
  );
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** Every form on the page as it is now, with whether a person could see it. */
export async function readPageForms(page: Page): Promise<ReadForm[]> {
  return page.$$eval(
    'form',
    (formEls, testIdAttributes) =>
      formEls.map((f) => {
        const action = f.getAttribute('action') || '';
        const method = (f.getAttribute('method') || 'GET').toUpperCase();
        const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
        // Quoted attribute value: a backslash or a double quote in it would end the selector early.
        const quoted = (v: string | null) => `"${(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        // An id as a selector; ids like ":r1:" (React) need escaping.
        const byId = (v: string) => `#${CSS.escape(v)}`;
        const testIdSelector = (el: Element) => {
          const attr = testIdAttributes.find((a) => el.hasAttribute(a));
          return attr ? `[${attr}=${quoted(el.getAttribute(attr))}]` : null;
        };
        const inputs = Array.from(f.querySelectorAll('input:not([type="hidden"]), select, textarea')).map((inp) => {
          const name = inp.getAttribute('name') || '';
          const type = inp.getAttribute('type') || inp.tagName.toLowerCase();
          const id = inp.getAttribute('id');
          const ariaLabel = clean(inp.getAttribute('aria-label'));
          const placeholder = clean(inp.getAttribute('placeholder'));
          const selector =
            testIdSelector(inp) ||
            (id
              ? byId(id)
              : name
                ? `[name=${quoted(name)}]`
                : ariaLabel
                  ? `[aria-label=${quoted(ariaLabel)}]`
                  : placeholder
                    ? `[placeholder=${quoted(placeholder)}]`
                    : `${inp.tagName.toLowerCase()}[type=${quoted(type)}]`);
          const required = inp.hasAttribute('required');
          const forLabel = id ? document.querySelector(`label[for=${quoted(id)}]`) : null;
          const wrapping = inp.closest('label')?.cloneNode(true) as Element | undefined;
          wrapping?.querySelectorAll('input, select, textarea').forEach((c) => c.remove());
          // What a person would call the field: its label, then placeholder, then id, then name.
          const label =
            clean(inp.getAttribute('aria-label')) ||
            clean(forLabel?.textContent) ||
            clean(wrapping?.textContent) ||
            clean(inp.getAttribute('placeholder')) ||
            clean(id) ||
            name;
          const attr = (n: string) => inp.getAttribute(n) ?? undefined;
          const num = (n: string) => {
            const v = inp.getAttribute(n);
            return v !== null && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
          };
          return {
            name,
            label,
            type,
            selector,
            required,
            pattern: attr('pattern'),
            min: attr('min'),
            max: attr('max'),
            minLength: num('minlength'),
            maxLength: num('maxlength'),
          };
        });

        const submitBtn = f.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        let submitSelector: string | undefined;
        if (submitBtn) {
          const sTestId = testIdSelector(submitBtn);
          const sId = submitBtn.getAttribute('id');
          // Tied to this form, so a page with two forms does not press the other one's button.
          const formId = f.getAttribute('id');
          const formAction = f.getAttribute('action');
          const formScope = formId ? `form${byId(formId)} ` : formAction ? `form[action=${quoted(formAction)}] ` : '';
          const kind =
            submitBtn.tagName.toLowerCase() === 'input'
              ? 'input[type="submit"]'
              : submitBtn.hasAttribute('type')
                ? 'button[type="submit"]'
                : 'button:not([type])';
          submitSelector = sTestId ? sTestId : sId ? byId(sId) : `${formScope}${kind}`;
        }

        // checkVisibility also sees through a closed <details>, which keeps its content out of the layout.
        const visible = f.getClientRects().length > 0 && f.checkVisibility({ checkVisibilityCSS: true });
        return { action, method, inputs, submitButtonSelector: submitSelector, visible };
      }),
    TEST_ID_ATTRIBUTES
  );
}

export class DeterministicSpider {
  private safetyFilter: SafetyFilter;
  private maxPages: number;

  constructor(forbiddenActions: string[] = [], maxPages = DEFAULT_MAX_PAGES) {
    this.safetyFilter = new SafetyFilter(forbiddenActions);
    this.maxPages = maxPages;
  }

  async crawl(context: BrowserContext, targetUrl: string, options: CrawlOptions = {}): Promise<SpiderResult> {
    const concurrency = Math.max(1, Math.min(5, options.concurrency ?? 2));
    const pageDelayMs = options.pageDelayMs !== undefined ? options.pageDelayMs : 100;
    const maxAttempts = options.maxAttempts ?? this.maxPages * 3;
    const stopAfterWalls = options.stopAfterWalls ?? 3;
    const isRoleSignedIn = Boolean(options.isSignedIn || (options.role && options.role !== 'visitor'));

    const baseUrlObj = new URL(targetUrl);
    // The site is where the start address lands: example.com that redirects to www.example.com is
    // crawled as www.example.com. Until a page has opened, it's the address as typed.
    let site = new URL(baseUrlObj.origin);
    let landedOnce = false;
    let startRedirectedOffSite = false;
    let sessionLost = false;
    let consecutiveWalls = 0;
    const onSite = (u: URL) => isSameSiteOrLoopback(u.host, site.host);
    const exploreClicks = options.exploreClicks ?? true;
    const maxDepth = options.maxDepth ?? 8;
    const maxPerShape = options.maxPerShape ?? 25;
    const envMinutes = process.env.QA_CRAWL_MAX_MINUTES ? parseInt(process.env.QA_CRAWL_MAX_MINUTES, 10) : undefined;
    const defaultMaxDurationMs = envMinutes && !isNaN(envMinutes) ? envMinutes * 60 * 1000 : 10 * 60 * 1000;
    const maxDurationMs = options.maxDurationMs ?? defaultMaxDurationMs;
    const pageTimeoutMs = options.pageTimeoutMs ?? 10_000;
    const clockNow = options.now ?? Date.now;
    const clockSleep =
      options.sleep ??
      ((ms: number, sig?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (sig?.aborted) return reject(sig.reason ?? new DOMException('Aborted', 'AbortError'));
          const onAb = () => {
            clearTimeout(t);
            reject(sig?.reason ?? new DOMException('Aborted', 'AbortError'));
          };
          const t = setTimeout(() => {
            sig?.removeEventListener('abort', onAb);
            resolve();
          }, ms);
          sig?.addEventListener('abort', onAb, { once: true });
        }));

    const startTime = clockNow();
    const deadline = Math.min(options.deadlineAt ?? Infinity, startTime + maxDurationMs);
    let timedOut = false;
    /** Milliseconds left before the deadline (Infinity when there is none). */
    const timeLeft = () => deadline - clockNow();
    /** A wait or timeout cut to the time left, so work started near the deadline cannot overrun it. */
    const capToDeadline = (ms: number) => Math.max(1, Math.min(ms, timeLeft()));
    /** Navigation limits that fit inside the time left: no retry, and a shorter settle, once time is short. */
    const navLimits = (timeoutMs: number) => {
      const left = timeLeft();
      return {
        timeoutMs: capToDeadline(timeoutMs),
        settleMs: Math.max(0, Math.min(3000, Math.floor(left / 2))),
        ...(left < timeoutMs * 2.5 ? { retries: 0 } : {}),
      };
    };

    // With a pacer, requests to the host take turns; waiting for a turn stops at the deadline or on abort.
    const pacer = options.pacer;
    const pacerSignal = pacer
      ? AbortSignal.any([
          AbortSignal.timeout(Math.max(0, Math.min(deadline - clockNow(), 2 ** 31 - 1))),
          ...(options.signal ? [options.signal] : []),
        ])
      : undefined;
    /** Runs `task` in the host's turn when there is a pacer; straight away otherwise. */
    const paced = <T>(url: string, task: () => Promise<T>): Promise<T> =>
      pacer ? pacer.run(new URL(url).host, task, pacerSignal) : task();

    const frontier = new CrawlFrontier({
      maxPerShape,
      maxDepth,
      routeQueryParams: options.routeQueryParams,
      includeHash: options.includeHash,
    });
    const normRoute = (u: string) =>
      normalizeRoute(u, site.toString(), {
        routeQueryParams: options.routeQueryParams,
        includeHash: options.includeHash,
      });
    const loggedTrapShapes = new Set<string>();

    interface QueueItem {
      url: string;
      depth: number;
    }
    const queue: QueueItem[] = [];

    let consecutiveNetFailures = 0;
    let isOutagePaused = false;
    let stoppedAnswering = false;
    let stoppedAnsweringAfter: number | undefined;
    let startBlocked: InterstitialKind | undefined;
    let startRefused: { code: string; message: string } | undefined;
    const outageFailedPages: Array<{ item: QueueItem; path: string; asAsked: string }> = [];
    const outageRetriedKeys = new Set<string>();
    const requeuedKeys = new Set<string>();

    let activeWorkers = 0;
    let attemptsCount = 0;
    let idleResolvers: (() => void)[] = [];
    const notifyWork = () => {
      const resolvers = idleResolvers;
      idleResolvers = [];
      for (const r of resolvers) r();
    };
    const onAbort = () => notifyWork();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const skipped: SkippedPageInfo[] = [];
    /** Every Skipped Page goes through here, so `onSkipped` hears of each entry exactly once. */
    const skip = (info: SkippedPageInfo) => {
      skipped.push(info);
      options.onSkipped?.(info);
      options.onPageProgress?.({ type: 'page', path: info.urlPath, state: 'skipped', reason: info.why });
    };
    /** Route keys `admitPath` turned away: asked once per address, listed once. */
    const refusedKeys = new Set<string>();
    /**
     * Addresses found only beyond the max depth, by route key. Listed once the crawl ends, and only if the
     * address was never reached by a shorter path, so a page is never both recorded and skipped.
     */
    const tooDeep = new Map<string, string>();

    const enqueue = (rawUrl: string, depth: number, isStart = false) => {
      if (options.signal?.aborted || sessionLost || startRedirectedOffSite || stoppedAnswering) return;
      if (clockNow() >= deadline) {
        timedOut = true;
        return;
      }
      let u: URL;
      try {
        u = new URL(rawUrl, site);
      } catch {
        return;
      }
      if (!onSite(u)) return;

      if (options.admitPath && !isStart) {
        const key = normRoute(u.toString()).key;
        if (refusedKeys.has(key) || frontier.has(key)) return;
        const verdict = options.admitPath(u, depth);
        if (verdict) {
          refusedKeys.add(key);
          skip({
            urlPath: redactUrl(u.pathname),
            why: verdict.why,
            ...(verdict.detail ? { detail: verdict.detail } : {}),
          });
          return;
        }
      }

      const admitted = frontier.admit(u.toString(), site.toString(), depth);
      if (!admitted.admit) {
        if (admitted.reason === 'depth-limit') {
          if (!tooDeep.has(admitted.key)) tooDeep.set(admitted.key, redactUrl(u.pathname));
          return;
        }
        if (admitted.reason === 'trap-limit') {
          const shape = frontier.getShape(u.toString(), site.toString());
          if (!loggedTrapShapes.has(shape)) {
            loggedTrapShapes.add(shape);
            debugLog('crawl', 'shape limit reached', {
              shape,
              path: redactUrl(u.pathname + u.search),
            });
          }
          skip({ urlPath: redactUrl(u.pathname), why: 'trap-limit' });
        }
        return;
      }

      queue.push({ url: u.toString(), depth });
      options.onPageProgress?.({ type: 'page', path: redactUrl(u.pathname), state: 'queued' });
      notifyWork();
    };

    for (const start of [...(options.startPaths || []), baseUrlObj.pathname + baseUrlObj.search || '/']) {
      enqueue(start, 0, true);
    }

    // Sitemap seeding (crawls /sitemap.xml and robots.txt Sitemap: lines) through the pinned outbound
    // path (ADR 0031). Only addresses on the target's site are read; other hosts are logged and skipped.
    if (options.seedSitemap !== false && timeLeft() > 0 && !options.signal?.aborted) {
      // Each default fetch's timeout is cut to the time left, so seeding cannot run past the deadline.
      const unpacedFetch: FetchFn =
        options.outboundFetch ??
        ((url) =>
          timeLeft() <= 0
            ? Promise.resolve(null)
            : makeOutboundFetch({
                maxBytes: SITEMAP_MAX_BYTES,
                timeoutMs: capToDeadline(10000),
                ...(options.customHeaders ? { headers: options.customHeaders } : {}),
              })(url));
      // A fetch already paced by the same pacer runs inside this turn rather than waiting for it.
      const outboundFetch: FetchFn = pacer ? (url) => paced(url, () => unpacedFetch(url)) : unpacedFetch;
      const sitemapOnSite = (u: URL) =>
        (u.protocol === 'http:' || u.protocol === 'https:') && (sameSiteUrl(u, site) || onSite(u));
      try {
        const sitemapUrls = [new URL('/sitemap.xml', site).toString()];
        try {
          const robotsRes = await outboundFetch(new URL('/robots.txt', site).toString());
          if (robotsRes && robotsRes.status >= 200 && robotsRes.status < 300) {
            const robotsText = await robotsRes.text();
            for (const line of robotsText.split(/\r?\n/)) {
              const m = line.match(/^\s*sitemap:\s*(.+)$/i);
              if (m && m[1]) {
                const sm = m[1].trim();
                let smUrl: URL;
                try {
                  smUrl = new URL(sm, site);
                } catch {
                  continue;
                }
                if (!sitemapOnSite(smUrl)) {
                  debugLog('crawl', 'sitemap on another host skipped', { url: smUrl.toString() });
                  continue;
                }
                if (!sitemapUrls.includes(smUrl.toString())) sitemapUrls.push(smUrl.toString());
              }
            }
          }
        } catch {
          // Ignore robots fetch failure for sitemap
        }

        let locCount = 0;
        for (const smUrl of sitemapUrls) {
          if (locCount >= 200 || timeLeft() <= 0 || options.signal?.aborted) break;
          try {
            const res = await outboundFetch(smUrl);
            if (!res || res.status < 200 || res.status >= 300) continue;
            const text = await res.text();
            const isIndex = /<sitemapindex/i.test(text);
            const matches = text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
            for (const m of matches) {
              if (m[1]) {
                const loc = m[1].trim();
                try {
                  const locUrl = new URL(loc, site);
                  if (!sitemapOnSite(locUrl)) {
                    debugLog('crawl', 'sitemap entry on another host skipped', { url: locUrl.toString() });
                    continue;
                  }
                  if (isIndex || (loc.endsWith('.xml') && !loc.endsWith('.html'))) {
                    if (sitemapUrls.length < 25 && !sitemapUrls.includes(locUrl.toString())) {
                      sitemapUrls.push(locUrl.toString());
                    }
                  } else {
                    enqueue(loc, 1);
                    locCount++;
                    if (locCount >= 200) break;
                  }
                } catch {}
              }
            }
          } catch (err) {
            debugLog('crawl', 'sitemap fetch failed', { url: smUrl, error: String(err) });
          }
        }
      } catch (err) {
        debugLog('crawl', 'sitemap seeding failed', { error: String(err) });
      }
    }

    const pages: SpiderPageInventoryItem[] = [];
    const forms: DiscoveredFormInfo[] = [];
    const sensitiveActions: SensitiveAction[] = [];
    const ambiguityQuestions: AmbiguityQuestion[] = [];
    const signInWalls: string[] = [];
    const skippedByRobots: string[] = [];
    const routes: RouteTelemetry[] = [];
    /** Addresses the site redirected elsewhere on the site, so a link to one is expected to land on the other. */
    const redirects = new Map<string, string>();
    let questionCounter = 1;
    let clickBudget = MAX_EXPLORATION_CLICKS;
    let screenshotIndex = 0;
    if (options.screenshotDir) await fs.mkdir(options.screenshotDir, { recursive: true });

    // Shared pacing clock across all workers
    let lastLoadAt = 0;
    const waitForPacing = async () => {
      if (pageDelayMs > 0) {
        const now = clockNow();
        const waitMs = Math.max(0, lastLoadAt + pageDelayMs - now);
        if (waitMs > 0) {
          lastLoadAt = Math.max(lastLoadAt, now) + pageDelayMs;
          await clockSleep(Math.max(0, Math.min(waitMs, timeLeft())), options.signal);
        } else {
          lastLoadAt = now;
        }
      }
    };

    const waitForWork = () =>
      new Promise<void>((resolve) => {
        if (options.signal?.aborted || sessionLost || startRedirectedOffSite) return resolve();
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            idleResolvers = idleResolvers.filter((r) => r !== onWake);
            resolve();
          }
        }, 50);
        const onWake = () => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve();
          }
        };
        idleResolvers.push(onWake);
      });

    const evaluatePage = async (
      page: Page,
      requested: string,
      requestedPath: string,
      requestedDepth = 0,
      /** True when this visit is the retry that followed a mid-crawl session restore. */
      retried = false
    ) => {
      const requestedUrl = new URL(requested, site);
      const fullUrl = requestedUrl.toString();
      // The path as it was asked for, for anything a person reads. `requestedPath` is the route key
      // (lower-cased, trailing slash trimmed) and exists only so the frontier does not crawl a page twice (LC-009).
      const requestedAsAsked = redactUrl(requestedUrl.pathname);
      // The policy takes a path and query (RFC 9309), not an absolute URL: a `/`-rooted rule cannot match
      // `https://…`, so passing the URL left every rule dead (LC-001). One policy, for the start origin;
      // judging a rebased origin by its own robots.txt is a follow-up.
      if (options.robots && !options.robots.isAllowed(requestedUrl.pathname + requestedUrl.search)) {
        skippedByRobots.push(requestedAsAsked);
        skip({ urlPath: requestedAsAsked, why: 'robots' });
        const rTel: RouteTelemetry = {
          requestedPath: redactUrl(requestedPath),
          outcome: 'skipped',
          skipReason: 'robots',
          attempts: 0,
          durationMs: 0,
          who: options.role || (isRoleSignedIn ? 'signed-in' : 'visitor'),
        };
        routes.push(rTel);
        debugLog('crawl', 'route skipped by robots', {
          path: rTel.requestedPath,
          outcome: 'skipped',
          reason: 'robots',
          attempts: 0,
          ms: 0,
        });
        return;
      }

      let recorded = false;
      let exploreErrors = 0;

      while (isOutagePaused && !options.signal?.aborted && !stoppedAnswering) {
        await waitForWork();
      }
      if (stoppedAnswering || options.signal?.aborted || startBlocked || startRefused) return;

      options.onPageProgress?.({ type: 'page', path: requestedAsAsked, state: 'loading' });

      try {
        if (!pacer) await waitForPacing();
        // Opened after the deadline: not loaded, counted with the rest of the time-limit skips.
        if (timeLeft() <= 0) {
          timedOut = true;
          skip({ urlPath: requestedAsAsked, why: 'time-limit' });
          return;
        }

        let navRes;
        try {
          // Limits are worked out once the turn comes, from the time left then.
          navRes = await paced(fullUrl, () =>
            navigate(page, fullUrl, {
              ...navLimits(pageTimeoutMs),
              needLinks: true,
              who: options.role || (isRoleSignedIn ? 'signed-in' : 'visitor'),
              retryDelayMs: options.retryDelayMs,
              onRetry: () => {
                options.onPageProgress?.({ type: 'page', path: requestedAsAsked, state: 'retrying' });
              },
            })
          );
        } catch (err: unknown) {
          // The wait for the host's turn ended at the deadline or on abort: the page was never requested.
          if (pacerSignal?.aborted) {
            if (timeLeft() <= 0) {
              timedOut = true;
              skip({ urlPath: requestedAsAsked, why: 'time-limit' });
            }
            return;
          }
          const detail = err instanceof Error ? err.name : 'other';
          const rTel: RouteTelemetry = {
            requestedPath: redactUrl(requestedPath),
            outcome: 'skipped',
            skipReason: 'did-not-load',
            detail,
            attempts: 1,
            durationMs: 0,
            who: options.role || (isRoleSignedIn ? 'signed-in' : 'visitor'),
          };
          routes.push(rTel);
          skip({ urlPath: requestedAsAsked, why: 'did-not-load', detail });
          debugLog('crawl', 'route navigation failed', {
            path: rTel.requestedPath,
            outcome: 'skipped',
            reason: 'did-not-load',
            attempts: 1,
            ms: 0,
          });
          return;
        }

        if (requestedDepth === 0 && options.onStartPage) {
          const check = await options.onStartPage(page, navRes);
          if (check?.blocked) {
            startBlocked = check.blocked;
            return;
          }
          if (check?.startError) {
            startRefused = check.startError;
            return;
          }
        }

        // The host says it is busy or answers 5xx (ADR 0043): slow down on 429/503, retry once
        if (
          pacer &&
          options.retryBusyHost &&
          navRes.ok &&
          (navRes.status === 429 || (navRes.status !== undefined && navRes.status >= 500 && navRes.status < 600))
        ) {
          if (navRes.status === 429 || navRes.status === 503) {
            pacer.slowDown(new URL(fullUrl).host, navRes.retryAfterMs);
          }
          options.onPageProgress?.({ type: 'page', path: requestedAsAsked, state: 'retrying' });
          try {
            const again = await paced(fullUrl, () =>
              navigate(page, fullUrl, {
                ...navLimits(pageTimeoutMs),
                needLinks: true,
                who: options.role || (isRoleSignedIn ? 'signed-in' : 'visitor'),
                retryDelayMs: options.retryDelayMs,
                onRetry: () => {
                  options.onPageProgress?.({ type: 'page', path: requestedAsAsked, state: 'retrying' });
                },
              })
            );
            navRes = { ...again, attempts: navRes.attempts + again.attempts };
          } catch {
            // The wait ended at the deadline or on abort: the first answer stands.
          }
        }

        const landed = new URL(navRes.finalUrl || page.url());
        const telemetry = toTelemetry(navRes, requestedPath, {
          who: options.role || (isRoleSignedIn ? 'signed-in' : 'visitor'),
        });

        // One page-limit skip, so the wording and the telemetry row cannot drift between the early gate and
        // the race guard. Callers return on true; nothing of the page's work is kept.
        const skipForPageLimit = (): boolean => {
          if (pages.length < this.maxPages) return false;
          telemetry.outcome = 'skipped';
          telemetry.skipReason = 'page-limit';
          routes.push(telemetry);
          skip({ urlPath: requestedAsAsked, why: 'page-limit' });
          debugLog('crawl', 'route hit the page limit', {
            path: telemetry.requestedPath,
            status: telemetry.status,
            finalPath: telemetry.finalPath,
            outcome: 'skipped',
            reason: 'page-limit',
            attempts: telemetry.attempts,
            ms: telemetry.durationMs,
          });
          return true;
        };

        // Classification 1: Navigation did not succeed (timeout, network error)
        if (!navRes.ok) {
          if (navRes.error?.kind === 'net') {
            consecutiveNetFailures++;
            outageFailedPages.push({
              item: { url: requested, depth: requestedDepth },
              path: requestedPath,
              asAsked: requestedAsAsked,
            });
          } else {
            consecutiveNetFailures = 0;
            outageFailedPages.length = 0;
          }

          // A load cut short by the crawl's own deadline is a time-limit skip, not a slow page.
          const skipWhy: RouteSkipReason =
            timeLeft() <= 0 ? 'time-limit' : navRes.error?.kind === 'timeout' ? 'timeout' : 'did-not-load';
          if (skipWhy === 'time-limit') timedOut = true;
          const detail = navRes.error?.kind === 'timeout' ? `${navRes.durationMs}ms` : navRes.error?.kind || 'net';
          telemetry.outcome = 'skipped';
          telemetry.skipReason = skipWhy;
          telemetry.detail = detail;
          routes.push(telemetry);
          skip({ urlPath: requestedAsAsked, why: skipWhy, status: navRes.status, detail });
          debugLog('crawl', 'route failed to load', {
            path: telemetry.requestedPath,
            status: telemetry.status,
            finalPath: telemetry.finalPath,
            outcome: 'skipped',
            reason: skipWhy,
            attempts: telemetry.attempts,
            ms: telemetry.durationMs,
          });

          if (consecutiveNetFailures >= 3 && !isOutagePaused) {
            isOutagePaused = true;
            const probeFn =
              options.outageCheck ??
              (async (u: string) => {
                const fetchFn =
                  options.outboundFetch ??
                  makeOutboundFetch({
                    timeoutMs: 5000,
                  });
                try {
                  const r = await fetchFn(u);
                  return r !== null && r.status > 0;
                } catch {
                  return false;
                }
              });
            let answered = false;
            const intervalMs = 10_000;
            const maxWaitMs = 60_000;
            let elapsed = 0;
            while (elapsed < maxWaitMs && !options.signal?.aborted && timeLeft() > 0) {
              // Never sleep past the crawl deadline.
              const wait = capToDeadline(intervalMs);
              await clockSleep(wait, options.signal);
              elapsed += wait;
              if (options.signal?.aborted || timeLeft() <= 0) break;
              try {
                const ok = await probeFn(targetUrl);
                if (ok) {
                  answered = true;
                  break;
                }
              } catch {}
            }

            if (answered) {
              consecutiveNetFailures = 0;
              isOutagePaused = false;
              for (const failed of outageFailedPages) {
                if (!outageRetriedKeys.has(failed.path)) {
                  outageRetriedKeys.add(failed.path);
                  requeuedKeys.add(failed.path);
                  queue.unshift(failed.item);
                  const sIdx = skipped.findIndex((s) => s.urlPath === failed.asAsked);
                  if (sIdx !== -1) skipped.splice(sIdx, 1);
                  const rIdx = routes.findIndex((r) => r.requestedPath === redactUrl(failed.path));
                  if (rIdx !== -1) routes.splice(rIdx, 1);
                  options.onPageProgress?.({ type: 'page', path: failed.asAsked, state: 'queued' });
                }
              }
              outageFailedPages.length = 0;
              notifyWork();
            } else {
              stoppedAnswering = true;
              stoppedAnsweringAfter = pages.length;
              isOutagePaused = false;
              notifyWork();
            }
          }
          return;
        }

        consecutiveNetFailures = 0;
        outageFailedPages.length = 0;

        // Classification 2: Bounce / sign-in wall / session loss (Scope 6)
        // Must be checked before first-landing rebase so a start URL sent to another host's sign-in
        // service does not move the site to that service.
        const hasSignInForm = await looksLikeLogin(page, options.knownLoginPaths);
        const isLoginPath = options.knownLoginPaths?.includes(landed.pathname);
        // Compare like with like: the requested path against the route key (lower-cased, trailing slash
        // trimmed) is what made an ordinary page look like a bounce (LC-002).
        const bouncedAway = normRoute(landed.toString()).key !== normRoute(requested).key;
        // A password field is a wall only when the page is nothing but the site's way in. A page that shows
        // one beside other fields is recorded like any other page, and the reason it was decided is kept.
        const wallReason =
          navRes.status === 401
            ? 'http-401'
            : hasSignInForm && isLoginPath
              ? 'login-path'
              : hasSignInForm && bouncedAway && isSignInOnlyForm(await readPageForms(page))
                ? 'sign-in-form'
                : undefined;

        if (wallReason) {
          // Ask for a fresh session while there is still a crawl to save. A recovered route is retried once,
          // and the retry's row is that route's only row, so recovery leaves no hole in the route table (LC-003).
          let recovered = false;
          if (isRoleSignedIn) {
            if (!retried && options.reloginHandler) {
              debugLog('crawl', 'attempting mid-crawl session recovery', { role: options.role });
              try {
                recovered = await options.reloginHandler();
              } catch (rErr) {
                debugLog('crawl', 'mid-crawl session recovery failed', { role: options.role });
              }
              // A sign-in that succeeds is not yet a restored session: the retried route must load (the reset
              // below) before the walls stop counting, or a site that bounces every page never reports the loss.
              if (recovered) debugLog('crawl', 'mid-crawl session restored', { role: options.role });
            }
            if (!recovered) {
              consecutiveWalls++;
              if (consecutiveWalls >= stopAfterWalls) sessionLost = true;
            }
          }

          if (recovered) {
            // The route is not lost: this visit is retried once, now that the session works again. The
            // frontier already holds the key, so it is re-run here rather than admitted again.
            await evaluatePage(page, requested, requestedPath, requestedDepth, true);
            return;
          }

          signInWalls.push(requestedAsAsked);
          const skipWhy: RouteSkipReason = isRoleSignedIn ? 'session-lost' : 'sign-in';
          telemetry.outcome = 'skipped';
          telemetry.skipReason = skipWhy;
          telemetry.detail = wallReason;
          routes.push(telemetry);
          skip({ urlPath: requestedAsAsked, why: skipWhy, status: navRes.status });
          debugLog('crawl', 'route hit sign-in wall or session loss', {
            path: telemetry.requestedPath,
            status: telemetry.status,
            finalPath: telemetry.finalPath,
            outcome: 'skipped',
            reason: skipWhy,
            attempts: telemetry.attempts,
            ms: telemetry.durationMs,
          });

          // Only enqueue if the sign-in form is on the exact same site/host as the crawl
          if (!isRoleSignedIn && onSite(landed) && landed.host.toLowerCase() === site.host.toLowerCase()) {
            redirects.set(requestedPath, normalizeRoute(landed.toString(), site.toString()).path);
            enqueue(landed.pathname + landed.search, requestedDepth + 1);
          }
          return;
        } else {
          consecutiveWalls = 0;
        }

        // Classification 3: First landing rebase rule (Scope 7)
        if (!landedOnce && (navRes.status === undefined || navRes.status < 400)) {
          if (isSameSiteOrLoopback(landed.host, site.host)) {
            landedOnce = true;
            site = new URL(landed.origin);
          } else {
            // First landing redirected off-site!
            startRedirectedOffSite = true;
            telemetry.outcome = 'skipped';
            telemetry.skipReason = 'off-site-redirect';
            routes.push(telemetry);
            skip({ urlPath: requestedAsAsked, why: 'off-site-redirect', status: navRes.status });
            debugLog('crawl', 'start address redirected off-site', {
              path: telemetry.requestedPath,
              status: telemetry.status,
              finalPath: telemetry.finalPath,
              outcome: 'skipped',
              reason: 'off-site-redirect',
              attempts: telemetry.attempts,
              ms: telemetry.durationMs,
            });
            return;
          }
        }

        // Classification 4: Off-site redirect
        if (!onSite(landed)) {
          telemetry.outcome = 'skipped';
          telemetry.skipReason = 'off-site-redirect';
          routes.push(telemetry);
          skip({
            urlPath: requestedAsAsked,
            why: 'off-site-redirect',
            status: navRes.status,
            finalPath: redactUrl(landed.pathname + landed.search),
          });
          debugLog('crawl', 'route redirected off-site', {
            path: telemetry.requestedPath,
            status: telemetry.status,
            finalPath: telemetry.finalPath,
            outcome: 'skipped',
            reason: 'off-site-redirect',
            attempts: telemetry.attempts,
            ms: telemetry.durationMs,
          });
          return;
        }

        // Classification 5: HTTP >= 400 (not recorded in pages)
        if (navRes.status && navRes.status >= 400) {
          telemetry.outcome = 'skipped';
          telemetry.skipReason = 'http-error';
          routes.push(telemetry);
          skip({ urlPath: requestedAsAsked, why: 'http-error', status: navRes.status });
          debugLog('crawl', 'route returned http-error', {
            path: telemetry.requestedPath,
            status: telemetry.status,
            finalPath: telemetry.finalPath,
            outcome: 'skipped',
            reason: 'http-error',
            attempts: telemetry.attempts,
            ms: telemetry.durationMs,
          });
          return;
        }

        // Redirected within the site: the page is recorded once, under the address it really has.
        const currentPath = redactUrl(
          landed.pathname + landed.search + (options.includeHash && landed.hash ? landed.hash : '')
        );
        const landedNorm = normRoute(landed.toString());
        const requestedNorm = normRoute(requestedPath);
        if (landedNorm.key !== requestedNorm.key || navRes.redirectChain.length > 0) {
          redirects.set(requestedPath, currentPath);
          for (const fromUrl of navRes.redirectChain) {
            try {
              const fromU = new URL(fromUrl);
              redirects.set(fromU.pathname, currentPath);
            } catch {}
          }
          if (landedNorm.key !== requestedNorm.key) {
            if (frontier.has(landedNorm.key)) {
              telemetry.outcome = 'skipped';
              telemetry.skipReason = 'duplicate';
              routes.push(telemetry);
              debugLog('crawl', 'route redirected to already-visited path', {
                path: telemetry.requestedPath,
                status: telemetry.status,
                finalPath: telemetry.finalPath,
                outcome: 'skipped',
                reason: 'duplicate',
                attempts: telemetry.attempts,
                ms: telemetry.durationMs,
              });
              return;
            }
            frontier.markVisited(landedNorm.key);
          }
        }

        const pageUrl = page.url();
        const title = await page.title().catch(() => currentPath);

        // The gate: the page limit is checked before the page's inventory, so a full crawl does not pay for
        // elements, forms, a fingerprint and a screenshot it is about to throw away (LC-008).
        if (skipForPageLimit()) return;

        // The caller's own look at the page (a payment area, a sign-in wall): a verdict leaves it untouched,
        // before any overlay is dismissed, link followed or control clicked.
        const verdict = options.inspectPage ? await options.inspectPage(page, landed) : undefined;
        if (verdict) {
          telemetry.outcome = 'skipped';
          telemetry.skipReason = verdict.why;
          telemetry.detail = verdict.detail;
          routes.push(telemetry);
          if (verdict.why === 'sign-in') signInWalls.push(requestedAsAsked);
          const landedPath = redactUrl(landed.pathname);
          skip({
            urlPath: requestedAsAsked,
            why: verdict.why,
            status: navRes.status,
            ...(landedPath !== requestedAsAsked ? { finalPath: landedPath } : {}),
            ...(verdict.detail ? { detail: verdict.detail } : {}),
          });
          debugLog('crawl', 'route skipped on inspection', {
            path: telemetry.requestedPath,
            status: telemetry.status,
            finalPath: telemetry.finalPath,
            outcome: 'skipped',
            reason: verdict.why,
            attempts: telemetry.attempts,
            ms: telemetry.durationMs,
          });
          return;
        }

        // Dismiss overlays (cookie banners) before link extraction
        await dismissOverlays(page);

        // 1. Discover links (anchors, role=link, data-href, get-forms)
        const rawLinks = await page.evaluate((followFormActions) => {
          const results: Array<{ href: string; text: string }> = [];

          // (a) a[href]
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          for (const a of anchors) {
            if (a.closest('[data-transient="true"]')) continue;
            results.push({
              href: a.getAttribute('href') || '',
              text: (a.textContent || '').trim(),
            });
          }

          // (b) [role=link][data-href], [data-href], [role=link]
          const extraLinkEls = Array.from(document.querySelectorAll('[role="link"], [data-href]'));
          for (const el of extraLinkEls) {
            if (el.tagName.toLowerCase() === 'a') continue;
            if (el.closest('[data-transient="true"]')) continue;
            const href = el.getAttribute('href') || el.getAttribute('data-href') || '';
            if (href) {
              results.push({
                href,
                text: (el.textContent || '').trim(),
              });
            }
          }

          // (c) <form method=get action=...> without fields that need input
          const forms = followFormActions ? Array.from(document.querySelectorAll('form')) : [];
          for (const f of forms) {
            const method = (f.getAttribute('method') || 'get').toLowerCase();
            if (method !== 'get') continue;
            const hasSensitiveOrRequired = f.querySelector(
              'input[type="password"], input[type="file"], input[required], select[required], textarea[required]'
            );
            if (hasSensitiveOrRequired) continue;
            const action = f.getAttribute('action');
            if (action) {
              results.push({ href: action, text: 'form-get' });
            }
          }

          return results;
        }, options.followFormActions !== false);

        for (const { href, text } of rawLinks) {
          try {
            if (!href || href.startsWith('javascript:')) continue;
            if (SESSION_ENDING.test(href) || SESSION_ENDING.test(text)) continue;

            if (href.startsWith('#')) {
              if (options.includeHash) {
                const resolved = new URL(href, pageUrl);
                if (onSite(resolved)) {
                  enqueue(resolved.toString(), requestedDepth + 1);
                }
              }
              continue;
            }

            const resolved = new URL(href, pageUrl);
            if (onSite(resolved)) {
              enqueue(resolved.toString(), requestedDepth + 1);
            }
          } catch {
            // invalid URL ignored
          }
        }

        // 2. Discover interactive elements and check safety
        const elements = await collectElementInventory(page);
        const links = pageLinks(elements, pageUrl, onSite);

        for (const el of elements) {
          if (el.role !== 'button' && el.role !== 'link' && el.inputType !== 'submit') continue;
          const sensitive = this.safetyFilter.isSensitive(el.name, el.selector);
          if (sensitive) {
            sensitive.urlPath = currentPath;
            sensitiveActions.push(sensitive);
            const q = this.safetyFilter.createAmbiguityQuestion(sensitive, questionCounter++);
            ambiguityQuestions.push(q);
          }
        }

        // 3. Discover Forms
        const pageForms = (await readPageForms(page)).map(({ visible: _v, ...f }) => f);

        // Kept local until the page has its slot: workers share `forms`, so its tail is not this page's.
        const recordedForms = pageForms.map((f) => ({
          action: f.action,
          method: f.method,
          urlPath: currentPath,
          inputs: f.inputs,
          submitButtonSelector: f.submitButtonSelector,
        }));

        // The fingerprint itself names the group: the same template gets the same name in every
        // crawl (signed out or as any role) and on every run.
        const fingerprint = await readLayoutFingerprint(page);

        const pageItem: SpiderPageInventoryItem = {
          urlPath: currentPath,
          title,
          interactiveElementsCount: elements.length,
          formsCount: pageForms.length,
          elements,
          hasSignInForm: hasSignInForm || undefined,
          layoutGroup: fingerprint ? `layout-${fingerprint}` : undefined,
          links,
          contentKey: contentKeyOf(elements, pageForms.length),
          depth: requestedDepth,
        };
        // Race guard for the limit (workers share `pages`): the slot is taken before anything is written, so
        // `pages.length` never passes the limit and no screenshot is left for a page that is not in `pages`.
        if (skipForPageLimit()) return;
        pages.push(pageItem);
        forms.push(...recordedForms);
        if (options.screenshotDir) {
          screenshotIndex++;
          pageItem.screenshotPath = path.join(
            options.screenshotDir,
            `${options.screenshotPrefix || 'page'}-${screenshotIndex}.jpg`
          );
          await page
            .screenshot({ path: pageItem.screenshotPath, type: 'jpeg', quality: 55 })
            .catch(() => (pageItem.screenshotPath = undefined));
        }
        recorded = true;
        telemetry.outcome = 'recorded';
        telemetry.skipReason = undefined;
        if (retried) telemetry.detail = 'session-recovered';
        routes.push(telemetry);
        options.onPageProgress?.({ type: 'page', path: currentPath, state: 'recorded' });
        debugLog('crawl', 'route recorded', {
          path: telemetry.requestedPath,
          status: telemetry.status,
          finalPath: telemetry.finalPath,
          outcome: 'recorded',
          reason: undefined,
          attempts: telemetry.attempts,
          ms: telemetry.durationMs,
        });
        options.onPage?.(pageItem, pages.length, recordedForms);
        // Still the rendered page, before any exploring click changes it. A failing hook costs the caller
        // its own extract, not the crawl.
        if (options.onRecordedPage) {
          await options.onRecordedPage(page, pageItem).catch((err: unknown) => {
            debugLog('crawl', 'recorded-page hook failed', {
              path: telemetry.requestedPath,
              error: err instanceof Error ? err.name : 'other',
            });
          });
        }

        // 4. Single-page apps navigate by script: try the controls that look like navigation.
        if (exploreClicks && clickBudget > 0) {
          const tried = new Set<string>();
          const candidates = elements.filter((el) => {
            const key = el.name.toLowerCase();
            if (tried.has(key) || !this.isSafeToExplore(el)) return false;
            tried.add(key);
            return true;
          });
          const pageClickLimit = Math.min(MAX_CLICKS_PER_PAGE, candidates.length);
          for (const el of candidates.slice(0, pageClickLimit)) {
            if (timeLeft() <= 0) {
              timedOut = true;
              break;
            }
            if (clickBudget-- <= 0) break;
            try {
              if (page.url() !== pageUrl) {
                if (!pacer) await waitForPacing();
                if (timeLeft() <= 0) continue;
                await paced(pageUrl, () => navigate(page, pageUrl, navLimits(pageTimeoutMs)));
              }
              const urlBefore = page.url();
              // A click may load another page of the host, so with a pacer it takes a turn too.
              await paced(pageUrl, async () => {
                await page
                  .locator(el.selector)
                  .first()
                  .click({ timeout: capToDeadline(3000) });
                await Promise.race([
                  page.waitForURL((u) => u.toString() !== urlBefore, { timeout: capToDeadline(1500) }),
                  page.waitForTimeout(capToDeadline(250)),
                ]).catch(() => {});
              });
              const after = new URL(page.url());
              if (onSite(after)) {
                const normAfter = normRoute(after.toString());
                const normLanded = normRoute(landed.toString());
                if (normAfter.key !== normLanded.key) {
                  enqueue(after.toString(), requestedDepth + 1);
                  // A button or script link that moved to another page is navigation too.
                  if (!links.some((l) => l.selector === el.selector)) {
                    links.push({
                      name: el.name,
                      selector: el.selector,
                      to: normAfter.path,
                      scripted: true,
                      landmark: el.landmark,
                    });
                  }
                }
              }
            } catch {
              if (timeLeft() > 0) exploreErrors++;
            }
          }
        }

        // 5. Tabs, accordions, drawers and dialogs hide forms; list pages show how they are managed.
        // Guarded (ADR 0025): nothing is submitted, changing requests are aborted, dialogs dismissed.
        // Skipped once the deadline has passed: its own clicks are not limited by the time left.
        if (exploreClicks && clickBudget > 0 && onSite(landed) && timeLeft() > 0) {
          const reload = async () => {
            if (!pacer) await waitForPacing();
            if (timeLeft() <= 0) throw new Error('time-limit');
            await paced(pageUrl, () => navigate(page, pageUrl, navLimits(pageTimeoutMs)));
          };
          try {
            // Subtract after the await: `x -= await f()` reads x first and loses the other worker's spend.
            const spent = await exploreInteractiveStates({
              page,
              pageUrl,
              currentPath,
              elements,
              isSafe: (el) => this.isSafeOpener(el),
              readForms: readPageForms,
              allForms: forms,
              reload,
              budget: clickBudget,
            });
            clickBudget -= spent;
            if (page.url() !== pageUrl) await reload();
            if (timeLeft() <= 0) throw new Error('time-limit');
            const structure = await readCrudStructure(page);
            const crud = structure && inferCrud(structure);
            if (crud) {
              pageItem.crud = crud;
              // Heavily guarded probe: only a plain per-row delete, only when the Safety Filter sees an
              // ordinary deletion (a forbidden action keyword switches the probe off).
              if (
                structure.hasProbeTarget &&
                clickBudget > 0 &&
                this.safetyFilter.isSensitive('Delete', '')?.type === 'deletion'
              ) {
                clickBudget--;
                const confirmed = await probeDeleteConfirm(page);
                if (confirmed !== undefined) crud.deleteConfirm = confirmed;
              }
            }
          } catch {
            // Stopped by the deadline is not an exploration error.
            if (timeLeft() > 0) exploreErrors++;
            else timedOut = true;
          }
        }

        if (exploreErrors > 0) {
          pageItem.exploreErrors = exploreErrors;
        }
      } catch {
        // Only a page that was asked for and did not arrive. After a Stop nothing was asked for.
        if (!recorded && !options.signal?.aborted) {
          skip({ urlPath: requestedAsAsked, why: 'did-not-load' });
        }
      }
    };

    const runWorker = async () => {
      let workerPage: Page | null = null;
      try {
        workerPage = await context.newPage();
      } catch {
        return;
      }
      try {
        while (
          !options.signal?.aborted &&
          !sessionLost &&
          !startRedirectedOffSite &&
          !timedOut &&
          !stoppedAnswering &&
          !startBlocked &&
          !startRefused &&
          clockNow() < deadline &&
          pages.length < this.maxPages &&
          attemptsCount < maxAttempts
        ) {
          let requestedItem: QueueItem | null = null;
          let requestedPath = '';

          while (queue.length > 0) {
            const item = queue.shift()!;
            const norm = normRoute(item.url);
            if (!frontier.isVisited(norm.key) || requeuedKeys.has(norm.key)) {
              requeuedKeys.delete(norm.key);
              frontier.markVisited(norm.key);
              requestedItem = item;
              requestedPath = norm.key;
              break;
            }
          }

          if (requestedItem) {
            attemptsCount++;
            activeWorkers++;
            try {
              await evaluatePage(workerPage, requestedItem.url, requestedPath, requestedItem.depth);
            } finally {
              activeWorkers--;
              notifyWork();
            }
          } else {
            if (
              activeWorkers === 0 ||
              pages.length >= this.maxPages ||
              attemptsCount >= maxAttempts ||
              sessionLost ||
              startRedirectedOffSite ||
              timedOut ||
              stoppedAnswering ||
              startBlocked ||
              startRefused ||
              clockNow() >= deadline ||
              options.signal?.aborted
            ) {
              break;
            }
            await waitForWork();
          }
        }
      } finally {
        await workerPage.close().catch(() => {});
      }
    };

    const workers = Array.from({ length: concurrency }, () => runWorker());
    await Promise.all(workers);
    options.signal?.removeEventListener('abort', onAbort);

    // If deadline passed, session was lost, or maxPages reached: drain remaining queue entries
    if (timedOut || clockNow() >= deadline) {
      let count = 0;
      for (const left of queue) {
        const norm = normRoute(left.url);
        if (!frontier.isVisited(norm.key)) {
          skip({ urlPath: redactUrl(norm.path), why: 'time-limit' });
          count++;
          if (count >= 50) break;
        }
      }
      if (count === 0 && !skipped.some((s) => s.why === 'time-limit')) {
        skip({ urlPath: redactUrl(normRoute(targetUrl).path), why: 'time-limit' });
      }
    } else if (sessionLost) {
      let count = 0;
      for (const left of queue) {
        const norm = normRoute(left.url);
        if (!frontier.isVisited(norm.key)) {
          skip({ urlPath: redactUrl(norm.path), why: 'session-lost' });
          count++;
          if (count >= 50) break;
        }
      }
    } else if (pages.length >= this.maxPages && !options.signal?.aborted) {
      // Still queued when the page limit ended the crawl: found, never opened.
      for (const left of queue) {
        const norm = normRoute(left.url);
        if (!frontier.isVisited(norm.key)) skip({ urlPath: redactUrl(norm.path), why: 'page-limit' });
      }
    }

    // Found only beyond the max depth: one entry per address never reached by a shorter path.
    for (const [key, urlPath] of tooDeep) {
      if (!frontier.has(key)) skip({ urlPath, why: 'depth-limit' });
    }

    // A link to an address the site redirects is expected to land where the redirect goes.
    for (const recorded of pages) {
      for (const link of recorded.links || []) {
        const lands = link.leavesSite ? undefined : redirects.get(link.to);
        if (lands && lands !== link.to) link.landsOn = lands;
      }
    }

    return {
      pages,
      forms,
      sensitiveActions,
      ambiguityQuestions,
      signInWalls,
      skippedByRobots: skippedByRobots.length > 0 ? skippedByRobots : undefined,
      skipped: skipped.length > 0 ? skipped : undefined,
      routes,
      sessionLost,
      startRedirectedOffSite,
      ...(stoppedAnsweringAfter !== undefined ? { stoppedAnsweringAfter } : {}),
      ...(startBlocked ? { blocked: startBlocked } : {}),
      ...(startRefused ? { startRefused } : {}),
    };
  }

  /** Controls that may be opened to look for forms: not risky, not sensitive, not ending a session. */
  private isSafeOpener(el: ElementInventoryItem): boolean {
    if (!el.visible || !el.enabled || el.insideForm) return false;
    if (RISKY_TO_CLICK.test(el.name) || SESSION_ENDING.test(el.name)) return false;
    return !this.safetyFilter.isSensitive(el.name, el.selector);
  }

  /** Controls worth clicking to find script-driven pages: navigation-like, never risky. */
  private isSafeToExplore(el: ElementInventoryItem): boolean {
    if (!el.visible || !el.enabled || el.insideForm) return false;
    if (RISKY_TO_CLICK.test(el.name) || SESSION_ENDING.test(el.name)) return false;
    if (this.safetyFilter.isSensitive(el.name, el.selector)) return false;
    const scriptLink = el.role === 'link' && (!el.href || el.href === '#' || el.href.startsWith('javascript:'));
    const navButton = el.role === 'button' && NAVIGATION_WORDS.test(el.name);
    const inNavLandmark =
      (el.landmark === 'nav' || el.landmark === 'header') && (el.role === 'button' || el.role === 'link');
    return scriptLink || navButton || inNavLandmark;
  }
}
