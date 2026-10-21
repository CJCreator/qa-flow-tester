import { promises as fs } from 'fs';
import path from 'path';
import type { BrowserContext } from 'playwright';
import type {
  ProductProfile,
  DiscoveryDraft,
  DiscoveredFlow,
  AmbiguityQuestion,
  PageInventoryItem,
  StorageStateData,
  SignInFailureReason,
  RunCap,
  RouteTelemetry,
  SkippedPageInfo,
  PageCoverage,
  TimingEntry,
} from '@qa/types';
import { signInReasonText } from '@qa/types';
import { PlanValidator } from './plan-validator.js';
import { BrowserManager, BREAKPOINT_VIEWPORTS, urlForLog } from '../browser.js';
import { PreFlightChecker, SignInFailedError, type PreFlightResult } from '../preflight.js';
import { debugLog } from '../debug-log.js';
import { DeterministicSpider, DEFAULT_MAX_PAGES, type SpiderResult } from './deterministic-spider.js';
import { buildSiteGraph, pathOf } from '../plan/site-graph.js';
import { sampleLayoutGroups } from '../plan/sampling.js';
import { PlanPipeline } from '../plan/pipeline.js';
import { lookAtNarrowScreens } from '../plan/narrow-look.js';
import { estimatePageRequests, planPagesAndMenus, testedPages } from '../plan/ai-planner.js';
import { PacedAI } from '../plan/ai-budget.js';
import { planJourneys } from '../plan/journeys.js';
import { planFromSpec } from '../plan/spec-plan.js';
import { documentedUnits, reachedRequirementIds } from '../plan/sources.js';
import { SafetyFilter } from './safety-filter.js';
import type { PlanPage } from '@qa/types';
import { ContextParser } from './context-parser.js';
import { Redactor } from '../redact.js';
import { replaceCredentialsWithPlaceholders } from '../credentials.js';
import { detectSiteType, type SiteType } from './site-type.js';
import { formQuestion, intentQuestionsFor } from './questions.js';
import { siteContentKey, type RememberedPlan } from '../site-memory.js';
import type { CrawlOptions } from './deterministic-spider.js';
import { RobotsPolicy } from '../competitive/robots.js';
import { isPrivateHost } from '../competitive/safe-crawler.js';
import { blockChanges, markJourneysNeedingTestCopy } from '../live-site.js';
import type { AIProvider } from '../ai/ai-provider.js';
import { stopIfAborted } from '../abort.js';

export interface DiscoveryOptions {
  targetUrl: string;
  productId: string;
  profile?: ProductProfile;
  contextFilePath?: string;
  /**
   * Product Context as several documents (files and docs-URL pages). Used instead of `contextFilePath`
   * so each requirement keeps its document and section.
   */
  contextDocuments?: Array<{ name: string; text: string }>;
  outputDir?: string;
  /** Plans the journeys. Without one (no AI key), fixed rules pick them instead. */
  aiProvider?: AIProvider;
  /**
   * The site isn't a test copy: nothing that could change data is sent while exploring. Signing in
   * with the roles' own details is still allowed.
   */
  readOnly?: boolean;
  /** Pages to explore per crawl. Default 200 (DEFAULT_MAX_PAGES). */
  maxPages?: number;
  /** Crawl concurrency (1 to 5, default 2). */
  crawlConcurrency?: number;
  /** Crawl delay between page loads in ms (0-2000, default 100 for public sites). */
  crawlDelayMs?: number;
  /** Custom HTTP headers sent with every request (e.g. X-QA-Bypass-Token). */
  customHeaders?: Record<string, string>;
  /** Custom User-Agent header */
  userAgent?: string;
  /** Basic auth credential string ('user:pass') for tunneling */
  tunnelAuth?: string;
  /** Hostnames allowed to receive custom headers (default: same-origin only) */
  headerHosts?: string[];
  /** Epoch ms deadline shared across crawls */
  deadlineAt?: number;
  /**
   * The AI key's free requests today, when the AI service says: planning stops asking the AI
   * past `left`, and the rest is planned by fixed rules.
   */
  aiBudget?: { left?: number; limit?: number; visualReview?: number };
  /** How fast to ask the AI, from what the provider reports, and the person's own cap. See `pacingFor`. */
  aiPacing?: {
    gapMs?: number;
    concurrency?: number;
    cap?: RunCap;
    price?: { prompt: number; completion: number };
  };
  /** The model the provider uses, and others to switch to when it stops before answering. */
  aiModels?: { model?: string; fallbacks?: string[] };
  /** Told how the scan is going, for the progress screen. */
  onProgress?: (progress: DiscoveryProgress) => void;
  /**
   * The site's last approved Plan (site memory): reused where the site hasn't changed, so only new
   * or changed pages and links go to the AI. Leave it out to plan everything afresh.
   */
  remembered?: RememberedPlan;
  /** Stops the scan: no more pages or AI requests, the browser closes, and discover() throws an AbortError. */
  signal?: AbortSignal;
  /**
   * Finishes the scan early: no more pages are explored, and what was found is planned (by fixed
   * rules for anything the AI hasn't planned yet).
   */
  finishSignal?: AbortSignal;
  /** Where sign-in sessions are saved. Default `<outputDir>/auth`. Keep it out of any folder that's served. */
  authDir?: string;
  /** Sessions the person saved, by role. Memory only: used instead of signing in, never written or logged. */
  suppliedSessions?: Record<string, StorageStateData>;
  /** Throw SignInFailedError before the crawl when any role cannot sign in. Default false: the role is listed as not tested. */
  requireSignIn?: boolean;
  /**
   * Rollback: plan only after the whole crawl, as before the pipeline. Default: with an AI provider,
   * pages are planned while the Spider is still crawling.
   */
  sequentialPlanning?: boolean;
  /** Record how long each crawl and the planning took (also on when QA_DEBUG is set). See TimingEntry. */
  timing?: boolean;
}

