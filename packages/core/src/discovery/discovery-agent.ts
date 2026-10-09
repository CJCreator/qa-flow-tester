import { promises as fs } from 'fs';
import path from 'path';
import type { ProductProfile, DiscoveryDraft, DiscoveredFlow, AmbiguityQuestion, PageInventoryItem, StorageStateData, SignInFailureReason, RunCap } from '@qa/types';
import { signInReasonText } from '@qa/types';
import { PlanValidator } from './plan-validator.js';
import { BrowserManager, BREAKPOINT_VIEWPORTS } from '../browser.js';
import { PreFlightChecker } from '../preflight.js';
import { DeterministicSpider, DEFAULT_MAX_PAGES, type SpiderResult } from './deterministic-spider.js';
import { buildSiteGraph, pathOf } from '../plan/site-graph.js';
import { sampleLayoutGroups } from '../plan/sampling.js';
import { PlanPipeline } from '../plan/pipeline.js';
import { lookAtNarrowScreens } from '../plan/narrow-look.js';
import { estimatePageRequests, planPagesAndMenus, testedPages } from '../plan/ai-planner.js';
import { PacedAI } from '../plan/ai-budget.js';
import { planJourneys } from '../plan/journeys.js';
import { ContextParser } from './context-parser.js';
import { Redactor } from '../redact.js';
import { replaceCredentialsWithPlaceholders } from '../credentials.js';
import { detectSiteType, type SiteType } from './site-type.js';
import { formQuestion } from './questions.js';
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
  /**
   * Rollback: plan only after the whole crawl, as before the pipeline. Default: with an AI provider,
   * pages are planned while the Spider is still crawling.
   */
  sequentialPlanning?: boolean;
}

/** How a scan is going. */
export type DiscoveryProgress =
  | { stage: 'crawling'; pagesFound: number; urlPath: string; who: string; plannedSoFar?: number }
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
  return {
    signedInAs,
    signInFailed,
    ...(Object.keys(signInFailures).length > 0 ? { signInFailures } : {}),
    signInPages,
    notReached: merged.signInWalls,
    notes,
  };
}

export class DiscoveryAgent {
  private browserManager = new BrowserManager();
  private contextParser = new ContextParser();

  async discover(options: DiscoveryOptions): Promise<DiscoveryDraft> {
    try {
      return await this.discoverSite(options);
    } finally {
      // Also when the scan is stopped or fails part-way: no browser is left running.
      await this.browserManager.close().catch(() => {});
    }
  }

  private async discoverSite(options: DiscoveryOptions): Promise<DiscoveryDraft> {
    const outputDir = options.outputDir || path.join(process.cwd(), '.qa-report');
    await fs.mkdir(outputDir, { recursive: true });
    const signal = options.signal;
    stopIfAborted(signal);

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
        ? await new PreFlightChecker().runPreFlight(options.targetUrl, options.profile, undefined, {
            browserManager: this.browserManager,
            authDir: options.authDir || path.join(outputDir, 'auth'),
            suppliedSessions: options.suppliedSessions,
          })
        : undefined;
    stopIfAborted(signal);

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
    let planningProgress: (done: number, what: string, asking?: { attempt?: number }, total?: number) => void = () => {};
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
    const crawlOptions: CrawlOptions = {
      robots: ownMachine ? undefined : await RobotsPolicy.fetch(targetOrigin.origin, CRAWLER_TOKEN),
      pageDelayMs: ownMachine ? 0 : PUBLIC_SITE_PAGE_DELAY_MS,
      screenshotDir: path.join(outputDir, 'plan-pages'),
      // Stopping to plan what's found ends the crawl the same way as stopping outright.
      signal:
        options.finishSignal && signal
          ? AbortSignal.any([signal, options.finishSignal])
          : (options.finishSignal ?? signal),
    };
    const newContext = async (storageState?: string | StorageStateData) => {
      const context = await this.browserManager.createContext({ baseUrl: options.targetUrl, storageState });
      if (options.readOnly) await blockChanges(context);
      return context;
    };

    console.log(`[DiscoveryAgent] Crawling routes and interactive forms on ${options.targetUrl}...`);
    // Pages found so far across every explorer, for the progress screen.
    let pagesFound = 0;
    const onPage = (who: string) => (page: PageInventoryItem, _n: number, forms: SpiderResult['forms'] = []) => {
      pipeline?.push(page, who, forms);
      options.onProgress?.({
        stage: 'crawling',
        pagesFound: ++pagesFound,
        urlPath: page.urlPath,
        who,
        plannedSoFar: pipeline?.plannedSoFar,
      });
    };
    // Pages the person added by address last time: no link leads there, so they're visited directly.
    const addedBefore = Object.entries(options.remembered?.pages || {})
      .filter(([, page]) => page.added)
      .map(([urlPath]) => urlPath);
    const visitorContext = await newContext();
    crawls.push({
      who: 'visitor',
      result: await spider.crawl(visitorContext, options.targetUrl, {
        ...crawlOptions,
        startPaths: addedBefore,
        screenshotPrefix: 'visitor',
        onPage: onPage('visitor'),
      }),
    });
    await visitorContext.close();
    stopIfAborted(signal);

    const signInFailed: string[] = [];
    const signInFailures: Record<string, SignInFailureReason> = {};
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
      crawls.push({
        who: role.role,
        result: await spider.crawl(roleContext, options.targetUrl, {
          ...crawlOptions,
          startPaths: landing ? [landing] : [],
          screenshotPrefix: `role-${crawls.length}`,
          onPage: onPage(role.role),
        }),
      });
      await roleContext.close();
      stopIfAborted(signal);
    }

    const spiderResult = mergeCrawls(crawls);
    const exploration = describeExploration(crawls, spiderResult, signInFailed, signInFailures);
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
      }) +
      (reuseJourneys ? 0 : 1);
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

    const draft: DiscoveryDraft = {
      version: '1.0',
      productId: options.productId,
      targetUrl: options.targetUrl,
      timestamp: new Date().toISOString(),
      siteType,
      pages: spiderResult.pages,
      forms: spiderResult.forms.map((f) => ({
        urlPath: f.urlPath,
        inputs: f.inputs.map((i) => ({ selector: i.selector })),
        submitButtonSelector: f.submitButtonSelector,
        method: f.method,
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

    return safeDraft;
  }
}
