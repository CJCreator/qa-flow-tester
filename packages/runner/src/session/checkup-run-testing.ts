import { promises as fs } from 'fs';
import type { ReleaseReport, TestCase } from '@qa/types';
import {
  loadSiteMemory,
  saveSiteMemory,
  FlowTestOrchestrator,
  Redactor,
  runSecrets,
  sessionCookies,
  siteMapOf,
  rememberObservations,
  isAbortError,
  type RunOptions,
} from '@qa/core';
import { PLAN_SAVE_FAILED, redactedMessage, screensForReview, timingRequested } from './checkup-run-helpers.js';
import type { CheckupRun, RunContext } from './checkup-run-types.js';
import type { StoredPlanRecord } from './checkup-session.js';

/** Testing phase of a run: runs the Playwright orchestrator on an approved plan or explicit spec. */
export function createExecuteTesting(ctx: RunContext): CheckupRun['executeTesting'] {
  const { session, deps, broadcast, forwardRunEvent, getSiteDir, discoveryTimings } = ctx;

  const runTesting = async (
    record: StoredPlanRecord,
    specTestCases: TestCase[],
    notRun: RunOptions['notRun'],
    generation: number,
    extra: { testedWithApprovedPlan?: string } = {}
  ): Promise<void> => {
    const { context } = record;
    const current = () => generation === session.run.generation;

    // A run stopped before testing began has nothing left to do (its abort signal is already gone).
    if (!current()) return;
    session.run.setPhase('testing');
    session.run.setIsRunning(true);
    session.run.setTargetUrl(record.plan.targetUrl || session.run.targetUrl);

    broadcast({
      type: 'TESTING_STARTED',
      runId: context.runId,
      testCaseCount: specTestCases.length,
      timestamp: Date.now(),
    });

    const runDir = session.report.dirFor(context.runId);
    await fs.mkdir(runDir, { recursive: true });
    const runAuthDir = session.secrets.authDirFor(context.runId);
    await fs.mkdir(runAuthDir, { recursive: true, mode: 0o700 });

    // Hides the run's secrets in its folder: on a finished, stopped or failed run alike.
    const scrubRunFiles = async (): Promise<void> => {
      const cookies = [
        ...(await sessionCookies(session.secrets.savedSessions.get(context.runId))),
        ...(await sessionCookies(context.preflight?.roleStorageStates)),
      ];
      await new Redactor(
        runSecrets({
          roles: context.profile?.roles,
          customHeaders: context.customHeaders || session.secrets.headers,
          tunnelAuth: context.tunnelAuth || session.secrets.tunnelAuth,
          targetUrl: context.targetUrl,
          cookies,
        })
      ).files(runDir);
    };

    const orchestrator = new FlowTestOrchestrator();
    const discoveryTiming = discoveryTimings.get(context.runId);
    discoveryTimings.delete(context.runId);
    let report: ReleaseReport;
    if (!current()) return;
    try {
      report = await orchestrator.run({
        timing: timingRequested(),
        discoveryTiming,
        targetUrl: context.targetUrl,
        productId: context.productId,
        specTestCases,
        profile: context.profile,
        headless: context.headless ?? true,
        outputDir: runDir,
        authDir: runAuthDir,
        customHeaders: context.customHeaders || session.secrets.headers,
        userAgent: context.userAgent || session.secrets.userAgent,
        tunnelAuth: context.tunnelAuth || session.secrets.tunnelAuth,
        headerHosts: context.headerHosts || session.secrets.headerHosts,
        preflight: context.preflight,
        stateDir: session.paths.outputDir,
        evidenceUrlPrefix: `/api/evidence/runs/${context.runId}/`,
        dataDir: session.paths.dataDir,
        signal: session.run.abortController()?.signal,
        finishSignal: session.run.finishController()?.signal,
        breakpoints: context.breakpoints || ['375px', '768px', '1440px'],
        repoRoot: process.cwd(),
        runId: context.runId,
        reportNotes: context.reportNotes,
        aiModels: context.aiModels,
        readOnly: context.readOnly,
        requireSignIn: context.signInConsent && !context.readOnly ? true : undefined,
        ...(context.recordVideo !== undefined ? { recordVideo: context.recordVideo } : {}),
        pageCoverage: context.pageCoverage ?? context.draft?.exploration?.pageCoverage,
        notRun,
        suppliedSessions: session.secrets.savedSessions.get(context.runId),
        documentedNotFound: context.draft?.plan?.notFound?.map((n) => ({ docSource: n.docSource, reason: n.reason })),
        siteMap: context.draft
          ? siteMapOf(context.draft, context.runId, (file) => session.report.relativePath(context.runId, file))
          : undefined,
        testedWithApprovedPlan: extra.testedWithApprovedPlan,
        searchChecks: context.searchChecks,
        visibility: context.visibility,
        stepTimeoutMs: deps.stepTimeoutMs,
        onEvent: (event) => {
          if (current()) forwardRunEvent(event);
        },
      });
    } catch (err) {
      await scrubRunFiles().catch(() => {});
      if (!current() || isAbortError(err)) return;
      if (!context.draft || session.plan.currentRecord !== record) {
        await session.plan.clear(context.runId);
        throw err;
      }
      const msg = redactedMessage(err, {
        roles: context.profile?.roles,
        customHeaders: context.customHeaders || session.secrets.headers,
        tunnelAuth: context.tunnelAuth || session.secrets.tunnelAuth,
        targetUrl: context.targetUrl,
      });
      const planSaved = await session.plan.save(record).then(() => true, () => false);
      session.run.setPhase('awaiting-review');
      session.run.setIsRunning(true);
      session.report.setError(planSaved ? msg : `${msg} ${PLAN_SAVE_FAILED}`, 'ERR_TEST_EXECUTION_FAILED');
      broadcast({
        type: 'RUN_FAILED',
        runId: context.runId,
        error: msg,
        code: 'ERR_TEST_EXECUTION_FAILED',
        planKept: true,
        timestamp: Date.now(),
      });
      return;
    }

    if (!current()) {
      await scrubRunFiles().catch(() => {});
      return;
    }
    record.status = 'done';
    const doneSaved = await session.plan.save(record).then(() => true, () => false);
    if (!doneSaved) session.report.setError(PLAN_SAVE_FAILED, 'ERR_PLAN_SAVE');
    if (context.runId) {
      await session.secrets.clean(context.runId);
    }
    session.plan.set(null);

    if (context.siteHost && context.draft) {
      const memory = await loadSiteMemory(getSiteDir(), context.siteHost);
      if (memory) {
        rememberObservations(memory, context.draft, report);
        await saveSiteMemory(getSiteDir(), memory).catch(() =>
          session.report.setError("Couldn't save what was learned about this site. Try again.", 'ERR_MEMORY_SAVE')
        );
      }
    }

    report.aiUsage = context.draft?.plan?.budget?.tokens;
    const coverage = context.pageCoverage ?? context.draft?.exploration?.pageCoverage;
    if (coverage) report.pageCoverage = coverage;

    if (context.draft && context.ai && context.ai.provider !== 'mock') {
      const screens = deps.screensForReview
        ? deps.screensForReview(report, context.draft)
        : screensForReview(report, context.draft, runDir);
      if (screens.length > 0 && deps.visualReview) {
        broadcast({
          type: 'VISUAL_REVIEW_STARTED',
          runId: context.runId,
          screens: screens.length,
          timestamp: Date.now(),
        });
        const reviewed = await deps
          .visualReview(report, screens, {
            provider: context.ai.provider,
            apiKey: context.ai.apiKey,
            vision: context.aiModels?.vision,
          })
          .catch(() => null);
        if (!current()) {
          await scrubRunFiles().catch(() => {});
          return;
        }
        if (!reviewed) {
          report.notes = [
            ...(report.notes || []),
            'Looks and reads well wasn’t fully checked: no AI model that reads screenshots is set up. Choose one in Settings.',
          ];
        } else if (reviewed.remaining > 0) {
          report.notes = [
            ...(report.notes || []),
            reviewed.outOfRequests
              ? `The AI’s visual review looked at ${reviewed.reviewed} of ${screens.length} screens before today’s AI requests ran out. Finish it from the report when requests are available again.`
              : `The AI’s visual review stopped after ${reviewed.reviewed} of ${screens.length} screens because the AI service didn’t answer. Finish it from the report later.`,
          ];
        }
        if (reviewed && deps.saveReviewedReport) await deps.saveReviewedReport(report);
      }
    }

    await scrubRunFiles();

    await session.report
      .keep(report, record.plan.targetUrl || context.targetUrl, context.siteHost)
      .catch((err) => console.warn('[Release check-up] Couldn’t keep the run’s report:', redactedMessage(err)));
    deps.afterKeep?.(context.runId);
    session.report.set(report);
    session.secrets.savedSessions.delete(context.runId);
    session.run.setPhase('done');
    session.run.setIsRunning(false);
    session.run.setTargetUrl(null);
  };

  // Every exit of a testing phase (done, stopped, failed, approved from review) removes the run's auth folder
  // and saved sign-in. Execution has begun, so a plan kept for review after it goes on without the sign-in.
  const executeTesting = async (
    record: StoredPlanRecord,
    specTestCases: TestCase[],
    notRun: RunOptions['notRun'],
    generation: number,
    extra: { testedWithApprovedPlan?: string } = {}
  ): Promise<void> => {
    try {
      await runTesting(record, specTestCases, notRun, generation, extra);
    } finally {
      const runId = record.context.runId;
      session.secrets.savedSessions.delete(runId);
      await session.secrets.clean(runId);
    }
  };

  return executeTesting;
}