export interface DiscoveryOutcome {
  draft: DiscoveryDraft;
  preflight?: PreFlightResult;
  /** Crawl and planning times. Present only when timing is on. */
  timing?: TimingEntry[];
}

/**
 * Times the phases of a run into TimingEntry rows. Off unless the run asked for timing or QA_DEBUG is set:
 * then nothing is kept and nothing is logged.
 */
export class RunTimer {
  readonly enabled: boolean;
  readonly entries: TimingEntry[] = [];

  constructor(requested?: boolean) {
    this.enabled = !!requested || !!process.env.QA_DEBUG?.trim();
  }

  /** Records a phase that started at `startedAt` (Date.now()). */
  add(entry: Omit<TimingEntry, 'durationMs'>, startedAt: number): void {
    if (!this.enabled) return;
    const durationMs = Date.now() - startedAt;
    this.entries.push({ ...entry, durationMs });
    debugLog(entry.phase === 'crawl' || entry.phase === 'plan' ? 'crawl' : 'nav', 'timing', {
      phase: entry.phase,
      name: entry.name,
      testCaseId: entry.testCaseId,
      breakpoint: entry.breakpoint,
      ms: durationMs,
    });
  }

  /** Times an async step. Its result and any error pass through unchanged. */
  async span<T>(entry: Omit<TimingEntry, 'durationMs'>, step: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      return await step();
    } finally {
      this.add(entry, startedAt);
    }
  }

  /** Times a synchronous step. Its result and any error pass through unchanged. */
  sync<T>(entry: Omit<TimingEntry, 'durationMs'>, step: () => T): T {
    const startedAt = Date.now();
    try {
      return step();
    } finally {
      this.add(entry, startedAt);
    }
  }
}

/** How a scan is going. */
export type DiscoveryProgress =
  | {
      stage: 'crawling';
      pagesFound: number;
      urlPath: string;
      who: string;
      plannedSoFar?: number;
      signedInAs?: string;
      signInFailedFor?: string[];
      skipped?: number;
    }
  | { stage: 'narrow-screens' }
  | {
      stage: 'planning';
      done: number;
      total: number;
      requestsUsed: number;
      requestsNeeded: number;
      requestsLeft?: number;
      pagesFound: number;
      layoutGroups: number;
      what: string;
      /** A request is on its way: `what` names it. */
      asking?: boolean;
      /** 1 for the first request, 2 for the repair. */
      attempt?: number;
    };

/** Pages described to the AI when it plans journeys: enough to see the site, not so many a small model loses track. */
const JOURNEY_PROMPT_PAGES = 40;

/** Waits between page loads on sites we don't own. */
const PUBLIC_SITE_PAGE_DELAY_MS = 2000;
const CRAWLER_TOKEN = 'QA-Benchmarking-Bot';

/**
 * Combines the signed-out crawl with each role's crawl. A page keeps the elements seen by the
 * last explorer to reach it (the signed-in view, when a role reached it) and lists who reached it.
 */
export function mergeCrawls(crawls: Array<{ who: string; result: SpiderResult }>): SpiderResult {
  const pages = new Map<string, PageInventoryItem>();
  const forms = new Map<string, SpiderResult['forms'][number]>();
  const sensitive = new Map<string, SpiderResult['sensitiveActions'][number]>();
  const questions = new Map<string, AmbiguityQuestion>();

  for (const { who, result } of crawls) {
    for (const page of result.pages) {
      const key = new URL(page.urlPath, 'http://x').pathname;
      const earlier = pages.get(key);
      const reachedBy = [...(earlier?.reachedBy || []), who];
      // Every explorer's links are kept, with who saw each (signed-in menus differ) and where each
      // explorer landed when it wasn't where the link points (a sign-in page for a visitor).
      const links = new Map((earlier?.links || []).map((l) => [`${l.selector}|${l.to}`, l]));
      for (const link of page.links || []) {
        const id = `${link.selector}|${link.to}`;
        const before = links.get(id);
        const landsOnBy = { ...(before?.landsOnBy || {}), ...(link.landsOn ? { [who]: link.landsOn } : {}) };
        links.set(id, {
          ...link,
          landsOn: before?.landsOn ?? link.landsOn,
          landsOnBy: Object.keys(landsOnBy).length > 0 ? landsOnBy : undefined,
          seenBy: [...(before?.seenBy || []), who],
        });
      }
      pages.set(key, { ...page, reachedBy, links: page.links || earlier?.links ? [...links.values()] : undefined });
    }
    for (const form of result.forms) forms.set(`${form.urlPath}|${form.action}|${form.submitButtonSelector}`, form);
    for (const action of result.sensitiveActions) sensitive.set(`${action.urlPath}|${action.elementSelector}`, action);
    for (const q of result.ambiguityQuestions) questions.set(`${q.urlPath}|${q.targetElement}|${q.category}`, q);
  }

  const reached = new Set(pages.keys());
  const walls = new Set(crawls.flatMap((c) => c.result.signInWalls).filter((p) => !reached.has(p)));
  const skippedByRobots = [...new Set(crawls.flatMap((c) => c.result.skippedByRobots || []))];
  return {
    pages: [...pages.values()],
    forms: [...forms.values()],
    sensitiveActions: [...sensitive.values()],
    ambiguityQuestions: [...questions.values()].map((q, i) => ({ ...q, id: `Q-${String(i + 1).padStart(3, '0')}` })),
    signInWalls: [...walls],
    skippedByRobots: skippedByRobots.length > 0 ? skippedByRobots : undefined,
  };
}

