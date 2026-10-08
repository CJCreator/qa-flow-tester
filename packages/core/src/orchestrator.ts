import path from 'path';
import type { BrowserContext, Page } from 'playwright';
import type {
  TestCase,
  ProductProfile,
  ReleaseReport,
  SiteMapSummary,
  TestPointResult,
  Finding,
  Breakpoint,
  RunCoverage,
  TraceabilityEntry,
  RetryTelemetryEntry,
  PageSpeedMap,
  SlowerThanLastTime,
} from '@qa/types';
import { normalizeRoute } from '@qa/types';
import { BrowserManager, BREAKPOINT_VIEWPORTS, locateElement } from './browser.js';
import { EvidenceCollector } from './evidence.js';
import { PreFlightChecker } from './preflight.js';
import { SourceLocator } from './source-locator.js';
import { ReproScriptGenerator } from './repro-generator.js';
import { ReportGenerator, withPortablePaths } from './reporter.js';
import { expandValidationTestCases } from './validator-expander.js';
import { SuppressionsManager } from './suppressions.js';
import { Redactor } from './redact.js';
import { mergeDuplicateFindings } from './finding-groups.js';
import { resolveCredentialPlaceholders } from './credentials.js';
import { blockChanges, NEEDS_TEST_COPY } from './live-site.js';
import { EntityNamespacer } from './entity-namespacing.js';
import { SendGuard, watchSends } from './send-guard.js';
import {
  BugDetectionChecker,
  SpecConformanceChecker,
  UXQualityChecker,
  PermissionMatrixChecker,
  DesignStandardsChecker,
  SecurityChecker,
  PerformanceChecker,
  SeoChecker,
  newMarketingLog,
  marketingReview,
  type DesignTokens,
} from '@qa/checkers';
import { calculateSiteAspectGrades } from './scoring.js';
import { generateRankedRecommendations } from './recommendations.js';
import { SiteHistoryManager } from './site-history.js';
import { findSlowerPages, pageSpeedKey } from './speed-change.js';
import { generateSingleFileHtmlReport } from './html-report.js';
import { abortError, isAbortError } from './abort.js';
import { RetryRunner } from './retry-runner.js';
import { createStepBudget, resolveStepTimeoutMs } from './step-budget.js';

/** The steps of a test point failed. Thrown inside a retry attempt so the runner can try again. */
class StepsFailed extends Error {
  constructor(message?: string) {
    super(message ?? 'A step failed');
  }
}
import { promises as fs } from 'fs';

export type OrchestratorEvent =
  | {
      type: 'RUN_STARTED';
      runId: string;
      targetUrl: string;
      productId: string;
      testCaseCount: number;
      /** 'safe-public' for a read-only website scan; absent for a full product run. */
      mode?: 'safe-public';
    }
  | { type: 'PREFLIGHT_STARTED'; roles: string[] }
  | {
      type: 'TEST_POINT_STARTED';
      testCaseId: string;
      testCaseName: string;
      role: string;
      breakpoint: Breakpoint;
      /** 0-based position among all test points in this run. */
      index: number;
      total: number;
      /** The page the test point opens first. */
      startPage?: string;
      /** The journey it belongs to ('page-sweep' for a page visit). */
      flowId?: string;
    }
  | { type: 'STEP_STARTED'; stepIndex: number; stepName: string; action: string; target?: string; testCaseId: string }
  | {
      type: 'STEP_COMPLETED';
      stepIndex: number;
      passed: boolean;
      durationMs: number;
      error?: string;
      screenshotUrl?: string;
      /** The page the browser is on after the step. */
      urlPath?: string;
      testCaseId?: string;
    }
  | {
      type: 'FINDINGS_UPDATED';
      totalFindings: number;
      /** The issues this test point found, so a live view can pin them to their page. */
      latest?: Array<{
        id: string;
        title: string;
        severity: Finding['severity'];
        checker: Finding['checker'];
        urlPath: string;
        breakpoint: Breakpoint;
      }>;
    }
  | { type: 'RUN_COMPLETED'; runId: string; report: ReleaseReport }
  /**
   * Emitted after discovery completes in a run that pauses for review (i.e. skipReview was not
   * true). The wizard can open /api/runner/plan and show the map. Testing will not start until
   * POST /api/runner/plan/approve arrives.
   */
  | {
      type: 'PLAN_READY';
      runId: string;
      pageCount: number;
      flowCount: number;
      questionCount: number;
      timestamp: number;
    }
  /**
   * Emitted when the user approves (or skipReview bypasses) the plan and the runner moves from
   * awaiting-review into the testing phase.
   */
  | { type: 'TESTING_STARTED'; runId: string; testCaseCount: number; timestamp: number };

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Deletes every `.webm` in one test point's folder except `keep`. The speed check opens an extra
 * tab in the same recorded context, so a point can hold more than one clip. Best effort: never throws.
 */
export async function removeVideosExcept(dir: string, keep?: string): Promise<void> {
  try {
    const keepPath = keep ? path.resolve(keep) : undefined;
    const names = await fs.readdir(dir);
    for (const name of names) {
      if (!name.toLowerCase().endsWith('.webm')) continue;
      const full = path.resolve(dir, name);
      if (full === keepPath) continue;
      await fs.rm(full, { force: true }).catch(() => {});
    }
  } catch {
    // Missing folder or unreadable: nothing to clean.
  }
}

/** The site a run is for, as rules about it are kept: "localhost:3050". */
function siteHostOf(targetUrl: string): string | undefined {
  try {
    return new URL(targetUrl).host;
  } catch {
    return undefined;
  }
}

/**
 * Where a finding was, as a path on the site: "/dashboard", never "http://localhost:3050/dashboard",
 * so one page is never counted as two. A page on another host keeps its full address.
 */
export function sitePathOf(urlPath: string, targetUrl: string): string {
  try {
    const target = new URL(targetUrl);
    const url = new URL(urlPath, target);
    const route = normalizeRoute(url.pathname);
    return url.host === target.host ? route : url.origin + route;
  } catch {
    return normalizeRoute(urlPath);
  }
}

