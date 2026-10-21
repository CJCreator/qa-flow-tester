import path from 'path';
import type { BrowserContext, Page } from 'playwright';
import type {
  TestCase,
  ProductProfile,
  ReleaseReport,
  TestPointResult,
  Finding,
  Breakpoint,
  RunCoverage,
  TraceabilityEntry,
  RetryTelemetryEntry,
  PageSpeedMap,
  SlowerThanLastTime,
  RoleNotTested,
  WcagCoverageEntry,
} from '@qa/types';
import { signInReasonText } from '@qa/types';
import {
  BrowserManager,
  BREAKPOINT_VIEWPORTS,
  locateElement,
  getBrowserPolicy,
  urlForLog,
} from './browser.js';
import type { OrchestratorEvent } from './run/events.js';
import type { RunOptions } from './run/options.js';
import { StepsFailed, removeVideosExcept } from './run/helpers.js';
import { pathOf, siteHostOf, sitePathOf } from './run/urls.js';
import { checkLink, checksRun } from './run/checks.js';
import { runAccessChecks, roleFetcher, guardedFetcher, type AccessFetcher } from './access-control.js';
import { EvidenceCollector } from './evidence.js';
import { captureVisualShot, readBaselineMode, writeVisualBaseline } from './visual-capture.js';
import { PreFlightChecker, SignInFailedError, type PreFlightResult } from './preflight.js';
import { restoreSession, RunTimer } from './discovery/discovery-agent.js';
import { navigate, looksLikeLogin } from './navigate.js';
import { isSignInOnlyForm, readPageForms } from './discovery/deterministic-spider.js';
import { debugLog } from './debug-log.js';
import { makeOutboundFetch } from './safe-net.js';
import { SourceLocator } from './source-locator.js';
import { ReproScriptGenerator } from './repro-generator.js';
import { ReportGenerator, withPortablePaths } from './reporter.js';
import { withSourceWording } from './source-wording.js';
import { expandValidationTestCases } from './validator-expander.js';
import { SuppressionsManager } from './suppressions.js';
import { Redactor, runSecrets, sessionCookies } from './redact.js';
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
  SecurityDepthChecker,
  KeyboardA11yChecker,
  PerformanceChecker,
  SeoChecker,
  newMarketingLog,
  marketingReview,
  captureRefusalBaseline,
  type DesignTokens,
  type RefusalBaseline,
} from '@qa/checkers';
import { calculateSiteAspectGrades } from './scoring.js';
import { generateRankedRecommendations } from './recommendations.js';
import { SiteHistoryManager } from './site-history.js';
import { findSlowerPages, pageSpeedKey } from './speed-change.js';
import { generateSingleFileHtmlReport } from './html-report.js';
import { abortError, isAbortError } from './abort.js';
import { RetryRunner, isTransientFailure } from './retry-runner.js';
import { createStepBudget, resolveStepTimeoutMs } from './step-budget.js';
import { promises as fs } from 'fs';

export type { OrchestratorEvent } from './run/events.js';
export type { RunOptions } from './run/options.js';
export { removeVideosExcept } from './run/helpers.js';
export { sitePathOf } from './run/urls.js';

export class FlowTestOrchestrator {
  private browserManager = new BrowserManager();
  private preflightChecker = new PreFlightChecker();
  private bugChecker = new BugDetectionChecker();
  private specChecker = new SpecConformanceChecker();
  private uxChecker = new UXQualityChecker();
  private designChecker = new DesignStandardsChecker();
  private securityChecker = new SecurityChecker();
  private securityDepth = new SecurityDepthChecker();
  private keyboardA11y = new KeyboardA11yChecker();
  private performanceChecker = new PerformanceChecker();
  private seoChecker = new SeoChecker();

  async run(options: RunOptions): Promise<ReleaseReport> {
    // Every exit (report, stop, pre-flight failure, thrown error) closes this run's browsers.
    try {
      return await this.runChecks(options);
    } finally {
      await this.browserManager.close().catch(() => {});
    }
  }