function describeExploration(
  crawls: Array<{ who: string; result: SpiderResult }>,
  merged: SpiderResult,
  signInFailed: string[],
  signInFailures: Record<string, SignInFailureReason> = {}
): NonNullable<DiscoveryDraft['exploration']> {
  const signedInAs = crawls.map((c) => c.who).filter((who) => who !== 'visitor');
  const signInPages = merged.pages.filter((p) => p.hasSignInForm).map((p) => p.urlPath);
  const notes: string[] = [];
  if (signedInAs.length === 0 && (signInPages.length > 0 || merged.signInWalls.length > 0)) {
    notes.push(
      `Pages behind the sign-in were not reached${merged.signInWalls.length ? ` (${merged.signInWalls.join(', ')})` : ''}. Add a sign-in to test them.`
    );
  } else if (merged.signInWalls.length > 0) {
    notes.push(`These pages ask for a sign-in that no role could get past: ${merged.signInWalls.join(', ')}.`);
  }
  for (const role of signInFailed) {
    const reason = signInFailures[role];
    notes.push(
      reason
        ? `Signing in as "${role}" didn't work, so nothing was explored as that role. ${signInReasonText(reason)}`
        : `Signing in as "${role}" didn't work, so nothing was explored as that role. Check its username, password and sign-in page.`
    );
  }
  const robotsSkipped = merged.skippedByRobots || [];
  if (robotsSkipped.length > 0) {
    notes.push(
      `Skipped ${robotsSkipped.length} ${robotsSkipped.length === 1 ? 'page' : 'pages'} the site's robots.txt asks crawlers to leave alone: ${robotsSkipped.slice(0, 5).join(', ')}${robotsSkipped.length > 5 ? ', …' : ''}.`
    );
  }
  // Pages found by any crawl: reached ones are the site map's pages; the rest keep the first reason given.
  const reachedPaths = new Set(merged.pages.map((p) => new URL(p.urlPath, 'http://x').pathname));
  const skippedPages = new Map<string, SkippedPageInfo>();
  for (const { result } of crawls) {
    for (const s of result.skipped || []) {
      const urlPath = new URL(s.urlPath, 'http://x').pathname;
      const existing = skippedPages.get(urlPath);
      if (!reachedPaths.has(urlPath) && (!existing || (existing.why === 'page-limit' && s.why !== 'page-limit'))) {
        skippedPages.set(urlPath, {
          urlPath,
          why: s.why,
          status: s.status,
          finalPath: s.finalPath,
          detail: s.detail,
        });
      }
    }
  }

  const allRoutes: RouteTelemetry[] = [];
  for (const { result } of crawls) {
    for (const r of result.routes || []) {
      allRoutes.push({
        ...r,
        redirectChain: r.redirectChain ? r.redirectChain.slice(0, 5) : undefined,
      });
      if (allRoutes.length >= 500) break;
    }
    if (allRoutes.length >= 500) break;
  }

  const pageCoverage: PageCoverage = {
    found: reachedPaths.size + skippedPages.size,
    reached: reachedPaths.size,
    skipped: [...skippedPages.values()],
    routes: allRoutes.length > 0 ? allRoutes : undefined,
  };
  return {
    signedInAs,
    signInFailed,
    pageCoverage,
    ...(Object.keys(signInFailures).length > 0 ? { signInFailures } : {}),
    signInPages,
    notReached: merged.signInWalls,
    notes,
  };
}

/** One origin's `localStorage` entries, as a saved session holds them. */
interface SessionStorageArg {
  origin: string;
  entries: Array<{ name: string; value: string }>;
}

/**
 * Puts a whole saved session back into a live browser context: what is already there is cleared first, then
 * the session's cookies and every origin's `localStorage` are restored. A site that keeps its token in
 * `localStorage` — supported at sign-in — recovers the same way it signed in (LC-004). Nothing about the
 * session is logged. `BrowserContext` is a type-only import, so the wizard bundle stays free of Node code.
 */
