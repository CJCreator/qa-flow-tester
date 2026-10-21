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
import { readLayoutFingerprint } from '../competitive/safe-crawler.js';
import type { RobotsPolicy } from '../competitive/robots.js';
import { exploreInteractiveStates, type ReadForm } from './interactive-states.js';
import { inferCrud, readCrudStructure, probeDeleteConfirm } from './crud-facts.js';
import { navigate, toTelemetry, looksLikeLogin } from '../navigate.js';
import { debugLog } from '../debug-log.js';
import { safeGet } from '../safe-net.js';
import { getBrowserPolicy } from '../browser.js';
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
}

export type SkippedPage = SkippedPageInfo;

export interface CrawlOptions {
  /** Where to start besides the target URL, e.g. the page a role landed on after signing in. */
  startPaths?: string[];
  /** Click script-driven links and navigation buttons to find pages links alone don't reach. Default true. */
  exploreClicks?: boolean;
  /** Pages robots.txt asks crawlers to leave alone are skipped (public sites). */
  robots?: RobotsPolicy;
  /** Minimum pause between page loads, to go easy on a site we don't own. Default 100ms. */
  pageDelayMs?: number;
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
  /** Epoch ms deadline shared across crawls */
  deadlineAt?: number;
  /** Allowed query parameters included in canonical route key */
  routeQueryParams?: string[];
  /** Whether to include hash fragment in route key */
  includeHash?: boolean;
  /** Whether to seed crawl with /sitemap.xml (default true) */
  seedSitemap?: boolean;
  /** On-demand session re-authenticator when consecutive auth walls are hit */
  reloginHandler?: () => Promise<boolean>;
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
        const testIdSelector = (el: Element) => {
          const attr = testIdAttributes.find((a) => el.hasAttribute(a));
          return attr ? `[${attr}="${el.getAttribute(attr)}"]` : null;
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
              ? `#${id}`
              : name
                ? `[name="${name}"]`
                : ariaLabel
                  ? `[aria-label="${ariaLabel}"]`
                  : placeholder
                    ? `[placeholder="${placeholder}"]`
                    : `${inp.tagName.toLowerCase()}[type="${type}"]`);
          const required = inp.hasAttribute('required');
          const forLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
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
          submitSelector = sTestId
            ? sTestId
            : sId
              ? `#${sId}`
              : submitBtn.tagName.toLowerCase() === 'input'
                ? 'input[type="submit"]'
                : 'button[type="submit"]';
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
    const startTime = Date.now();
    const deadline = Math.min(options.deadlineAt ?? Infinity, startTime + maxDurationMs);
    let timedOut = false;

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