  private async runChecks(options: RunOptions): Promise<ReleaseReport> {
    const startTime = Date.now();
    const timer = new RunTimer(options.timing);
    if (options.discoveryTiming) timer.entries.push(...options.discoveryTiming);
    const runId = options.runId || `run-${Date.now()}`;
    // Nothing the run streams or writes may carry a sign-in detail or a secret header, tunnel token or cookie.
    const redactor = new Redactor(
      runSecrets({
        roles: options.profile?.roles,
        customHeaders: options.customHeaders,
        tunnelAuth: options.tunnelAuth,
        targetUrl: options.targetUrl,
      })
    );
    // Network checks outside the browser (security depth, SEO) use the same pinned, redirect-checked GET as links.
    const outboundFetch = makeOutboundFetch({ allowPrivate: !getBrowserPolicy()?.guard, timeoutMs: 10000 });
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
    console.log(`[QA Orchestrator] Running Pre-flight health check on ${urlForLog(options.targetUrl)}...`);

    let preflight: PreFlightResult;
    const neededRoles = options.profile?.roles || [];
    const hasPreflight = !!options.preflight;
    const allRolesPresent = hasPreflight && neededRoles.every((r) => options.preflight?.roleStorageStates?.[r.role]);

    if (hasPreflight && allRolesPresent) {
      // Validate with a cheap check per role
      const failedRoles: typeof neededRoles = [];
      for (const roleCred of neededRoles) {
        const state = options.preflight?.roleStorageStates?.[roleCred.role];
        if (!state) {
          failedRoles.push(roleCred);
          continue;
        }
        let context: BrowserContext | undefined;
        let roleOk = false;
        try {
          context = await this.browserManager.createContext({
            engine: options.browserEngine ?? 'chromium',
            headless: options.headless ?? true,
            baseUrl: options.targetUrl,
            storageState: state,
            customHeaders: options.customHeaders,
            userAgent: options.userAgent,
            tunnelAuth: options.tunnelAuth,
            headerHosts: options.headerHosts,
          });
          const page = await context.newPage();
          const landingPath = options.preflight!.roleLandingPaths?.[roleCred.role] || '/';
          const testUrl = new URL(landingPath, options.targetUrl).toString();
          const loginPath = roleCred.loginPath || '/login';
          const navRes = await navigate(page, testUrl, { timeoutMs: 15000 });
          const isLogin = await looksLikeLogin(page, [loginPath]);
          if (navRes.ok && navRes.status !== 401 && !isLogin) {
            roleOk = true;
          }
        } catch {
          roleOk = false;
        } finally {
          await context?.close().catch(() => {});
        }
        if (!roleOk) {
          failedRoles.push(roleCred);
        }
      }

      if (failedRoles.length === 0) {
        preflight = options.preflight!;
      } else {
        const partialProfile: ProductProfile = {
          ...options.profile!,
          roles: failedRoles,
        };
        const reloginPreflight = await this.preflightChecker.runPreFlight(
          options.targetUrl,
          partialProfile,
          options.tunnelAuth,
          {
            browserManager: this.browserManager,
            authDir,
            suppliedSessions: options.suppliedSessions,
            customHeaders: options.customHeaders,
            userAgent: options.userAgent,
            headerHosts: options.headerHosts,
          }
        );
        preflight = {
          ...options.preflight!,
          ok: options.preflight!.ok && reloginPreflight.ok,
          roleAuthResults: {
            ...options.preflight!.roleAuthResults,
            ...reloginPreflight.roleAuthResults,
          },
          roleStorageStates: {
            ...options.preflight!.roleStorageStates,
            ...reloginPreflight.roleStorageStates,
          },
          roleLandingPaths: {
            ...options.preflight!.roleLandingPaths,
            ...reloginPreflight.roleLandingPaths,
          },
          roleFailures: {
            ...options.preflight!.roleFailures,
            ...reloginPreflight.roleFailures,
          },
          roleDiagnostics: {
            ...options.preflight!.roleDiagnostics,
            ...reloginPreflight.roleDiagnostics,
          },
        };
      }
    } else {
      preflight = await this.preflightChecker.runPreFlight(options.targetUrl, options.profile, options.tunnelAuth, {
        browserManager: this.browserManager,
        authDir,
        suppliedSessions: options.suppliedSessions,
        customHeaders: options.customHeaders,
        userAgent: options.userAgent,
        headerHosts: options.headerHosts,
      });
    }

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
    // Session cookies exist only once the roles have signed in, so they join the list here.
    redactor.add(runSecrets({ cookies: await sessionCookies(roleStorageStates) }));
    const notes = [...(options.reportNotes || [])];
    // A role that could not sign in is not tested (never run signed out), and the report says why.
    const rolesNotTested: RoleNotTested[] = [];
    for (const [role, ok] of Object.entries(preflight.roleAuthResults)) {
      if (ok) continue;
      const reason = preflight.roleFailures?.[role] ?? 'no-form';
      rolesNotTested.push({ role, reason, text: signInReasonText(reason) });
      const note = `Signing in as "${role}" didn't work, so that role was not tested.`;
      if (!notes.includes(note)) notes.push(note);
    }
    // Under consent to full testing, a failed sign-in fails the run before any test starts: nothing is
    // sent signed out, and no other role's tests run on their own.
    if (options.requireSignIn && rolesNotTested.length > 0) {
      await this.browserManager.close().catch(() => {});
      throw new SignInFailedError(rolesNotTested[0].reason, rolesNotTested[0].role);
    }
    const notTestedRoles = new Set(rolesNotTested.map((r) => r.role));
    const sessionLostRoles = new Set<string>();
    const roleStates = new Map<string, { reloginUsed: boolean; lost: boolean }>();
    for (const r of options.profile?.roles || []) {
      roleStates.set(r.role, { reloginUsed: false, lost: false });
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
    // A run that signs in records no video: Playwright cannot mask the sign-in fields in a video.
    const recordVideo = (options.recordVideo ?? true) && (options.profile?.roles ?? []).length === 0;

    const breakpoints: Breakpoint[] = options.breakpoints || ['375px', '768px', '1440px'];
    const results: TestPointResult[] = [];
    const allFindings: Finding[] = [];
    // WCAG coverage per criterion, merged across pages by worst status (never one percentage).
    const wcagRank = { 'none-found': 0, 'needs-human-judgment': 1, violated: 2 } as const;
    const wcagByCriterion = new Map<string, WcagCoverageEntry>();
    const wcagUnmapped = new Set<string>();
    const onCoverage = (entries: WcagCoverageEntry[], unmapped: string[]) => {
      for (const e of entries) {
        const cur = wcagByCriterion.get(e.criterion);
        if (!cur) wcagByCriterion.set(e.criterion, { ...e });
        else {
          cur.pages = (cur.pages ?? 0) + (e.pages ?? 1);
          if (wcagRank[e.status] > wcagRank[cur.status]) cur.status = e.status;
        }
      }
      for (const t of unmapped) wcagUnmapped.add(t);
    };

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
    // Pages whose keyboard walk and 320 px reflow check already ran in this run (one size is enough).
    const keyboardChecked = new Set<string>();
    const reflowChecked = new Set<string>();
    // Pages whose links and passive security checks already ran in this run. Both are the same at every width.
    const linkChecked = new Set<string>();
    const securityChecked = new Set<string>();
    // Link answers for the whole run, so a URL linked from several pages is requested once.
    const linkCache = new Map<string, Promise<number | null>>();
    const wantsRepeatLoads = (urlPath: string, bp: Breakpoint, sizes: Breakpoint[]) => {
      if (bp !== (sizes.includes('375px') ? '375px' : sizes[0]) || vitalsMeasured.has(urlPath)) return false;
      vitalsMeasured.add(urlPath);
      return true;
    };
    // What one Plan Item produced. Its points write here, and the run's lists take them in plan order (see below).
    type PointOutput = {
      results: TestPointResult[];
      findings: Finding[];
      notes: string[];
      marketing: ReturnType<typeof newMarketingLog>;
    };
    // Runs every screen size of one Plan Item. It shares the run's once-per-page sets, which are claimed
    // synchronously, so a page's checks still run once per run.
    const runTestCase = async (testCase: TestCase, out: PointOutput): Promise<void> => {
      // Which checkers run afterwards depends on the kind of Plan Item (see TestCase.kind).
      const kind = testCase.kind;
      const lightChecks = kind === 'navigation' || kind === 'link';
      const pageLevelChecks = !kind || kind === 'page' || kind === 'journey';
      // A page's search checks look at its markup, which is the same at every width: one width is enough.
      const sizes = sizesFor(testCase);
      if (notTestedRoles.has(testCase.role)) {
        const why = rolesNotTested.find((r) => r.role === testCase.role)!;
        out.results.push({
          testCaseId: testCase.id,
          flowId: testCase.flowId,
          role: testCase.role,
          status: 'Skipped',
          durationMs: 0,
          findings: [],
          stepEvidence: [],
          skipReason: `Not tested: ${why.text}`,
        });
        return;
      }
      if (sessionLostRoles.has(testCase.role)) {
        for (const bp of sizesFor(testCase)) {
          out.results.push({
            testCaseId: testCase.id,
            flowId: testCase.flowId,
            role: testCase.role,
            status: 'Skipped',
            durationMs: 0,
            findings: [],
            stepEvidence: [],
            skipReason: 'Signed out part-way: the session stopped working',
          });
        }
        return;
      }
      const searchSize = sizes.includes('1440px') ? '1440px' : sizes[sizes.length - 1];
      for (const bp of sizesFor(testCase)) {
        await stopHere();
        if (options.finishSignal?.aborted) return;
        onEvent({
          type: 'TEST_POINT_STARTED',
          testCaseId: testCase.id,
          testCaseName: testCase.name || testCase.flowId,
          role: testCase.role,
          breakpoint: bp,
          index: results.length + out.results.length,
          total: plannedTestPoints,
          startPage: testCase.startPage,
          flowId: testCase.flowId,
        });
        console.log(
          `[QA Orchestrator] Executing ${testCase.id} ("${testCase.flowId}") on ${bp} as ${testCase.role}...`
        );
        const pointStartTime = Date.now();
        // Names one checker's time in the report's timing, for this test point.
        const timedAs = (name: string) => ({
          phase: 'checker' as const,
          name,
          testCaseId: testCase.id,
          breakpoint: bp,
        });
        const testCaseEvidenceDir = path.join(evidenceDir, `${testCase.id}-${bp}`);
        let evidenceCollector = new EvidenceCollector(testCaseEvidenceDir, (text) => redactor.text(text));

        const storageState = roleStorageStates[testCase.role];

        let context: BrowserContext | undefined;
        // Set inside the retry attempt, which always opens it before anything below uses it.
        let page = undefined as unknown as Page;
        let testPointPassed = true;
        let stepError: string | undefined;
        // The page as it was right before the submit click of a refusal test (reset per attempt).
        let refusalBaseline: RefusalBaseline | undefined;
        // Set when a step that opens a tab, drawer or dialog could not be done: the form was never reached.
        let openingFailed: string | undefined;
        let pointResult: TestPointResult | undefined;
        let flakyRetry: RetryTelemetryEntry | undefined;
        let blockedChanges: string[] = [];
        // Content-Security-Policy of the page's main response; read only by the weak-policy check.
        let cspHeader: string | undefined;
        // All headers of the page's main response, read by the HSTS and nosniff checks.
        let mainResponseHeaders: Record<string, string> | undefined;
        /** Lists where the planned option wasn't there, and what was picked instead. */
        const substitutes: Array<{ step: string; planned: string; chosen: string }> = [];
        // Test Copy only: one token per Test point, shared by both attempts, and a memory of any form sent.
        const runToken = options.readOnly ? undefined : EntityNamespacer.runToken(runId, testCase.id, bp);
        const sendGuard = options.readOnly ? undefined : SendGuard.forUrl(options.targetUrl);

        let startPageNavResult: Awaited<ReturnType<typeof navigate>> | undefined;
        let startPageBounced = false;
        let pointSkippedReason: string | undefined;

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
              evidenceCollector = new EvidenceCollector(testCaseEvidenceDir, (text) => redactor.text(text));
              testPointPassed = true;
              stepError = undefined;
              refusalBaseline = undefined;
              openingFailed = undefined;
              substitutes.length = 0;
            }
            ({ context, page } = await this.browserManager.openPage({
              engine: options.browserEngine ?? 'chromium',
              headless: options.headless ?? true,
              viewport: BREAKPOINT_VIEWPORTS[bp],
              tunnelAuth: options.tunnelAuth,
              baseUrl: options.targetUrl,
              storageState,
              recordVideoDir: recordVideo ? testCaseEvidenceDir : undefined,
              customHeaders: options.customHeaders,
              userAgent: options.userAgent,
              headerHosts: options.headerHosts,
            }));

            // On a live site nothing that could change data leaves the browser.
            blockedChanges = options.readOnly ? await blockChanges(context) : [];
            if (sendGuard) watchSends(context, sendGuard);
            evidenceCollector.attach(page);
            const attachedPage = page;
            page.on('response', (r) => {
              if (r.request().isNavigationRequest() && r.frame() === attachedPage.mainFrame()) {
                cspHeader = r.headers()['content-security-policy'];
                mainResponseHeaders = r.headers();
              }
            });

            const startUrl = new URL(testCase.startPage, options.targetUrl).toString();
            const navStarted = Date.now();
            const navRes = await navigate(page, startUrl, {
              timeoutMs: 15000,
              who: testCase.role,
            });
            timer.add(
              {
                phase: 'navigation',
                name: sitePathOf(startUrl, options.targetUrl),
                testCaseId: testCase.id,
                breakpoint: bp,
              },
              navStarted
            );
            startPageNavResult = navRes;
            if (!navRes.ok) {
              throw new Error(`Failed to load ${testCase.startPage} (${navRes.error?.kind || 'net error'})`);
            }

            const credential = options.profile?.roles?.find((r) => r.role === testCase.role);
            const isRoleSignedIn = !!credential && roleStorageStates[testCase.role] !== undefined;

            if (isRoleSignedIn) {
              const loginPath = credential.loginPath || '/login';
              // A bounce is being sent from the page the test asked for to a sign-in page. A test that starts on the
              // sign-in page is not bounced, and a change-password form (a password field beside other fields) is a
              // page like any other (LC-002).
              const startedOn = new URL(testCase.startPage, options.targetUrl).pathname.replace(/\/$/, '');
              const landedOn = new URL(page.url()).pathname.replace(/\/$/, '');
              const redirectedToLogin =
                landedOn !== startedOn &&
                (landedOn === loginPath.replace(/\/$/, '') ||
                  ((await looksLikeLogin(page)) && isSignInOnlyForm(await readPageForms(page))));
              const isLogin = redirectedToLogin;
              const isBounced = navRes.status === 401 || isLogin;
              startPageBounced = isBounced;

              if (isBounced) {
                const roleState = roleStates.get(testCase.role) || { reloginUsed: false, lost: false };
                const canRelogin = process.env.QA_RELOGIN !== '0' && !roleState.reloginUsed;

                if (canRelogin) {
                  roleState.reloginUsed = true;
                  roleStates.set(testCase.role, roleState);
                  debugLog('auth', 'session lost, attempting re-login', { role: testCase.role });

                  const reloginContext = await this.browserManager.createContext({
                    engine: options.browserEngine ?? 'chromium',
                    headless: options.headless ?? true,
                    tunnelAuth: options.tunnelAuth,
                    baseUrl: options.targetUrl,
                    customHeaders: options.customHeaders,
                    userAgent: options.userAgent,
                    headerHosts: options.headerHosts,
                  });
                  const slug = credential.role.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
                  const statePath = path.join(authDir, `${slug}.json`);
                  const reloginRes = await this.preflightChecker
                    .signIn(reloginContext, options.targetUrl, credential, statePath)
                    .catch(async (err: unknown) => {
                      // A throw here would strand the context; close it before the error goes on.
                      await reloginContext.close().catch(() => {});
                      throw err;
                    });
                  // The whole session, not only its cookies: the one restore helper (LC-004). The retry still
                  // starts from the state file on disk, so a failure here cannot strand the run.
                  const reloginState = reloginRes.ok ? await reloginContext.storageState().catch(() => null) : null;
                  await reloginContext.close().catch(() => {});

                  if (reloginRes.ok) {
                    roleStorageStates[testCase.role] = statePath;
                    if (reloginState) {
                      await restoreSession(page.context(), reloginState).catch(() => {
                        debugLog('auth', 'restoring the refreshed session into the live page failed', {
                          role: testCase.role,
                        });
                      });
                    }
                    throw new StepsFailed('Session refreshed, retrying point');
                  }
                }

                sessionLostRoles.add(testCase.role);
                roleState.lost = true;
                roleStates.set(testCase.role, roleState);

                const lostNote = `The session for "${testCase.role}" stopped working part-way through testing.`;
                if (!out.notes.includes(lostNote)) out.notes.push(lostNote);

                if (options.requireSignIn) {
                  await this.browserManager.close().catch(() => {});
                  throw new SignInFailedError('session-expired', testCase.role);
                }

                pointSkippedReason = 'Signed out part-way: the session stopped working';
                return;
              }
            }

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
                    const refusalAt = testCase.expectations?.refusal;
                    if (refusalAt && step.selector && step.selector === refusalAt.submitSelector) {
                      refusalBaseline = await captureRefusalBaseline(page).catch(() => undefined);
                    }
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

                  // No fixed wait here: the next step waits for its own element.
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
                if (step.opening) {
                  openingFailed = `Could not reach ${testCase.name || testCase.flowId}: the control that opens it was not found`;
                }
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
            maxRetries: testCase.kind === 'link' ? 0 : Math.max(0, Math.floor(options.flakyReruns ?? 3)),
            sentAny: () => sendGuard?.hasSentAny() === true,
            // Only a transient failure is tried again (navigation timeout or network error, browser crash).
            // A session refreshed mid-point is retried too: that retry is the recovery, not a flaky rerun.
            // Once a form was sent, a second try would send it twice: decline the retry.
            shouldRetry: (err) =>
              (isTransientFailure(err) || err.message === 'Session refreshed, retrying point') &&
              !isAbortError(err) &&
              !sendGuard?.hasSentAny(),
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

          if (pointSkippedReason) {
            out.results.push({
              testCaseId: testCase.id,
              flowId: testCase.flowId,
              role: testCase.role,
              status: 'Skipped',
              durationMs: Date.now() - pointStartTime,
              findings: [],
              stepEvidence: [],
              skipReason: pointSkippedReason,
              breakpoint: bp,
            });
            continue;
          }

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
          const bugFindings = timer.sync(timedAs('bug-detection'), () =>
            this.bugChecker.check(stepEvidenceList, {
              testCaseId: testCase.id,
              flowId: testCase.flowId,
              role: testCase.role,
              breakpoint: bp,
              urlPath: page.url(),
              planIsGuess: testCase.expectations?.origin === 'ai-guess',
            })
          );

          // A probe-only refusal test sends nothing, so no submit click captured a baseline: the page as the
          // steps left it is the baseline. Not taken after a failed step, which the step failure already reports.
          if (testCase.expectations?.refusal?.probeOnly && testPointPassed && !refusalBaseline) {
            refusalBaseline = await captureRefusalBaseline(page).catch(() => undefined);
          }

          // 2. Spec Conformance
          const observations: string[] = [];
          const specFindings = await timer.span(timedAs('spec-conformance'), () =>
            this.specChecker.check(page, testCase, stepEvidenceList, {
              role: testCase.role,
              breakpoint: bp,
              baseUrl: options.targetUrl,
              refusalBaseline,
              onObservation: (o) => observations.push(o),
            })
          );

          // 3. UX Quality (accessibility of the state the steps left): not for a Navigation Check,
          // whose destination page is checked by its own visit.
          const uxFindings = lightChecks
            ? []
            : await timer.span(timedAs('ux-quality'), () =>
                this.uxChecker.check(page, {
                  testCaseId: testCase.id,
                  role: testCase.role,
                  breakpoint: bp,
                  urlPath: new URL(page.url(), options.targetUrl).pathname,
                  enableAxe: options.enableA11y ?? true,
                  entryPath: new URL(options.targetUrl).pathname,
                  onCoverage,
                })
              );

          // 3b. Security (passive): passwords in page addresses. Page-level checks (security, speed,
          // findability, design) run on page visits and journeys, not on every test on a page.
          // Headers and the site's own files don't change with the width: they run once per page per run.
          const securityPath = new URL(page.url(), options.targetUrl).pathname;
          const securityHere =
            options.enableSecurity !== false && pageLevelChecks && !securityChecked.has(securityPath);
          if (securityHere) securityChecked.add(securityPath);
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
                  ...(securityHere
                    ? await timer.span(timedAs('security'), () =>
                        this.securityChecker.checkPage(page, {
                          testCaseId: testCase.id,
                          flowId: testCase.flowId,
                          role: testCase.role,
                          breakpoint: bp,
                          urlPath: securityPath,
                          baseUrl: options.targetUrl,
                          responseHeaders: mainResponseHeaders,
                        })
                      )
                    : []),
                  ...(securityHere
                    ? await timer.span(timedAs('security-depth'), () =>
                        this.securityDepth.checkPage(
                          page,
                          {
                            testCaseId: testCase.id,
                            flowId: testCase.flowId,
                            role: testCase.role,
                            breakpoint: bp,
                            urlPath: securityPath,
                            baseUrl: options.targetUrl,
                            siteWide,
                            cspHeader,
                          },
                          outboundFetch
                        )
                      )
                    : []),
                ];

          // 3c. Performance (Speed, Web Vitals, Mobile Overflow & Overlap)
          const perfFindings =
            options.enablePerformance === false || !pageLevelChecks
              ? []
              : await timer.span(timedAs('performance'), () =>
                  this.performanceChecker.checkPage(page, {
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
                  })
                );

          // 3d. SEO & Link Health
          const searchHere = options.enableSeo !== false && pageLevelChecks && bp === searchSize;
          // A page's links are checked once per run; the link cache answers any URL already requested.
          const seoPath = new URL(page.url(), options.targetUrl).pathname;
          const seoLinks = searchHere && !linkChecked.has(seoPath);
          if (seoLinks) linkChecked.add(seoPath);
          const seoFindings = !searchHere
            ? []
            : await timer.span(timedAs('seo'), () =>
                this.seoChecker.checkPage(page, {
                  testCaseId: testCase.id,
                  flowId: testCase.flowId,
                  role: testCase.role,
                  breakpoint: bp,
                  urlPath: seoPath,
                  baseUrl: options.targetUrl,
                  searchChecks: options.searchChecks,
                  visibility: options.visibility,
                  siteWide,
                  marketingLog: out.marketing,
                  fetchFn: outboundFetch,
                  checkLinks: seoLinks,
                  linkCache,
                })
              );

          // 4. Permission Matrix Check
          const permFindings: Finding[] = [];
          if (permChecker && startPageNavResult?.status !== undefined) {
            const currentPath = new URL(page.url(), options.targetUrl).pathname;
            const permStarted = Date.now();
            const permFinding = permChecker.checkAccess({
              target: currentPath,
              role: testCase.role,
              breakpoint: bp,
              statusCode: startPageNavResult.status,
              redirectedToLogin: startPageBounced,
              testCaseId: testCase.id,
            });
            timer.add(timedAs('permission-matrix'), permStarted);
            if (permFinding) {
              permFindings.push(permFinding);
            }
          }

          // 5. Design tokens (Tier 1) and visual baseline (Tier 2)
          const designFindings: Finding[] = [];
          const urlPath = new URL(page.url(), options.targetUrl).pathname;
          if (designTokens && pageLevelChecks) {
            const designStarted = Date.now();
            designFindings.push(
              ...(await this.designChecker.check(page, designTokens, {
                testCaseId: testCase.id,
                role: testCase.role,
                breakpoint: bp,
                urlPath,
              }))
            );
            timer.add(timedAs('design-standards'), designStarted);
          }
          // Only a flow that completed reaches the screen the baseline was taken of.
          const baselinePath = path.join(baselineDir, `${testCase.id}-${bp}.png`);
          if (testPointPassed && pageLevelChecks) {
            if (options.updateBaselines) {
              const extraSelectors = options.profile?.visualMaskSelectors;
              const shot = await captureVisualShot(page, { masked: true, extraSelectors });
              await writeVisualBaseline(baselinePath, shot, { extraSelectors });
            } else {
              const baseline = await fs.readFile(baselinePath).catch(() => null);
              if (baseline) {
                const mode = await readBaselineMode(baselinePath, baseline);
                const current = await captureVisualShot(page, {
                  masked: mode.masked,
                  extraSelectors: mode.masked ? mode.extraSelectors : undefined,
                });
                const diff = await timer.span(timedAs('visual-diff'), () =>
                  this.designChecker.checkVisualDiff(current, baseline, {
                    maxDiffPercent: options.profile?.visualDiffMaxPercent,
                    diffOutputPath: path.join(testCaseEvidenceDir, 'visual-diff.png'),
                  })
                );
                if (!diff.match) {
                  await fs.mkdir(testCaseEvidenceDir, { recursive: true });
                  const baselineCopy = path.join(testCaseEvidenceDir, 'visual-baseline.png');
                  const currentCopy = path.join(testCaseEvidenceDir, 'visual-current.png');
                  await fs.writeFile(baselineCopy, baseline);
                  await fs.writeFile(currentCopy, current);
                  designFindings.push(
                    this.designChecker.visualDiffFinding(diff, {
                      testCaseId: testCase.id,
                      role: testCase.role,
                      breakpoint: bp,
                      urlPath,
                      baselineImagePath: path.join(testCaseEvidenceDir, 'visual-baseline.png'),
                      currentImagePath: path.join(testCaseEvidenceDir, 'visual-current.png'),
                      baselinePath: path.relative(process.cwd(), baselinePath).replace(/\\/g, '/'),
                    })
                  );
                }
              }
            }
          }

          // Keyboard and 320 px reflow checks: after screenshots, visual diff and speed checks, because
          // they move focus and resize the window. Once per page, at one size.
          const a11yDepth: Finding[] = [];
          if (pageLevelChecks && options.enableA11y !== false && bp === searchSize && !page.isClosed()) {
            const a11yContext = {
              testCaseId: testCase.id,
              flowId: testCase.flowId,
              role: testCase.role,
              breakpoint: bp,
              urlPath,
              onCoverage,
            };
            if (!keyboardChecked.has(urlPath)) {
              keyboardChecked.add(urlPath);
              a11yDepth.push(
                ...(await timer.span(timedAs('keyboard-a11y'), () => this.keyboardA11y.checkKeyboard(page, a11yContext)))
              );
            }
            if (!reflowChecked.has(urlPath)) {
              reflowChecked.add(urlPath);
              a11yDepth.push(
                ...(await timer.span(timedAs('reflow'), () =>
                  this.keyboardA11y.checkReflow(page, {
                    ...a11yContext,
                    restoreViewport: BREAKPOINT_VIEWPORTS[bp],
                  })
                ))
              );
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
            ...a11yDepth,
          ]
            .filter(
              (f) => !(sentData || openingFailed) || (f.checker !== 'spec-conformance' && !f.id.startsWith('F-STEP-'))
            )
            .map((f) => withSourceWording(f, testCase));

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
            out.findings.push(f);
          }

          // Unconfirmed AI guesses never fail a test point on their own.
          const hasStepFailure = !testPointPassed && !sentData;
          const hasRealFinding = keptFindings.some((f) => !f.needsConfirmation);
          const hasGuessedFailure =
            testCase.expectations?.origin === 'ai-guess' &&
            keptFindings.some((f) => f.needsConfirmation && f.id.startsWith('F-STEP-'));
          const status: TestPointResult['status'] = sentData
            ? 'Skipped'
            : openingFailed
              ? 'Could not verify'
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
            error: openingFailed ?? stepError,
            observations: observations.length > 0 ? observations : undefined,
            skipReason: sentData ? NEEDS_TEST_COPY : undefined,
            breakpoint: bp,
            retry: flakyRetry,
            // A skipped point checked nothing, so it carries no checks.
            checks:
              status === 'Skipped'
                ? undefined
                : checksRun(keptFindings, {
                    ux: !lightChecks,
                    pageLevel: pageLevelChecks,
                    search: searchHere && options.searchChecks !== false,
                    spec:
                      !sentData &&
                      !openingFailed &&
                      Object.keys(testCase.expectations || {}).some((k) => k !== 'origin'),
                    permissions: !!permChecker,
                    design: (!!designTokens && pageLevelChecks) || designFindings.length > 0,
                  }),
          };
        } catch (fatalErr: unknown) {
          // Stopping isn't a failure of the site: nothing is recorded, and the run ends.
          if (isAbortError(fatalErr) || fatalErr instanceof SignInFailedError) throw fatalErr;
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
          out.findings.push(couldNotRun);
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
        timer.add(
          { phase: 'test-point', name: testCase.flowId, testCaseId: testCase.id, breakpoint: bp },
          pointStartTime
        );
        out.results.push(pointResult!);
        onEvent({
          type: 'FINDINGS_UPDATED',
          totalFindings: allFindings.length + out.findings.length,
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
    };

    // Test cases run in lanes, one per role, so one role's points stay in plan order on its own session. A
    // read-only run runs up to `testPointWorkers` lanes at once; a test-copy run runs one lane, in plan order.
    // A finished test case is committed to the run's lists only after every test case before it, so the
    // report keeps plan order whichever finishes first.
    // Default 1 (serial) until the once-per-page check ownership decision is made; see T-56 notes in the plan.
    const workerCount = options.readOnly ? Math.max(1, Math.min(5, Math.floor(options.testPointWorkers ?? 1))) : 1;
    const lanes = new Map<string, number[]>();
    testCasesToRun.forEach((testCase, slot) => {
      const lane = workerCount > 1 ? testCase.role : '';
      lanes.set(lane, [...(lanes.get(lane) ?? []), slot]);
    });
    const pendingLanes = [...lanes.values()];
    const pointOutputs: Array<PointOutput | undefined> = [];
    let committed = 0;
    const mergeMarketingLog = (into: PointOutput['marketing'], from: PointOutput['marketing']) => {
      for (const p of from.readPages) if (!into.readPages.includes(p)) into.readPages.push(p);
      into.homeRead = into.homeRead || from.homeRead;
      // The checker's own rule (marketing.ts remember): a gap stays a gap, and a later pass replaces an earlier one.
      const rank = { 'not-checked': 0, ok: 1, gap: 2 } as const;
      for (const [key, r] of from.results) {
        const before = into.results.get(key);
        if (!before || rank[r.status] > rank[before.status] || (r.status === 'ok' && before.status === 'ok'))
          into.results.set(key, r);
      }
    };
    const commitInOrder = () => {
      for (let out = pointOutputs[committed]; out; out = pointOutputs[++committed]) {
        results.push(...out.results);
        allFindings.push(...out.findings);
        for (const n of out.notes) if (!notes.includes(n)) notes.push(n);
        mergeMarketingLog(marketingLog, out.marketing);
      }
    };
    const halt: { failed: boolean; error?: unknown } = { failed: false };
    const runLanes = async (): Promise<void> => {
      for (let lane = pendingLanes.shift(); lane && !halt.failed; lane = pendingLanes.shift()) {
        for (const slot of lane) {
          const out: PointOutput = { results: [], findings: [], notes: [], marketing: newMarketingLog() };
          // Once the run is asked to finish, no more test cases start (as before, nothing is recorded for them).
          if (!halt.failed && !options.finishSignal?.aborted) {
            try {
              await runTestCase(testCasesToRun[slot], out);
            } catch (err) {
              halt.failed = true;
              halt.error = err;
            }
          }
          pointOutputs[slot] = out;
          commitInOrder();
          if (halt.failed) return;
        }
      }
    };
    // The first error stops the lanes that have not started, and is the run's error, as it was when serial.
    await Promise.all(Array.from({ length: workerCount }, () => runLanes()));
    if (halt.failed) throw halt.error;

    // Access checks (ADR 0030): plain GETs only. A failure here never fails the run.
    const accessPages = options.siteMap?.pages ?? [];
    const accessRoles = Object.keys(roleStorageStates).filter((r) => !notTestedRoles.has(r));
    if (accessPages.length > 0 && accessRoles.length > 0 && !options.finishSignal?.aborted) {
      try {
        const guard = getBrowserPolicy()?.guard;
        const roleFetchers: Record<string, AccessFetcher> = {};
        for (const role of accessRoles) {
          roleFetchers[role] = await roleFetcher(roleStorageStates[role], { allowPrivate: !guard, timeoutMs: 15000 });
        }
        const access = await runAccessChecks({
          targetUrl: options.targetUrl,
          pages: accessPages,
          signedOut: guardedFetcher(
            makeOutboundFetch({ allowPrivate: !guard, timeoutMs: 15000, maxRedirects: 0 })
          ),
          roles: roleFetchers,
          markers: Object.fromEntries((options.profile?.roles ?? []).map((r) => [r.role, r.username])),
          allow: guard ? (url) => guard(url, false) : undefined,
        });
        allFindings.push(...access.findings);
        for (const n of access.notes) if (!notes.includes(n)) notes.push(n);
      } catch (err) {
        console.warn('[QA Orchestrator] Access checks did not run:', err instanceof Error ? err.message : err);
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
      completionRate: totalTestPoints > 0 ? (passed / totalTestPoints) * 100 : 0,
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
        description: r.skipReason || tc?.expectations?.text?.description || tc?.expectations?.url?.description || name,
        evidencePath: lastStep?.screenshotPath,
      });
    }

    // Calculate A–F grades and prioritized recommendations. An aspect none of whose checks ran is
    // "Not checked", not an A.
    const grades = calculateSiteAspectGrades(uniqueFindings, {
      checkersRun: results.flatMap((r) => (r.checks || []).map((c) => c.checker)),
      marketingChecked: marketingLog.homeRead,
      flakyCount: coverage.flakyFlows,
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

    // "N of M documented items reached": a documented item is reached when its test actually ran.
    const documented = testCasesToRun.filter((tc) => tc.docSource);
    const notFoundDocs = options.documentedNotFound ?? [];
    const documentedItems =
      documented.length + notFoundDocs.length > 0
        ? {
            reached: documented.filter((tc) => results.some((r) => r.testCaseId === tc.id && r.status !== 'Skipped'))
              .length,
            total: documented.length + notFoundDocs.length,
            notFound: notFoundDocs,
          }
        : undefined;

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
      ...(rolesNotTested.length > 0 ? { rolesNotTested } : {}),
      ...(wcagByCriterion.size > 0
        ? {
            wcagCoverage: [...wcagByCriterion.values()].sort((a, b) =>
              a.criterion.localeCompare(b.criterion, undefined, { numeric: true })
            ),
          }
        : {}),
      ...(wcagUnmapped.size > 0 ? { wcagUnmappedTags: [...wcagUnmapped].sort() } : {}),
      ...(documentedItems ? { documentedItems } : {}),
      partial: options.finishSignal?.aborted
        ? { done: results.filter((r) => r.status !== 'Skipped' || !r.skipReason).length, planned: plannedTestPoints }
        : undefined,
      aiModels: options.aiModels,
      scanMode: options.readOnly ? 'read-only' : undefined,
      siteMap: options.siteMap,
      ...(options.pageCoverage ? { pageCoverage: options.pageCoverage } : {}),
      testedWithApprovedPlan: options.testedWithApprovedPlan,
      ...(timer.enabled ? { timing: timer.entries } : {}),
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