/**
 * Opens a link's address with one request and fails only when the link is broken: the page is
 * gone (404, 410), the server fails (5xx), or nothing answers. Sites that turn automated requests
 * away (401, 403, 429, 999) can't be judged this way, so they pass.
 */
async function checkLink(page: Page, address: string): Promise<void> {
  let status: number;
  try {
    const res = await page.request.get(address, { timeout: 10000, maxRedirects: 10, failOnStatusCode: false });
    status = res.status();
  } catch (err) {
    throw new Error(
      `The link doesn’t open: ${address} (${(err instanceof Error ? err.message : String(err)).split('\n')[0]})`
    );
  }
  if (status === 404 || status === 410 || status >= 500)
    throw new Error(`The link is broken: ${address} answered ${status}`);
}

/** The checks a test point runs, in plain words, and how each went. */
function checksRun(
  findings: Finding[],
  ran: { spec: boolean; permissions: boolean; design: boolean; ux: boolean; pageLevel: boolean; search: boolean }
): NonNullable<TestPointResult['checks']> {
  const outcome = (checker: Finding['checker']) => {
    const own = findings.filter((f) => f.checker === checker);
    if (own.some((f) => !f.needsConfirmation)) return 'failed' as const;
    return own.length > 0 ? ('could-not-verify' as const) : ('passed' as const);
  };
  const checks: NonNullable<TestPointResult['checks']> = [
    { checker: 'bug-detection', name: 'Works without errors', outcome: outcome('bug-detection') },
  ];
  if (ran.ux)
    checks.push({ checker: 'ux-quality', name: 'Accessible and easy to use', outcome: outcome('ux-quality') });
  if (ran.pageLevel) {
    checks.push(
      { checker: 'security', name: 'Secure connections and headers', outcome: outcome('security') },
      { checker: 'performance', name: 'Fast and mobile-ready', outcome: outcome('performance') }
    );
    if (ran.search) checks.push({ checker: 'seo', name: 'Search and link health', outcome: outcome('seo') });
  }
  if (ran.spec)
    checks.splice(1, 0, {
      checker: 'spec-conformance',
      name: 'Does what was expected',
      outcome: outcome('spec-conformance'),
    });
  if (ran.permissions)
    checks.push({
      checker: 'permission-matrix',
      name: 'Only the right people can see it',
      outcome: outcome('permission-matrix'),
    });
  if (ran.design)
    checks.push({ checker: 'design-standards', name: 'Matches the design', outcome: outcome('design-standards') });
  return checks;
}

export interface RunOptions {
  targetUrl: string;
  productId: string;
  specTestCases: TestCase[];
  profile?: ProductProfile;
  headless?: boolean;
  tunnelAuth?: string;
  outputDir?: string;
  breakpoints?: Breakpoint[];
  repoRoot?: string;
  enableA11y?: boolean;
  enableSeo?: boolean;
  /**
   * Check how search engines and AI assistants see the site (default true). Off for a site that
   * isn't public, such as a test copy: then only link health is checked.
   */
  searchChecks?: boolean;
  visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean };
  enablePerformance?: boolean;
  enableSecurity?: boolean;
  /** Record a video per test point; kept only when the point fails. Default true. */
  recordVideo?: boolean;
  /** Overwrite visual baselines with this run's screenshots instead of comparing against them. */
  updateBaselines?: boolean;
  onEvent?: (event: OrchestratorEvent) => void;
  /** Override the generated runId (e.g. so a caller can respond with an id before the run starts and have RUN_STARTED/RUN_COMPLETED carry the same id). Defaults to an internally generated `run-<timestamp>`. */
  runId?: string;
  /** Sentences to show in the report about coverage, e.g. from discovery ("pages behind the sign-in were not reached"). */
  reportNotes?: string[];
  /** The AI models that planned this run, named in the report. */
  aiModels?: { text?: string; vision?: string };
  /**
   * The site isn't a test copy: every request that could change data is blocked, and a journey that
   * tries to send data is reported as needing a test copy rather than as broken.
   */
  readOnly?: boolean;
  /** Planned tests that won't run, and why, e.g. a journey that needs a test copy on a live site. */
  notRun?: Array<{ id: string; flowId: string; name: string; role: string; reason: string }>;
  /** The site as the plan saw it, kept in the report so it can be drawn as a map. */
  siteMap?: SiteMapSummary;
  /** Stops the run between steps and test points: the browser closes and run() throws an AbortError. */
  signal?: AbortSignal;
  /** Finishes early: no more tests start, and the report is made from what's done, marked as partial. */
  finishSignal?: AbortSignal;
  /** Where sign-in sessions are saved. Default `<outputDir>/auth`. Keep it out of any folder that's served. */
  authDir?: string;
  /** Where suppressions and the previous run's findings (for the delta) live. Default outputDir. */
  stateDir?: string;
  /** How screenshots are addressed in STEP_COMPLETED: this prefix plus the path inside outputDir. Default `/api/evidence/`. */
  evidenceUrlPrefix?: string;
  /** The data folder that holds each site's grade history (`<dataDir>/sites`). Default `.qa-data` in the working folder. */
  dataDir?: string;
  /** Recorded in the report when "Test again" skipped the review: when the plan it used was approved. */
  testedWithApprovedPlan?: string;
  /** Most time one test step may spend finding and acting on its element, in ms, across retries. Default 10000. */
  stepTimeoutMs?: number;
}

export class FlowTestOrchestrator {
  private browserManager = new BrowserManager();
  private preflightChecker = new PreFlightChecker();
  private bugChecker = new BugDetectionChecker();
  private specChecker = new SpecConformanceChecker();
  private uxChecker = new UXQualityChecker();
  private designChecker = new DesignStandardsChecker();
  private securityChecker = new SecurityChecker();
  private performanceChecker = new PerformanceChecker();
  private seoChecker = new SeoChecker();