    const enqueue = (rawUrl: string, depth: number) => {
      if (options.signal?.aborted || sessionLost || startRedirectedOffSite) return;
      if (Date.now() >= deadline) {
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

      const admitted = frontier.admit(u.toString(), site.toString(), depth);
      if (!admitted.admit) {
        if (admitted.reason === 'trap-limit') {
          const shape = frontier.getShape(u.toString(), site.toString());
          if (!loggedTrapShapes.has(shape)) {
            loggedTrapShapes.add(shape);
            debugLog('crawl', 'shape limit reached', {
              shape,
              path: redactUrl(u.pathname + u.search),
            });
          }
          skipped.push({ urlPath: redactUrl(u.pathname), why: 'trap-limit' });
        }
        return;
      }

      queue.push({ url: u.toString(), depth });
      notifyWork();
    };

    for (const start of [...(options.startPaths || []), baseUrlObj.pathname + baseUrlObj.search || '/']) {
      enqueue(start, 0);
    }

    // Sitemap seeding (crawls /sitemap.xml and robots.txt Sitemap: lines)
    if (options.seedSitemap !== false) {
      // Only a shared machine checks addresses; a local run may read its own sitemap (ADR 0031).
      const allowPrivate = !getBrowserPolicy()?.guard;
      try {
        const sitemapUrls = [new URL('/sitemap.xml', site).toString()];
        try {
          const robotsRes = await safeGet(new URL('/robots.txt', site).toString(), { timeoutMs: 5000, allowPrivate });
          if (robotsRes.ok && robotsRes.status >= 200 && robotsRes.status < 300) {
            for (const line of robotsRes.body.split(/\r?\n/)) {
              const m = line.match(/^\s*sitemap:\s*(.+)$/i);
              if (m && m[1]) {
                const sm = m[1].trim();
                if (!sm) continue;
                let smTarget: URL;
                try {
                  smTarget = new URL(sm, site);
                } catch {
                  continue;
                }
                // A Sitemap line for another host is not read: the crawl stays on the target's site.
                if (!onSite(smTarget)) {
                  debugLog('crawl', 'sitemap line ignored: other host', { host: smTarget.host });
                  continue;
                }
                if (!sitemapUrls.includes(smTarget.toString())) sitemapUrls.push(smTarget.toString());
              }
            }
          }
        } catch {
          // Ignore robots fetch failure for sitemap
        }

        let locCount = 0;
        for (const smUrl of sitemapUrls) {
          if (locCount >= 200) break;
          try {
            const res = await safeGet(smUrl, { timeoutMs: 10000, allowPrivate });
            if (!res.ok || res.status < 200 || res.status >= 300) continue;
            const text = res.body;
            const isIndex = /<sitemapindex/i.test(text);
            const matches = text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi);
            for (const m of matches) {
              if (m[1]) {
                const loc = m[1].trim();
                try {
                  const locUrl = new URL(loc, site);
                  if (onSite(locUrl)) {
                    if (isIndex || (loc.endsWith('.xml') && !loc.endsWith('.html'))) {
                      if (sitemapUrls.length < 25 && !sitemapUrls.includes(locUrl.toString())) {
                        sitemapUrls.push(locUrl.toString());
                      }
                    } else {
                      enqueue(loc, 1);
                      locCount++;
                      if (locCount >= 200) break;
                    }
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
        const now = Date.now();
        const waitMs = Math.max(0, lastLoadAt + pageDelayMs - now);
        if (waitMs > 0) {
          lastLoadAt = Math.max(lastLoadAt, now) + pageDelayMs;
          await new Promise((res) => setTimeout(res, waitMs));
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
        skipped.push({ urlPath: requestedAsAsked, why: 'robots' });
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

      try {
        await waitForPacing();

        let navRes;
        try {
          navRes = await navigate(page, fullUrl, {
            timeoutMs: 10000,
            needLinks: true,
            who: options.role || (isRoleSignedIn ? 'signed-in' : 'visitor'),
          });
        } catch (err: unknown) {
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
          skipped.push({ urlPath: requestedAsAsked, why: 'did-not-load', detail });
          debugLog('crawl', 'route navigation failed', {
            path: rTel.requestedPath,
            outcome: 'skipped',
            reason: 'did-not-load',
            attempts: 1,
            ms: 0,
          });
          return;
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
          skipped.push({ urlPath: requestedAsAsked, why: 'page-limit' });
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
          const skipWhy: RouteSkipReason = navRes.error?.kind === 'timeout' ? 'timeout' : 'did-not-load';
          const detail = navRes.error?.kind || 'net';
          telemetry.outcome = 'skipped';
          telemetry.skipReason = skipWhy;
          telemetry.detail = detail;
          routes.push(telemetry);
          skipped.push({ urlPath: requestedAsAsked, why: skipWhy, status: navRes.status, detail });
          debugLog('crawl', 'route failed to load', {
            path: telemetry.requestedPath,
            status: telemetry.status,
            finalPath: telemetry.finalPath,
            outcome: 'skipped',
            reason: skipWhy,
            attempts: telemetry.attempts,
            ms: telemetry.durationMs,
          });
          return;
        }

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
          skipped.push({ urlPath: requestedAsAsked, why: skipWhy, status: navRes.status });
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
            skipped.push({ urlPath: requestedAsAsked, why: 'off-site-redirect', status: navRes.status });
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
          skipped.push({
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
          skipped.push({ urlPath: requestedAsAsked, why: 'http-error', status: navRes.status });
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

        // Dismiss overlays (cookie banners) before link extraction
        await dismissOverlays(page);

        // 1. Discover links (anchors, role=link, data-href, get-forms)
        const rawLinks = await page.evaluate(() => {
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
          const forms = Array.from(document.querySelectorAll('form'));
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
        });

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

        for (const f of pageForms) {
          forms.push({
            action: f.action,
            method: f.method,
            urlPath: currentPath,
            inputs: f.inputs,
            submitButtonSelector: f.submitButtonSelector,
          });
        }

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
        };
        // Race guard for the limit (workers share `pages`): the slot is taken before anything is written, so
        // `pages.length` never passes the limit and no screenshot is left for a page that is not in `pages`.
        if (skipForPageLimit()) return;
        pages.push(pageItem);
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
        debugLog('crawl', 'route recorded', {
          path: telemetry.requestedPath,
          status: telemetry.status,
          finalPath: telemetry.finalPath,
          outcome: 'recorded',
          reason: undefined,
          attempts: telemetry.attempts,
          ms: telemetry.durationMs,
        });
        options.onPage?.(pageItem, pages.length, forms.slice(forms.length - pageForms.length));

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
            if (clickBudget-- <= 0) break;
            try {
              if (page.url() !== pageUrl) {
                await waitForPacing();
                await navigate(page, pageUrl, { timeoutMs: 10000 });
              }
              const urlBefore = page.url();
              await page.locator(el.selector).first().click({ timeout: 3000 });
              await Promise.race([
                page.waitForURL((u) => u.toString() !== urlBefore, { timeout: 1500 }),
                page.waitForTimeout(250),
              ]).catch(() => {});
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
              exploreErrors++;
            }
          }
        }

        // 5. Tabs, accordions, drawers and dialogs hide forms; list pages show how they are managed.
        // Guarded (ADR 0025): nothing is submitted, changing requests are aborted, dialogs dismissed.
        if (exploreClicks && clickBudget > 0 && onSite(landed)) {
          const reload = async () => {
            await waitForPacing();
            await navigate(page, pageUrl, { timeoutMs: 10000 });
          };
          try {
            clickBudget -= await exploreInteractiveStates({
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
            if (page.url() !== pageUrl) await reload();
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
            exploreErrors++;
          }
        }

        if (exploreErrors > 0) {
          pageItem.exploreErrors = exploreErrors;
        }
      } catch {
        // Double-record fix: only record as skipped if page was not already recorded
        if (!recorded) {
          skipped.push({ urlPath: requestedAsAsked, why: 'did-not-load' });
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
          Date.now() < deadline &&
          pages.length < this.maxPages &&
          attemptsCount < maxAttempts
        ) {
          let requestedItem: QueueItem | null = null;
          let requestedPath = '';

          while (queue.length > 0) {
            const item = queue.shift()!;
            const norm = normRoute(item.url);
            if (!frontier.isVisited(norm.key)) {
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
              Date.now() >= deadline ||
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
    if (timedOut || Date.now() >= deadline) {
      let count = 0;
      for (const left of queue) {
        const norm = normRoute(left.url);
        if (!frontier.isVisited(norm.key)) {
          skipped.push({ urlPath: redactUrl(norm.path), why: 'time-limit' });
          count++;
          if (count >= 50) break;
        }
      }
      if (count === 0 && !skipped.some((s) => s.why === 'time-limit')) {
        skipped.push({ urlPath: redactUrl(normRoute(targetUrl).path), why: 'time-limit' });
      }
    } else if (sessionLost) {
      let count = 0;
      for (const left of queue) {
        const norm = normRoute(left.url);
        if (!frontier.isVisited(norm.key)) {
          skipped.push({ urlPath: redactUrl(norm.path), why: 'session-lost' });
          count++;
          if (count >= 50) break;
        }
      }
    } else if (pages.length >= this.maxPages && !options.signal?.aborted) {
      // Still queued when the page limit ended the crawl: found, never opened.
      for (const left of queue) {
        const norm = normRoute(left.url);
        if (!frontier.isVisited(norm.key)) skipped.push({ urlPath: redactUrl(norm.path), why: 'page-limit' });
      }
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