export async function restoreSession(context: BrowserContext, state: StorageStateData): Promise<void> {
  await context.clearCookies().catch(() => {});
  const cookies = (state.cookies ?? []) as Parameters<BrowserContext['addCookies']>[0];
  if (cookies.length > 0) await context.addCookies(cookies);

  const applyStorage = ({ origin: wanted, entries: values }: SessionStorageArg) => {
    try {
      if (window.location.origin !== wanted) return;
      for (const { name, value } of values) window.localStorage.setItem(name, value);
    } catch {
      // Storage can be unavailable (a sandboxed frame); the signed-in session is unaffected.
    }
  };

  for (const raw of state.origins ?? []) {
    const origin = (raw as { origin?: string }).origin;
    const entries = (raw as { localStorage?: Array<{ name: string; value: string }> }).localStorage;
    if (!origin || !entries?.length) continue;
    // An init script, the way Playwright's own storageState works, covers every page that opens later.
    await context.addInitScript(applyStorage, { origin, entries });
    // A page that is already open never runs an init script for the page it is already on, so its own
    // storage is set directly — the mid-crawl case, where the page being retried already exists.
    for (const openPage of context.pages()) {
      await openPage.evaluate(applyStorage, { origin, entries }).catch(() => {});
    }
  }
}

export class DiscoveryAgent {
  private browserManager = new BrowserManager();
  private contextParser = new ContextParser();

  static async discover(options: DiscoveryOptions): Promise<DiscoveryDraft> {
    return new DiscoveryAgent().discover(options);
  }

  static async discoverWithSession(options: DiscoveryOptions): Promise<DiscoveryOutcome> {
    return new DiscoveryAgent().discoverWithSession(options);
  }

  async discover(options: DiscoveryOptions): Promise<DiscoveryDraft> {
    try {
      const outcome = await this.discoverSite(options);
      return outcome.draft;
    } finally {
      // Also when the scan is stopped or fails part-way: no browser is left running.
      await this.browserManager.close().catch(() => {});
    }
  }

  async discoverWithSession(options: DiscoveryOptions): Promise<DiscoveryOutcome> {
    try {
      return await this.discoverSite(options);
    } finally {
      await this.browserManager.close().catch(() => {});
    }
  }