  async run(options: RunOptions): Promise<ReleaseReport> {
    const startTime = Date.now();
    const runId = options.runId || `run-${Date.now()}`;
    // Nothing the run streams or writes may carry a sign-in detail.
    const redactor = new Redactor(options.profile?.roles || []);
    const emitEvent = options.onEvent || (() => {});
    const onEvent = (event: OrchestratorEvent) => emitEvent(redactor.deep(event));
    const outputDir = options.outputDir || path.join(process.cwd(), '.qa-report');
    const evidenceDir = path.join(outputDir, 'evidence');
    const authDir = options.authDir || path.join(outputDir, 'auth');
    const repoRoot = options.repoRoot || process.cwd();
    const evidenceUrlPrefix = options.evidenceUrlPrefix ?? '/api/evidence/';

    const sourceLocator = new SourceLocator(repoRoot);
    const reproGenerator = new ReproScriptGenerator(evidenceDir);
    const reportGenerator = new ReportGenerator(outputDir);
    const suppressionsManager = new SuppressionsManager(options.stateDir || outputDir);

    // Expand validation rules into synthetic test cases up front so RUN_STARTED can report
    // an accurate test case count and subscribers know a run has begun before pre-flight
    // (which can itself take several seconds, or fail outright).
    const testCasesToRun = expandValidationTestCases(options.specTestCases);
    onEvent({
      type: 'RUN_STARTED',
      runId,
      targetUrl: options.targetUrl,
      productId: options.productId,
      testCaseCount: testCasesToRun.length,
    });

    onEvent({ type: 'PREFLIGHT_STARTED', roles: (options.profile?.roles || []).map((r) => r.role) });
    console.log(`[QA Orchestrator] Running Pre-flight health check on ${options.targetUrl}...`);
    const preflight = await this.preflightChecker.runPreFlight(options.targetUrl, options.profile, options.tunnelAuth, {
      browserManager: this.browserManager,
      authDir,
    });

    if (!preflight.ok) {
      throw new Error(`Pre-flight check failed: ${preflight.error}`);
    }
    console.log(`[QA Orchestrator] Pre-flight check PASSED.`);

    // Asked to stop: the browser closes and the run ends here, with no report.
    const stopHere = async () => {
      if (!options.signal?.aborted) return;
      await this.browserManager.close().catch(() => {});
      throw abortError();
    };
    await stopHere();

    const roleStorageStates = preflight.roleStorageStates || {};
    const notes = [...(options.reportNotes || [])];
    for (const [role, ok] of Object.entries(preflight.roleAuthResults)) {
      const note = `Signing in as "${role}" didn't work, so tests for that role ran signed out.`;
      if (!ok && !notes.includes(note)) notes.push(note);
    }

    // Initialize Permission Matrix Checker if available in profile
    let permChecker: PermissionMatrixChecker | undefined;
    if (options.profile?.permissionMatrix) {
      permChecker = new PermissionMatrixChecker(options.profile.permissionMatrix);
    } else if (options.profile?.permissionMatrixFile) {
      try {
        const matrixContent = await fs.readFile(options.profile.permissionMatrixFile, 'utf8');
        permChecker = new PermissionMatrixChecker(matrixContent);
        console.log(`[QA Orchestrator] Loaded permission matrix from ${options.profile.permissionMatrixFile}`);
      } catch (err) {
        console.warn(`[QA Orchestrator] Could not load permission matrix from ${options.profile.permissionMatrixFile}`);
      }
    }

    let designTokens: DesignTokens | undefined;
    if (options.profile?.figmaTokensFile) {
      try {
        designTokens = JSON.parse(await fs.readFile(path.resolve(options.profile.figmaTokensFile), 'utf8'));
      } catch {
        console.warn(`[QA Orchestrator] Could not load design tokens from ${options.profile.figmaTokensFile}`);
      }
    }
    const baselineDir = path.resolve(options.profile?.visualBaselineDir || '.qa-baselines');
    const recordVideo = options.recordVideo ?? true;

    const breakpoints: Breakpoint[] = options.breakpoints || ['1440px'];
    const results: TestPointResult[] = [];
    const allFindings: Finding[] = [];

    // Running step counter across all test cases x breakpoints (not reset per test case),
    // so UI consumers of STEP_STARTED/STEP_COMPLETED see one continuously advancing sequence
    // for the whole run rather than restarting at 0 for every test point.
    let globalStepIndex = 0;
    // A test can be limited to some screen sizes (a link check runs once, at the first).
    const sizesFor = (tc: TestCase) =>
      tc.breakpoints ? breakpoints.filter((b) => tc.breakpoints!.includes(b)) : breakpoints;
    const plannedTestPoints = testCasesToRun.reduce((n, tc) => n + sizesFor(tc).length, 0);

    // Facts about the whole site (its icon, its phone set-up) are reported once per run.
    const siteWide = new Set<string>();
    // What the marketing basics found, page by page, for the report's checklist.
    const marketingLog = newMarketingLog();

    // Pages whose vitals were already measured with repeat loads in this run.
    const vitalsMeasured = new Set<string>();
    // Speed numbers from those repeat loads, kept in site history for the next check-up.
    const speedSamples: PageSpeedMap = {};
    const wantsRepeatLoads = (urlPath: string, bp: Breakpoint, sizes: Breakpoint[]) => {
      if (bp !== (sizes.includes('375px') ? '375px' : sizes[0]) || vitalsMeasured.has(urlPath)) return false;
      vitalsMeasured.add(urlPath);
      return true;
    };
    tests: for (const testCase of testCasesToRun) {
      // Which checkers run afterwards depends on the kind of Plan Item (see TestCase.kind).
      const kind = testCase.kind;
      const lightChecks = kind === 'navigation' || kind === 'link';
      const pageLevelChecks = !kind || kind === 'page' || kind === 'journey';
      // A page's search checks look at its markup, which is the same at every width: one width is enough.
      const sizes = sizesFor(testCase);
      const searchSize = sizes.includes('1440px') ? '1440px' : sizes[sizes.length - 1];
      for (const bp of sizesFor(testCase)) {
        await stopHere();
        if (options.finishSignal?.aborted) break tests;
        onEvent({
          type: 'TEST_POINT_STARTED',
          testCaseId: testCase.id,
          testCaseName: testCase.name || testCase.flowId,
          role: testCase.role,
          breakpoint: bp,
          index: results.length,
          total: plannedTestPoints,
          startPage: testCase.startPage,
          flowId: testCase.flowId,
        });
        console.log(
          `[QA Orchestrator] Executing ${testCase.id} ("${testCase.flowId}") on ${bp} as ${testCase.role}...`
        );
        const pointStartTime = Date.now();
        const testCaseEvidenceDir = path.join(evidenceDir, `${testCase.id}-${bp}`);
        let evidenceCollector = new EvidenceCollector(testCaseEvidenceDir);

        const storageState = roleStorageStates[testCase.role];

        let context: BrowserContext | undefined;
        // Set inside the retry attempt, which always opens it before anything below uses it.
        let page = undefined as unknown as Page;
        let testPointPassed = true;
        let stepError: string | undefined;
        let pointResult: TestPointResult | undefined;
        let flakyRetry: RetryTelemetryEntry | undefined;
        let blockedChanges: string[] = [];
        /** Lists where the planned option wasn't there, and what was picked instead. */
        const substitutes: Array<{ step: string; planned: string; chosen: string }> = [];
        // Test Copy only: one token per Test point, shared by both attempts, and a memory of any form sent.
        const runToken = options.readOnly ? undefined : EntityNamespacer.runToken(runId, testCase.id, bp);
        const sendGuard = options.readOnly ? undefined : SendGuard.forUrl(options.targetUrl);

        try {
          // Steps run in a fresh browser context. One that fails is thrown away and run once more
          // from a clean start, so a passing second attempt shows as flaky instead of failing.
          const runAttempt = async (attempt: number): Promise<void> => {
            if (attempt > 1) {
              const discarded = page?.video();
              await context?.close().catch(() => {});
              const discardedPath = discarded ? await discarded.path().catch(() => undefined) : undefined;
              if (discardedPath) await fs.rm(discardedPath, { force: true }).catch(() => {});
              // Also the extra tab's clip from the speed check.
              await removeVideosExcept(testCaseEvidenceDir);
              evidenceCollector = new EvidenceCollector(testCaseEvidenceDir);
              testPointPassed = true;
              stepError = undefined;
              substitutes.length = 0;
            }
            ({ context, page } = await this.browserManager.openPage({
              headless: options.headless ?? true,
              viewport: BREAKPOINT_VIEWPORTS[bp],
              tunnelAuth: options.tunnelAuth,
              baseUrl: options.targetUrl,
              storageState,
              recordVideoDir: recordVideo ? testCaseEvidenceDir : undefined,
            }));

            // On a live site nothing that could change data leaves the browser.
            blockedChanges = options.readOnly ? await blockChanges(context) : [];
            if (sendGuard) watchSends(context, sendGuard);
            evidenceCollector.attach(page);

            const startUrl = new URL(testCase.startPage, options.targetUrl).toString();
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

            // Execute each step with up to 2 retries
            for (let i = 0; i < testCase.steps.length; i++) {
              await stopHere();
              const step = testCase.steps[i];
              // A step for other screen sizes, such as opening a phone menu, isn't done at this one.
              if (step.onlyAt && !step.onlyAt.includes(bp)) continue;
              const urlBefore = page.url();
              let stepSuccess = false;
              let currentStepError: string | undefined;
              const currentGlobalStepIndex = globalStepIndex++;
              const stepStartedAt = Date.now();

              onEvent({
                type: 'STEP_STARTED',
                stepIndex: currentGlobalStepIndex,
                stepName: step.name,
                action: step.action,
                target: step.selector || step.value,
                testCaseId: testCase.id,
              });

              // An optional step gets one quick try: if the control isn't there at this width, it isn't.
              // A link check is one request, never repeated at a site we don't own.
              const MAX_RETRIES = step.optional || step.action === 'check-link' ? 0 : 2;
              // One time budget for the whole step: finding the element, every try and the waits between.
              const budget = createStepBudget(resolveStepTimeoutMs(options.stepTimeoutMs), stepStartedAt);
              for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                // The last try gets all the time left, so a raised cap is used; earlier tries keep 4 s.
                const waitTimeout = (): number =>
                  step.optional
                    ? budget.clamp(1500)
                    : attempt === MAX_RETRIES
                      ? budget.clamp(Infinity)
                      : budget.clamp(4000);
                try {
                  if (step.action === 'click') {
                    const locator = await locateElement(page, step.selector || '');
                    await locator.waitFor({ state: 'visible', timeout: waitTimeout() });
                    sendGuard?.clickStarted(i);
                    await locator.click({ timeout: budget.clamp(step.optional ? 1500 : 4000) });
                  } else if (step.action === 'fill') {
                    const locator = await locateElement(page, step.selector || '');
                    await locator.waitFor({ state: 'visible', timeout: waitTimeout() });
                    const planned = runToken ? EntityNamespacer.namespaceFillValue(step, runToken) : step.value || '';
                    const value = resolveCredentialPlaceholders(planned, testCase.role, options.profile?.roles || []);
                    await locator.fill(value, { timeout: budget.clamp(4000) });
                  } else if (step.action === 'select') {
                    const locator = await locateElement(page, step.selector || '');
                    await locator.waitFor({ state: 'visible', timeout: waitTimeout() });
                    try {
                      await locator.selectOption(step.value || '', { timeout: budget.clamp(2000) });
                    } catch {
                      // Resilient fallback: case-insensitive or partial match across options
                      const targetVal = (step.value || '').trim().toLowerCase();
                      const matched = await locator
                        .evaluate((select: HTMLSelectElement, target: string) => {
                          const options = Array.from(select.options);
                          const exact = options.find(
                            (o) => o.value.toLowerCase() === target || o.text.toLowerCase() === target
                          );
                          if (exact) return { value: exact.value, text: exact.text, exact: true };
                          const partial = options.find(
                            (o) =>
                              (target && o.value.toLowerCase().includes(target)) ||
                              (target && o.text.toLowerCase().includes(target)) ||
                              (o.value && target.includes(o.value.toLowerCase())) ||
                              (o.text && target.includes(o.text.toLowerCase()))
                          );
                          if (partial) return { value: partial.value, text: partial.text, exact: false };
                          return options.length > 1
                            ? { value: options[1].value, text: options[1].text, exact: false }
                            : undefined;
                        }, targetVal)
                        .catch(() => undefined);
                      if (!matched)
                        throw new Error(`The list has no option “${step.value}”, and no other option to pick.`);
                      await locator.selectOption(matched.value, { timeout: budget.clamp(2000) });
                      // Another option than the planned one: the step goes on, but what follows can't
                      // say whether the site handles the planned value.
                      if (!matched.exact)
                        substitutes.push({
                          step: step.name,
                          planned: step.value || '',
                          chosen: matched.text.trim() || matched.value,
                        });
                    }
                  } else if (step.action === 'navigate') {
                    await page.goto(new URL(step.value || '', options.targetUrl).toString(), {
                      waitUntil: 'domcontentloaded',
                      timeout: 10000,
                    });
                  } else if (step.action === 'wait') {
                    await page.waitForTimeout(1000);
                  } else if (step.action === 'check-link') {
                    await checkLink(page, step.value || '');
                  }

                  await page.waitForTimeout(300);
                  stepSuccess = true;
                  currentStepError = undefined;
                  break;
                } catch (err: unknown) {
                  // Playwright colours its messages for terminals; reports want plain text.
                  currentStepError = (err instanceof Error ? err.message : String(err)).replace(/\x1b\[[0-9;]*m/g, '');
                  // The step's time is used up: another try would only run past the cap.
                  if (attempt < MAX_RETRIES && budget.remaining() > 500) {
                    await page.waitForTimeout(Math.min(500, budget.remaining()));
                  } else {
                    break;
                  }
                }
              }

              // An optional step that couldn't be done (a control that only shows at some widths)
              // is skipped, not failed, and the rest of the flow carries on.
              const skipped = !stepSuccess && !!step.optional;
              if (skipped) currentStepError = `Skipped: ${currentStepError}`;
              if (!stepSuccess && !skipped) {
                testPointPassed = false;
                stepError = currentStepError;
              }

              const stepEvidence = await evidenceCollector.recordStep(
                page,
                i + 1,
                step.name,
                step.action,
                urlBefore,
                stepSuccess,
                currentStepError
              );

              onEvent({
                type: 'STEP_COMPLETED',
                stepIndex: currentGlobalStepIndex,
                passed: stepSuccess,
                durationMs: Date.now() - stepStartedAt,
                error: currentStepError,
                screenshotUrl: stepEvidence.screenshotPath
                  ? `${evidenceUrlPrefix}${path.relative(outputDir, stepEvidence.screenshotPath).replace(/\\/g, '/')}`
                  : undefined,
                urlPath: pathOf(page.url()),
                testCaseId: testCase.id,
              });

              // If a step fails after retries, cascade remaining steps as Blocked
              if (!stepSuccess && !skipped) {
                for (let j = i + 1; j < testCase.steps.length; j++) {
                  const blockedStep = testCase.steps[j];
                  if (blockedStep.onlyAt && !blockedStep.onlyAt.includes(bp)) continue;
                  const blockedStepIndex = globalStepIndex++;
                  onEvent({
                    type: 'STEP_STARTED',
                    stepIndex: blockedStepIndex,
                    stepName: blockedStep.name,
                    action: blockedStep.action,
                    target: blockedStep.selector || blockedStep.value,
                    testCaseId: testCase.id,
                  });
                  await evidenceCollector.recordStep(
                    page,
                    j + 1,
                    blockedStep.name,
                    blockedStep.action,
                    page.url(),
                    false,
                    `Blocked: Previous step "${step.name}" failed`
                  );
                  onEvent({
                    type: 'STEP_COMPLETED',
                    stepIndex: blockedStepIndex,
                    passed: false,
                    durationMs: 0,
                    error: `Blocked: Previous step "${step.name}" failed`,
                  });
                }
                break;
              }
            }

            if (!testPointPassed) throw new StepsFailed(stepError);
          };
          const attemptResult = await RetryRunner.runWithCleanRetry(runAttempt, {
            flowId: testCase.flowId,
            testCaseId: testCase.id,
            // A link check is one request, never repeated at a site we don't own.
            maxRetries: testCase.kind === 'link' ? 0 : 1,
            // Once a form was sent, a second try would send it twice: decline the retry.
            shouldRetry: (err) => !isAbortError(err) && !sendGuard?.hasSentAny(),
          });
          if (
            attemptResult.outcome === 'FAILED' &&
            attemptResult.attempts === 1 &&
            testCase.kind !== 'link' &&
            !isAbortError(attemptResult.error) &&
            sendGuard?.hasSentAny()
          ) {
            stepError =
              `${stepError ?? ''} Not tried again: this test already sent a form, and a second try would send it twice.`.trim();
            console.log(
              `[QA Orchestrator] ${testCase.id} on ${bp}: not retried, a form was already sent (a retry would send it twice).`
            );
          }
          if (attemptResult.outcome === 'FAILED' && !(attemptResult.error instanceof StepsFailed)) {
            throw attemptResult.error;
          }
          if (attemptResult.outcome === 'FLAKY_PASSED') flakyRetry = attemptResult.telemetry;

          // Evaluate Checkers
          const stepEvidenceList = evidenceCollector.getStepEvidenceList();
          // Requests our own guard stopped are the tool's doing, not the site's.
          const blockedSet = new Set(blockedChanges);
          if (blockedSet.size > 0) {
            for (const s of stepEvidenceList) {
              s.failedRequests = s.failedRequests.filter((r) => !blockedSet.has(`${r.method.toUpperCase()} ${r.url}`));
              s.consoleErrors = s.consoleErrors.filter((c) => !c.text.includes('ERR_BLOCKED_BY_CLIENT'));
            }
          }

          // 1. Bug Detection
          const bugFindings = this.bugChecker.check(stepEvidenceList, {
            testCaseId: testCase.id,
            flowId: testCase.flowId,
            role: testCase.role,
            breakpoint: bp,
            urlPath: page.url(),
            planIsGuess: testCase.expectations?.origin === 'ai-guess',
          });

          // 2. Spec Conformance
          const observations: string[] = [];
          const specFindings = await this.specChecker.check(page, testCase, stepEvidenceList, {
            role: testCase.role,
            breakpoint: bp,
            baseUrl: options.targetUrl,
            onObservation: (o) => observations.push(o),
          });

          // 3. UX Quality (accessibility of the state the steps left): not for a Navigation Check,
          // whose destination page is checked by its own visit.
          const uxFindings = lightChecks
            ? []
            : await this.uxChecker.check(page, {
                testCaseId: testCase.id,
                role: testCase.role,
                breakpoint: bp,
                urlPath: new URL(page.url(), options.targetUrl).pathname,
                enableAxe: options.enableA11y ?? true,
                entryPath: new URL(options.targetUrl).pathname,
              });

          // 3b. Security (passive): passwords in page addresses. Page-level checks (security, speed,
          // findability, design) run on page visits and journeys, not on every test on a page.
          const securityFindings =
            options.enableSecurity === false || !pageLevelChecks
              ? []
              : [
                  ...this.securityChecker.checkEvidence(stepEvidenceList, {
                    testCaseId: testCase.id,
                    flowId: testCase.flowId,
                    role: testCase.role,
                    breakpoint: bp,
                  }),
                  ...(await this.securityChecker.checkPage(page, {
                    testCaseId: testCase.id,
                    flowId: testCase.flowId,
                    role: testCase.role,
                    breakpoint: bp,
                    urlPath: new URL(page.url(), options.targetUrl).pathname,
                    baseUrl: options.targetUrl,
                  })),
                ];

          // 3c. Performance (Speed, Web Vitals, Mobile Overflow & Overlap)
          const perfFindings =
            options.enablePerformance === false || !pageLevelChecks
              ? []
              : await this.performanceChecker.checkPage(page, {
                  testCaseId: testCase.id,
                  flowId: testCase.flowId,
                  role: testCase.role,
                  breakpoint: bp,
                  urlPath: new URL(page.url(), options.targetUrl).pathname,
                  onSpeed: (s) => {
                    speedSamples[pageSpeedKey(testCase.role, bp, new URL(page.url(), options.targetUrl).pathname)] = s;
                  },
                  // Throttled repeat loads cost minutes, so each page gets them once per run, at the
                  // phone width when there is one. Other widths read the vitals the page already had.
                  repeatLoads: wantsRepeatLoads(new URL(page.url(), options.targetUrl).pathname, bp, sizes)
                    ? 3
                    : undefined,
                });

          // 3d. SEO & Link Health
          const searchHere = options.enableSeo !== false && pageLevelChecks && bp === searchSize;
          const seoFindings = !searchHere
            ? []
            : await this.seoChecker.checkPage(page, {
                testCaseId: testCase.id,
                flowId: testCase.flowId,
                role: testCase.role,
                breakpoint: bp,
                urlPath: new URL(page.url(), options.targetUrl).pathname,
                baseUrl: options.targetUrl,
                searchChecks: options.searchChecks,
                visibility: options.visibility,
                siteWide,
                marketingLog,
              });

          // 4. Permission Matrix Check
          const permFindings: Finding[] = [];
          if (permChecker) {
            const currentPath = new URL(page.url(), options.targetUrl).pathname;
            const permFinding = permChecker.checkAccess({
              target: currentPath,
              role: testCase.role,
              breakpoint: bp,
              statusCode: 200,
              testCaseId: testCase.id,
            });
            if (permFinding) {
              permFindings.push(permFinding);
            }
          }

          // 5. Design tokens (Tier 1) and visual baseline (Tier 2)
          const designFindings: Finding[] = [];
          const urlPath = new URL(page.url(), options.targetUrl).pathname;
          if (designTokens && pageLevelChecks) {
            designFindings.push(
              ...(await this.designChecker.check(page, designTokens, {
                testCaseId: testCase.id,
                role: testCase.role,
                breakpoint: bp,
                urlPath,
              }))
            );
          }
          // Only a flow that completed reaches the screen the baseline was taken of.
          const baselinePath = path.join(baselineDir, `${testCase.id}-${bp}.png`);
          if (testPointPassed && pageLevelChecks) {
            if (options.updateBaselines) {
              await fs.mkdir(baselineDir, { recursive: true });
              await page.screenshot({ path: baselinePath, animations: 'disabled', caret: 'hide' });
            } else {
              const baseline = await fs.readFile(baselinePath).catch(() => null);
              if (baseline) {
                const current = await page.screenshot({ animations: 'disabled', caret: 'hide' });
                const diff = await this.designChecker.checkVisualDiff(current, baseline, {
                  maxDiffPercent: options.profile?.visualDiffMaxPercent,
                  diffOutputPath: path.join(testCaseEvidenceDir, 'visual-diff.png'),
                });
                if (!diff.match) {
                  designFindings.push(
                    this.designChecker.visualDiffFinding(diff, {
                      testCaseId: testCase.id,
                      role: testCase.role,
                      breakpoint: bp,
                      urlPath,
                      baselinePath: path.relative(process.cwd(), baselinePath).replace(/\\/g, '/'),
                    })
                  );
                }
              }
            }
          }

          // A journey that tried to send data to a live site couldn't be tested there: what it
          // expected, and any step after the blocked send, say nothing about the site.
          const targetHost = new URL(options.targetUrl).host;
          const sentData =
            testCase.flowId !== 'page-sweep' &&
            blockedChanges.some((b) => {
              try {
                return new URL(b.slice(b.indexOf(' ') + 1)).host === targetHost;
              } catch {
                return false;
              }
            });
          // A test that picked another option than planned couldn't check the planned one.
          const substituteFindings: Finding[] = substitutes.map((s, n) => ({
            id: `F-OPTION-${testCase.id}-${bp}-${n + 1}`,
            testCaseId: testCase.id,
            flowId: testCase.flowId,
            severity: 'Minor',
            checker: 'spec-conformance',
            title: `“${s.planned}” isn’t in the list, so “${s.chosen}” was picked instead`,
            where: { urlPath: pathOf(page?.url() ?? testCase.startPage), role: testCase.role, breakpoint: bp },
            expectedVsActual: {
              expected: `The option “${s.planned}” can be picked (${s.step})`,
              actual: `It isn’t there; “${s.chosen}” was picked, so the test can’t say how the planned option works`,
            },
            stepsToReproduce: [
              `Open ${testCase.startPage} as ${testCase.role} at ${bp}`,
              `${s.step}: look for “${s.planned}”`,
            ],
            evidence: {},
            resolution: `Check the plan’s value for this step, or whether “${s.planned}” should be offered.`,
            needsConfirmation: true,
          }));
          const keptFindings = [
            ...substituteFindings,
            ...bugFindings,
            ...specFindings,
            ...uxFindings,
            ...securityFindings,
            ...perfFindings,
            ...seoFindings,
            ...permFindings,
            ...designFindings,
          ].filter((f) => !sentData || (f.checker !== 'spec-conformance' && !f.id.startsWith('F-STEP-')));

          // Enrich findings with Source Code Locator and Repro Script
          for (const f of keptFindings) {
            f.where.urlPath = sitePathOf(f.where.urlPath, options.targetUrl);
            if (f.where.dataTestId) {
              const srcLoc = await sourceLocator.findByTestId(f.where.dataTestId);
              if (srcLoc) {
                f.sourceLocation = srcLoc;
              }
            }

            // Absolute here; the report makes it relative to the report folder, like every evidence path.
            f.reproScriptPath = await reproGenerator.generate(f, testCase, options.targetUrl);
            allFindings.push(f);
          }

          // Unconfirmed AI guesses never fail a test point on their own.
          const hasStepFailure = !testPointPassed && !sentData;
          const hasRealFinding = keptFindings.some((f) => !f.needsConfirmation);
          const hasGuessedFailure =
            testCase.expectations?.origin === 'ai-guess' &&
            keptFindings.some((f) => f.needsConfirmation && f.id.startsWith('F-STEP-'));
          const status: TestPointResult['status'] = sentData
            ? 'Skipped'
            : hasRealFinding || (hasStepFailure && !hasGuessedFailure)
              ? 'Failed'
              : keptFindings.length > 0
                ? 'Could not verify'
                : 'Passed';

          pointResult = {
            testCaseId: testCase.id,
            flowId: testCase.flowId,
            role: testCase.role,
            status,
            durationMs: Date.now() - pointStartTime,
            findings: keptFindings,
            stepEvidence: stepEvidenceList,
            error: stepError,
            observations: observations.length > 0 ? observations : undefined,
            skipReason: sentData ? NEEDS_TEST_COPY : undefined,
            breakpoint: bp,
            retry: flakyRetry,
            checks: checksRun(keptFindings, {
              ux: !lightChecks,
              pageLevel: pageLevelChecks,
              search: searchHere && options.searchChecks !== false,
              spec: !sentData && Object.keys(testCase.expectations || {}).some((k) => k !== 'origin'),
              permissions: !!permChecker,
              design: (!!designTokens && pageLevelChecks) || designFindings.length > 0,
            }),
          };
        } catch (fatalErr: unknown) {
          // Stopping isn't a failure of the site: nothing is recorded, and the run ends.
          if (isAbortError(fatalErr)) throw fatalErr;
          testPointPassed = false;
          const msg = (fatalErr instanceof Error ? fatalErr.message : String(fatalErr)).replace(/\x1b\[[0-9;]*m/g, '');
          // A test that couldn't run at all still says why: a failure with no finding explains nothing.
          const couldNotRun: Finding = {
            id: `F-RUN-${testCase.id}-${bp}`,
            testCaseId: testCase.id,
            flowId: testCase.flowId,
            severity: 'Major',
            checker: 'bug-detection',
            title: `Couldn’t run “${testCase.name || testCase.flowId}”`,
            where: { urlPath: testCase.startPage, role: testCase.role, breakpoint: bp },
            expectedVsActual: {
              expected: `${testCase.startPage} opens and the test can run`,
              actual: msg.split('\n')[0].substring(0, 300),
            },
            stepsToReproduce: [`Open ${testCase.startPage} as ${testCase.role} at ${bp}`],
            evidence: {},
            resolution:
              'Check the page loads at this address for this role; a timeout usually means the page is slow or the server stopped.',
          };
          allFindings.push(couldNotRun);
          pointResult = {
            testCaseId: testCase.id,
            flowId: testCase.flowId,
            role: testCase.role,
            status: 'Failed',
            durationMs: Date.now() - pointStartTime,
            findings: [couldNotRun],
            stepEvidence: evidenceCollector.getStepEvidenceList(),
            error: msg,
            breakpoint: bp,
            checks: [{ checker: 'bug-detection', name: 'Works without errors', outcome: 'failed' }],
          };
        } finally {
          // The video file is only finalized once its context closes.
          const video = page?.video();
          await context?.close().catch(() => {});
          if (video) {
            const videoPath = await video.path().catch(() => undefined);
            if (videoPath && pointResult?.status === 'Failed') {
              pointResult.videoPath = videoPath;
              for (const f of pointResult.findings) f.evidence.videoPath = videoPath;
            } else if (videoPath) {
              await fs.rm(videoPath, { force: true }).catch(() => {});
            }
          }
          // Extra tabs (the speed check's) record their own clips; keep only a failed point's main one.
          const kept = pointResult?.status === 'Failed' ? pointResult.videoPath : undefined;
          await removeVideosExcept(testCaseEvidenceDir, kept);
        }
        // A problem shows the screen it was found on: its own screenshot, or its test's latest one.
        const lastScreen = [...pointResult!.stepEvidence].reverse().find((s) => s.screenshotPath)?.screenshotPath;
        if (lastScreen) for (const f of pointResult!.findings) f.evidence.screenshotPath ??= lastScreen;
        results.push(pointResult!);
        onEvent({
          type: 'FINDINGS_UPDATED',
          totalFindings: allFindings.length,
          latest: pointResult!.findings.map((f) => ({
            id: f.id,
            title: f.title,
            severity: f.severity,
            checker: f.checker,
            urlPath: pathOf(new URL(f.where.urlPath, options.targetUrl).toString()),
            breakpoint: f.where.breakpoint,
          })),
        });
      }
    }

    await this.browserManager.close();
    if (options.finishSignal?.aborted) {
      notes.unshift(
        `A partial check-up: testing was stopped after ${results.length} of ${plannedTestPoints} tests, so what wasn’t tested isn’t in this report.`
      );
    }

    // Planned tests that weren't run still appear, with the reason, so nothing silently disappears.
    for (const skippedTest of options.notRun || []) {
      results.push({
        testCaseId: skippedTest.id,
        flowId: skippedTest.flowId,
        role: skippedTest.role,
        status: 'Skipped',
        durationMs: 0,
        findings: [],
        stepEvidence: [],
        skipReason: skippedTest.reason,
      });
    }
    const needingTestCopy = results.filter((r) => r.skipReason === NEEDS_TEST_COPY).length;
    if (needingTestCopy > 0) {
      notes.push(
        `This is a live site, so nothing was sent. ${needingTestCopy} ${needingTestCopy === 1 ? 'test needs' : 'tests need'} a test copy of the site to run, because ${needingTestCopy === 1 ? 'it sends' : 'they send'} a form or ${needingTestCopy === 1 ? 'changes' : 'change'} data.`
      );
    }

    // Coverage Calculation
    const totalTestPoints = results.length;
    const passed = results.filter((r) => r.status === 'Passed').length;
    const failed = results.filter((r) => r.status === 'Failed').length;
    const blocked = results.filter((r) => r.status === 'Blocked').length;
    const skipped = results.filter((r) => r.status === 'Skipped').length;
    const couldNotVerify = results.filter((r) => r.status === 'Could not verify').length;

    const coverage: RunCoverage = {
      totalTestPoints,
      passed,
      failed,
      blocked,
      skipped,
      couldNotVerify,
      flakyFlows: results.filter((r) => r.retry?.status === 'FLAKY_PASSED').length,
      completionRate: totalTestPoints > 0 ? (totalTestPoints / totalTestPoints) * 100 : 100,
    };

    // Apply Suppressions & Compute Delta
    // One problem, one finding, however many test points, widths or roles ran into it.
    const uniqueFindings = mergeDuplicateFindings(allFindings);
    await suppressionsManager.applySuppressions(uniqueFindings, siteHostOf(options.targetUrl));
    const delta = await suppressionsManager.computeDelta(uniqueFindings);
    const activeSuppressions = await suppressionsManager.loadSuppressions();

    // Build Traceability Matrix
    const traceability: TraceabilityEntry[] = [];
    for (const r of results) {
      const tc = testCasesToRun.find((t) => t.id === r.testCaseId);
      const reqId = tc?.requirementId || `REQ-${tc?.flowId || r.flowId}`;
      const lastStep = r.stepEvidence[r.stepEvidence.length - 1];
      const name = tc?.name ?? options.notRun?.find((n) => n.id === r.testCaseId)?.name;
      traceability.push({
        requirementId: reqId,
        testCaseId: r.testCaseId,
        flowId: r.flowId,
        name,
        status: r.status,
        description: r.skipReason || tc?.expectations.text?.description || tc?.expectations.url?.description || name,
        evidencePath: lastStep?.screenshotPath,
      });
    }

    // Calculate A–F grades and prioritized recommendations. An aspect none of whose checks ran is
    // "Not checked", not an A.
    const grades = calculateSiteAspectGrades(uniqueFindings, {
      checkersRun: results.flatMap((r) => (r.checks || []).map((c) => c.checker)),
      marketingChecked: marketingLog.homeRead,
    });
    const marketing = marketingReview(marketingLog);
    const recommendations = generateRankedRecommendations(uniqueFindings);

    // Site history tracking, in the data folder beside the site's memory
    const historyManager = new SiteHistoryManager(options.dataDir ? path.join(options.dataDir, 'sites') : undefined);
    let historyDiff;
    let slowerThanLastTime: SlowerThanLastTime[] = [];
    try {
      const host = new URL(options.targetUrl).host;
      // Read the last check-up's speeds BEFORE recordRun replaces them. Kept out of `findings`:
      // it never reaches grades, the verdict, recommendations or the CI gate.
      const previousSpeeds = await historyManager.previousPageSpeeds(host);
      slowerThanLastTime = findSlowerPages(previousSpeeds?.speeds, speedSamples, {
        previousRunId: previousSpeeds?.runId,
        previousTimestamp: previousSpeeds?.timestamp,
      });
      historyDiff = await historyManager.recordRun(
        host,
        runId,
        grades,
        uniqueFindings,
        options.productId,
        speedSamples
      );
    } catch {
      // Ignore URL parsing or storage errors in test mode
    }

    const fullReport: ReleaseReport = {
      runId,
      productId: options.productId,
      targetUrl: options.targetUrl,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      coverage,
      results,
      findings: uniqueFindings,
      grades,
      marketing,
      recommendations,
      history: historyDiff,
      ...(slowerThanLastTime.length > 0 ? { slowerThanLastTime } : {}),
      traceability,
      suppressions: activeSuppressions,
      delta,
      notes: notes.length > 0 ? notes : undefined,
      partial: options.finishSignal?.aborted
        ? { done: results.filter((r) => r.status !== 'Skipped' || !r.skipReason).length, planned: plannedTestPoints }
        : undefined,
      aiModels: options.aiModels,
      scanMode: options.readOnly ? 'read-only' : undefined,
      siteMap: options.siteMap,
      testedWithApprovedPlan: options.testedWithApprovedPlan,
    };

    // Hide sign-in details (and secret-looking URL parameters) everywhere before anything is kept.
    await redactor.files(evidenceDir);
    const report = withPortablePaths(redactor.deep(fullReport), outputDir);

    // Generate single-file HTML report
    try {
      const htmlPath = await generateSingleFileHtmlReport(report, { outputDir });
      report.singleFileHtmlReportPath = htmlPath;
    } catch (err) {
      console.warn('[QA Orchestrator] Could not generate single-file HTML report:', err);
    }

    // Emit reports to .qa-report
    console.log(`[QA Orchestrator] Generating release readiness report in ${outputDir}...`);
    await reportGenerator.generate(report);
    console.log(`[QA Orchestrator] Reports generated: report.md and findings.json`);

    onEvent({ type: 'RUN_COMPLETED', runId, report });

    return report;
  }
}