  private async discoverSite(options: DiscoveryOptions): Promise<DiscoveryOutcome> {
    const outputDir = options.outputDir || path.join(process.cwd(), '.qa-report');
    await fs.mkdir(outputDir, { recursive: true });
    const signal = options.signal;
    stopIfAborted(signal);
    const timer = new RunTimer(options.timing);

    // 1. Ingest Product Context
    const parsedContext = options.contextDocuments?.length
      ? this.contextParser.parseDocuments(options.contextDocuments)
      : await this.contextParser.parseFile(options.contextFilePath);

    // 2. Explore: signed out first, then once per role that can sign in, starting where it landed.
    const spider = new DeterministicSpider(
      options.profile?.forbiddenActions || [],
      options.maxPages ?? DEFAULT_MAX_PAGES
    );
    const roles = options.profile?.roles || [];
    const redactor = new Redactor(roles);
    // Signing in with the roles' own details is allowed on any site; it happens here, before the guard.
    const preflight =
      roles.length > 0
        ? await new PreFlightChecker().runPreFlight(options.targetUrl, options.profile, options.tunnelAuth, {
            browserManager: this.browserManager,
            authDir: options.authDir || path.join(outputDir, 'auth'),
            suppliedSessions: options.suppliedSessions,
            customHeaders: options.customHeaders,
            userAgent: options.userAgent,
            headerHosts: options.headerHosts,
          })
        : undefined;

    for (const role of roles) {
      const diag = preflight?.roleDiagnostics?.[role.role];
      debugLog('auth', `role diagnostics for ${role.role}`, {
        role: role.role,
        ok: diag?.ok,
        failedStep: diag?.failedStep,
        attempts: diag?.attempts,
        landedPath: diag?.landedPath,
      });
    }
    stopIfAborted(signal);
    if (options.requireSignIn && preflight) {
      // Fail closed: a role is signed in only if it has a session. An unreachable home page has no
      // roleFailures at all, so that case is 'unreachable' rather than a silent signed-out crawl.
      const unsigned = roles.find((r) => !preflight.roleStorageStates?.[r.role]);
      if (!preflight.ok || unsigned) {
        const failed = Object.entries(preflight.roleFailures ?? {})[0];
        if (failed) throw new SignInFailedError(failed[1], failed[0]);
        throw new SignInFailedError('unreachable', unsigned?.role ?? roles[0].role);
      }
    }

    // The AI Request Budget: set up before the crawl, because planning starts while it runs.
    const requestsLeft = options.aiBudget?.left;
    const paced = options.aiProvider
      ? new PacedAI(options.aiProvider, requestsLeft ?? Infinity, {
          signal,
          finishSignal: options.finishSignal,
          model: options.aiModels?.model,
          fallbackModels: options.aiModels?.fallbacks,
          gapMs: options.aiPacing?.gapMs,
          concurrency: options.aiPacing?.concurrency,
          cap: options.aiPacing?.cap,
          price: options.aiPacing?.price,
        })
      : undefined;
    const roleNames = roles.map((r) => r.role);
    const crawls: Array<{ who: string; result: SpiderResult }> = [];
    /** Whether a role's own view of the page still shows the control (a Denial item would be trying it). */
    const controlShownTo = (role: string, urlPath: string, selector: string) =>
      !!crawls
        .find((c) => c.who === role)
        ?.result.pages.find((p) => pathOf(p.urlPath) === pathOf(urlPath))
        ?.elements?.some((el) => el.selector === selector && el.visible);
    const planningBase = {
      targetUrl: options.targetUrl,
      productContext: parsedContext.rawContent,
      requirements: parsedContext.requirements,
      roles: roleNames,
      controlShownTo,
      readOnly: !!options.readOnly,
      forbiddenActions: options.profile?.forbiddenActions,
      redact: (text: string) => redactor.text(text),
      remembered: options.remembered,
    };
    // Pages are planned while the Spider crawls, when there is an AI to ask.
    let crawling = true;
    let planningProgress: (
      done: number,
      what: string,
      asking?: { attempt?: number },
      total?: number
    ) => void = () => {};
    const pipeline =
      paced && !options.sequentialPlanning
        ? new PlanPipeline({
            input: planningBase,
            ai: paced,
            concurrency: paced.concurrency,
            siteTypeOf: (pages) => detectSiteType(pages, options.targetUrl),
            startPath: new URL(options.targetUrl).pathname,
            onProgress: (p) => {
              if (!crawling) planningProgress(p.done, p.what, p.asking ? { attempt: p.attempt } : undefined, p.total);
            },
          })
        : undefined;

    // A site we don't own: honour its robots.txt and pause between pages. A live site: send nothing.
    const targetOrigin = new URL(options.targetUrl);
    const ownMachine = isPrivateHost(targetOrigin.hostname);
    const defaultBudgetMinutes = process.env.QA_DISCOVERY_MAX_MINUTES
      ? Number(process.env.QA_DISCOVERY_MAX_MINUTES)
      : 20;
    const deadlineAt = options.deadlineAt ?? Date.now() + defaultBudgetMinutes * 60 * 1000;

    const crawlOptions: CrawlOptions = {
      robots: ownMachine ? undefined : await RobotsPolicy.fetch(targetOrigin.origin, CRAWLER_TOKEN),
      pageDelayMs:
        options.crawlDelayMs !== undefined ? options.crawlDelayMs : ownMachine ? 0 : PUBLIC_SITE_PAGE_DELAY_MS,
      concurrency: options.crawlConcurrency,
      customHeaders: options.customHeaders,
      screenshotDir: path.join(outputDir, 'plan-pages'),
      deadlineAt,
      // Stopping to plan what's found ends the crawl the same way as stopping outright.
      signal:
        options.finishSignal && signal
          ? AbortSignal.any([signal, options.finishSignal])
          : (options.finishSignal ?? signal),
    };
    const newContext = async (storageState?: string | StorageStateData) => {
      const context = await this.browserManager.createContext({
        baseUrl: options.targetUrl,
        storageState,
        customHeaders: options.customHeaders,
        userAgent: options.userAgent,
        tunnelAuth: options.tunnelAuth,
        headerHosts: options.headerHosts,
      });
      if (options.readOnly) await blockChanges(context);
      return context;
    };

    console.log(`[DiscoveryAgent] Crawling routes and interactive forms on ${urlForLog(options.targetUrl)}...`);
    // Pages found so far across every explorer, for the progress screen.
    let pagesFound = 0;
    const signInFailed: string[] = [];
    const signInFailures: Record<string, SignInFailureReason> = {};
    const droppedSessionRoles: string[] = [];

    const onPage =
      (who: string) =>
      (page: PageInventoryItem, _n: number, forms: SpiderResult['forms'] = []) => {
        pipeline?.push(page, who, forms);
        options.onProgress?.({
          stage: 'crawling',
          pagesFound: ++pagesFound,
          urlPath: page.urlPath,
          who,
          plannedSoFar: pipeline?.plannedSoFar,
          signedInAs: who !== 'visitor' ? who : undefined,
          signInFailedFor: signInFailed.length > 0 ? signInFailed : undefined,
        });
      };
    // Pages the person added by address last time: no link leads there, so they're visited directly.
    const addedBefore = Object.entries(options.remembered?.pages || {})
      .filter(([, page]) => page.added)
      .map(([urlPath]) => urlPath);

    const totalMaxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const visitorSpider = new DeterministicSpider(options.profile?.forbiddenActions || [], totalMaxPages);
    const visitorContext = await newContext();
    const visitorStarted = Date.now();
    crawls.push({
      who: 'visitor',
      // Closed when the crawl throws too, not only when it returns.
      result: await visitorSpider
        .crawl(visitorContext, options.targetUrl, {
          ...crawlOptions,
          startPaths: addedBefore,
          screenshotPrefix: 'visitor',
          onPage: onPage('visitor'),
          role: 'visitor',
          isSignedIn: false,
          deadlineAt,
        })
        .finally(() => visitorContext.close().catch(() => {})),
    });
    timer.add({ phase: 'crawl', name: 'visitor' }, visitorStarted);
    stopIfAborted(signal);

    for (const role of roles) {
      const storageState = preflight?.roleStorageStates?.[role.role];
      if (!storageState) {
        signInFailed.push(role.role);
        signInFailures[role.role] = preflight?.roleFailures?.[role.role] ?? 'no-form';
        continue;
      }
      const landing = preflight?.roleLandingPaths?.[role.role];
      console.log(
        `[DiscoveryAgent] Exploring signed in as "${role.role}"${landing ? ` from ${redactor.text(landing)}` : ''}...`
      );
      const roleContext = await newContext(storageState);
      const roleMaxPages = Math.min(totalMaxPages, Math.max(20, Math.floor(totalMaxPages / 2)));
      const roleSpider = new DeterministicSpider(options.profile?.forbiddenActions || [], roleMaxPages);
      const reloginHandler = async (): Promise<boolean> => {
        try {
          const freshContext = await newContext();
          const outcome = await new PreFlightChecker()
            .signIn(freshContext, options.targetUrl, role)
            .catch(async (err: unknown) => {
              await freshContext.close().catch(() => {});
              throw err;
            });
          const freshState = outcome.ok ? await freshContext.storageState().catch(() => null) : null;
          await freshContext.close().catch(() => {});
          if (!freshState) return false;
          // The whole session, not only its cookies: one restore path for every call site (LC-004).
          await restoreSession(roleContext, freshState);
          return true;
        } catch {
          return false;
        }
      };
      const roleStarted = Date.now();
      // Closed when the crawl throws too, not only when it returns.
      const roleResult = await roleSpider
        .crawl(roleContext, options.targetUrl, {
          ...crawlOptions,
          startPaths: [...(landing ? [landing] : []), ...addedBefore],
          screenshotPrefix: `role-${crawls.length}`,
          onPage: onPage(role.role),
          role: role.role,
          isSignedIn: true,
          knownLoginPaths: [role.loginPath || '/login'],
          reloginHandler,
          deadlineAt,
        })
        .finally(() => roleContext.close().catch(() => {}));
      timer.add({ phase: 'crawl', name: role.role }, roleStarted);
      crawls.push({
        who: role.role,
        result: roleResult,
      });
      stopIfAborted(signal);

      if (roleResult.sessionLost || (roleResult.signInWalls && roleResult.signInWalls.length >= 3)) {
        if (options.requireSignIn) {
          await this.browserManager.close().catch(() => {});
          throw new SignInFailedError('session-expired', role.role);
        }
        signInFailures[role.role] = 'session-expired';
        droppedSessionRoles.push(role.role);
      }
    }

    const spiderResult = mergeCrawls(crawls);
    const exploration = describeExploration(crawls, spiderResult, signInFailed, signInFailures);
    for (const roleName of droppedSessionRoles) {
      const dropNote = `${roleName}'s sign-in stopped working part-way; pages after that were not explored`;
      if (!exploration.notes.includes(dropNote)) {
        exploration.notes.push(dropNote);
      }
    }
    if (options.finishSignal?.aborted) {
      exploration.notes.push(
        `You stopped the scan after ${spiderResult.pages.length} ${spiderResult.pages.length === 1 ? 'page' : 'pages'}, so pages it hadn’t reached yet aren’t in the plan.`
      );
    }

    // Narrow screens: which menu links fold behind a button there, and which button shows them.
    // Skipped when the person asked to finish with what's found.
    options.onProgress?.({ stage: 'narrow-screens' });
    let lastNarrowLoad = 0;
    if (!options.finishSignal?.aborted)
      await lookAtNarrowScreens(spiderResult.pages, {
        baseUrl: options.targetUrl,
        openContext: async (size, page) => {
          const signedIn = page.reachedBy?.includes('visitor') ? undefined : page.reachedBy?.[0];
          const context = await this.browserManager.createContext({
            baseUrl: options.targetUrl,
            viewport: BREAKPOINT_VIEWPORTS[size],
            storageState: signedIn ? preflight?.roleStorageStates?.[signedIn] : undefined,
            customHeaders: options.customHeaders,
            userAgent: options.userAgent,
            tunnelAuth: options.tunnelAuth,
            headerHosts: options.headerHosts,
          });
          if (options.readOnly) await blockChanges(context);
          return context;
        },
        pause: async () => {
          // Stopped: every remaining page is passed over at once.
          stopIfAborted(signal);
          const wait = lastNarrowLoad + (crawlOptions.pageDelayMs ?? 0) - Date.now();
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
          lastNarrowLoad = Date.now();
        },
      });
    await this.browserManager.close();
    stopIfAborted(signal);

    console.log(
      `[DiscoveryAgent] Spider found ${spiderResult.pages.length} pages, ${spiderResult.forms.length} forms, ${spiderResult.sensitiveActions.length} sensitive actions.`
    );

    const ambiguityQuestions: AmbiguityQuestion[] = [...spiderResult.ambiguityQuestions];

    // 4. The site's shape: the App Flow (which page links where) and the Layout Groups.
    const detectedSiteType: SiteType = detectSiteType(spiderResult.pages, options.targetUrl);
    let siteType: SiteType = detectedSiteType;
    const startPath = spiderResult.pages.some((p) => pathOf(p.urlPath) === targetOrigin.pathname)
      ? targetOrigin.pathname
      : spiderResult.pages[0]?.urlPath || '/';
    const graph = buildSiteGraph(spiderResult.pages, startPath);
    // Planned while crawling: the groups were tracked as pages arrived, and their samples are kept.
    const { groups: layoutGroups, coverage } = pipeline ? pipeline.layout() : sampleLayoutGroups(spiderResult.pages);
    // Pages the person promoted or added last time are still tested on their own.
    for (const [urlPath, before] of Object.entries(options.remembered?.pages || {})) {
      const info = coverage.get(urlPath);
      if (info && (before.promoted || before.added))
        coverage.set(urlPath, { ...info, coverage: 'promoted', coveredBy: undefined });
    }
    const tested = testedPages({ pages: spiderResult.pages, coverage });

    // 3. A question for each form that will be sent: not on a live site (nothing is sent there),
    // only on pages that are tested, and one question for the same form on many pages.
    if (!options.readOnly) {
      const testedPaths = new Set(tested.map((p) => p.urlPath));
      const sameForm = new Map<string, { form: SpiderResult['forms'][number]; pages: string[] }>();
      for (const form of spiderResult.forms) {
        // A sign-in form is how roles get in, not something the plan asks about.
        if (form.inputs.some((i) => i.type === 'password') || !testedPaths.has(form.urlPath)) continue;
        const shape = JSON.stringify([form.method, form.submitButtonSelector, form.inputs.map((i) => i.selector)]);
        const seen = sameForm.get(shape);
        if (seen) seen.pages.push(form.urlPath);
        else sameForm.set(shape, { form, pages: [form.urlPath] });
      }
      let qCounter = ambiguityQuestions.length + 1;
      for (const { form, pages } of sameForm.values()) ambiguityQuestions.push(formQuestion(form, qCounter++, pages));
    }

    // 5. The AI plans every Plan Item, within the AI Request Budget: pages a few at a time, the
    // shared menus, then the journeys. Past the budget, fixed rules plan the rest. What the last
    // approved Plan already has for an unchanged site is reused, not asked again.
    const journeysFrom = siteContentKey(spiderResult.pages);
    const remembered = options.remembered;
    const reuseJourneys =
      !!remembered?.flows &&
      remembered.journeysFrom === journeysFrom &&
      remembered.flows.every((f) => f.source !== 'fallback');
    const requestsNeeded =
      estimatePageRequests({
        pages: spiderResult.pages,
        coverage,
        graph,
        remembered: options.remembered,
        requirements: parsedContext.requirements,
        roles: roleNames,
      }) + (reuseJourneys ? 0 : 1);
    crawling = false;
    planningProgress = (done: number, what: string, asking?: { attempt?: number }, total = requestsNeeded) =>
      options.onProgress?.({
        stage: 'planning',
        done,
        total: Math.max(total, requestsNeeded),
        requestsUsed: paced?.used ?? 0,
        requestsNeeded,
        requestsLeft,
        pagesFound: spiderResult.pages.length,
        layoutGroups: layoutGroups.length,
        what,
        asking: asking ? true : undefined,
        attempt: asking?.attempt,
      });
    const planStarted = Date.now();
    planningProgress(0, `Found ${spiderResult.pages.length} pages; planning them`);
    const plannerInput = {
      ...planningBase,
      pages: spiderResult.pages,
      forms: spiderResult.forms,
      coverage,
      graph,
      siteType,
    };
    const pagePlan = pipeline
      ? await pipeline.finish(plannerInput)
      : await planPagesAndMenus(plannerInput, paced, (p) =>
          planningProgress(p.done, p.what, p.asking ? { attempt: p.attempt } : undefined)
        );
    stopIfAborted(signal);
    exploration.notes.push(...pagePlan.notes);
    for (const page of pagePlan.pages) if (options.remembered?.pages[page.urlPath]?.added) page.added = true;

    // Journeys across pages, from the tested pages closest to the start page. While no page has
    // changed since the last approved Plan, its journeys are reused.
    const byClicks = (p: PageInventoryItem) => graph.clickPaths.get(p.urlPath)?.length ?? Number.MAX_SAFE_INTEGER;
    if (!reuseJourneys && paced)
      planningProgress(requestsNeeded - 1, 'Asking the AI about the journeys…', { attempt: 1 });
    const journeyPlan = reuseJourneys
      ? (() => {
          const flows: DiscoveredFlow[] = JSON.parse(JSON.stringify(options.remembered!.flows));
          new PlanValidator(spiderResult.pages, spiderResult.forms).markFlowsNeedingHelp(flows);
          return {
            flows,
            siteType,
            usedFallback: false,
            overBudget: false,
            notes: [] as string[],
            questions: [] as AmbiguityQuestion[],
          };
        })()
      : await planJourneys(
          {
            targetUrl: options.targetUrl,
            productId: options.productId,
            productContext: parsedContext.rawContent,
            promptPages: [...tested].sort((a, b) => byClicks(a) - byClicks(b)).slice(0, JOURNEY_PROMPT_PAGES),
            spider: spiderResult,
            roles: options.profile?.roles || [],
            siteType,
            redact: (text) => redactor.text(text),
            requirements: parsedContext.requirements,
          },
          paced
        );
    stopIfAborted(signal);
    siteType = journeyPlan.siteType;
    const synthesizedFlows = journeyPlan.flows;
    const usedFallbackSynthesis = journeyPlan.usedFallback;
    exploration.notes.push(...journeyPlan.notes);
    ambiguityQuestions.push(...journeyPlan.questions);
    planningProgress(requestsNeeded, 'Planned the journeys');
    timer.add({ phase: 'plan', name: 'pages and journeys' }, planStarted);

    // Fixed rules read the documents: User Flows, route access and Denial items, each with its Source.
    // With an AI, only units it did not reach are filled in here.
    const units = documentedUnits(parsedContext.requirements).filter((r) =>
      ['journey', 'route', 'negative'].includes(r.kind ?? '')
    );
    if (units.length > 0) {
      const aiReached = reachedRequirementIds(pagePlan.pages, synthesizedFlows);
      const spec = planFromSpec({
        hints: parsedContext.requirements,
        roles: roleNames,
        crawls,
        readOnly: !!options.readOnly,
        safety: new SafetyFilter(options.profile?.forbiddenActions || []),
        skipRequirementIds: paced ? aiReached : undefined,
        fallbackReason: paced
          ? (synthesizedFlows.find((f) => f.fallbackReason)?.fallbackReason ?? 'unusable')
          : 'no-ai',
      });
      const have = new Set(synthesizedFlows.map((f) => f.id));
      synthesizedFlows.push(...spec.flows.filter((f) => !have.has(f.id)));
      for (const { urlPath, test } of spec.pageTests) {
        let page: PlanPage | undefined = pagePlan.pages.find((p) => pathOf(p.urlPath) === pathOf(urlPath));
        if (!page) {
          page = {
            id: `page:${urlPath}`,
            urlPath,
            title: urlPath,
            coverage: 'tested',
            reachedBy: [test.role],
            tests: [],
            source: 'fallback',
            fallbackReason: test.docSource ? 'no-ai' : undefined,
          };
          pagePlan.pages.push(page);
        }
        if (page.coverage === 'covered') page.coverage = 'promoted';
        if (!page.tests.some((t) => t.id === test.id)) page.tests.push(test);
      }
      const ids = new Set([...aiReached, ...spec.documented.reachedIds]);
      const unitIds = new Set(units.map((u) => u.id));
      const merged = new Map<string, NonNullable<typeof pagePlan.notFound>[number]>();
      for (const n of spec.notFound) merged.set(n.id, n);
      pagePlan.notFound = [...merged.values()];
      pagePlan.documentedItems = {
        total: unitIds.size,
        reached: [...unitIds].filter((id) => ids.has(id)).length,
      };
      exploration.notes.push(...spec.notes);
    }

    // Rejects and Limits items that would press a Safety Filter control are asked about, once per form.
    ambiguityQuestions.push(
      ...intentQuestionsFor(
        pagePlan.pages,
        new SafetyFilter(options.profile?.forbiddenActions || []),
        ambiguityQuestions.length + 1
      )
    );

    const draft: DiscoveryDraft = {
      version: '1.0',
      productId: options.productId,
      targetUrl: options.targetUrl,
      timestamp: new Date().toISOString(),
      siteType,
      pages: spiderResult.pages,
      forms: spiderResult.forms.map((f) => ({
        urlPath: f.urlPath,
        inputs: f.inputs.map((i) => ({
          selector: i.selector,
          type: i.type,
          label: i.label,
          required: i.required,
          pattern: i.pattern,
          min: i.min,
          max: i.max,
          minLength: i.minLength,
          maxLength: i.maxLength,
        })),
        submitButtonSelector: f.submitButtonSelector,
        method: f.method,
        ...(f.opening?.length ? { opening: f.opening } : {}),
      })),
      flows: synthesizedFlows,
      sensitiveActions: spiderResult.sensitiveActions,
      ambiguityQuestions,
      rawContextSummary: parsedContext.summary,
      usedFallbackSynthesis,
      exploration,
      readOnly: options.readOnly || undefined,
      plan: {
        pages: pagePlan.pages,
        navigation: pagePlan.navigation,
        layoutGroups,
        otherHosts: graph.otherHosts,
        ...(pagePlan.plannedWhileCrawling ? { plannedWhileCrawling: true } : {}),
        ...(pagePlan.notFound ? { notFound: pagePlan.notFound } : {}),
        ...(pagePlan.documentedItems ? { documentedItems: pagePlan.documentedItems } : {}),
        budget: {
          needed: requestsNeeded,
          used: paced?.used ?? 0,
          left: requestsLeft !== undefined ? (paced ? paced.left : requestsLeft) : undefined,
          limit: options.aiBudget?.limit,
          visualReview: options.aiBudget?.visualReview,
          // Counted from the items, as the approval summary counts them.
          overBudget:
            pagePlan.overBudget +
              synthesizedFlows.filter((f) => f.source === 'fallback' && f.fallbackReason === 'budget').length ||
            undefined,
          ...(options.aiPacing?.cap ? { cap: options.aiPacing.cap } : {}),
          ...(paced && paced.concurrency > 1 ? { concurrency: paced.concurrency } : {}),
          ...(paced && options.aiPacing?.price ? { spentUsd: paced.spentUsd } : {}),
          tokens: paced && Object.keys(paced.tokens).length > 0 ? paced.tokens : undefined,
          models: paced && Object.keys(paced.models).length > 0 ? paced.models : undefined,
        },
      },
    };
    // Journeys that send a form are marked on every site; on a live one they're kept but not run.
    markJourneysNeedingTestCopy(draft);

    // A plan never holds credentials: sign-in details become placeholders the runner fills in,
    // and anything left that looks secret is hidden before the draft is saved or returned.
    for (const flow of draft.flows) replaceCredentialsWithPlaceholders(flow.steps, roles);
    const safeDraft = redactor.deep(draft);

    const draftPath = path.join(outputDir, 'discovery-draft.json');
    await fs.writeFile(draftPath, JSON.stringify(safeDraft, null, 2), 'utf8');
    console.log(`[DiscoveryAgent] Discovery draft saved to ${draftPath}`);

    return { draft: safeDraft, preflight, timing: timer.enabled ? timer.entries : undefined };
  }
}
