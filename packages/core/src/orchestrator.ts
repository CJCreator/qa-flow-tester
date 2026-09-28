import path from 'path';
import type {
  TestCase,
  ProductProfile,
  ReleaseReport,
  TestPointResult,
  Finding,
  Breakpoint,
  RunCoverage,
  TraceabilityEntry,
} from '@qa/types';
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
import {
  BugDetectionChecker,
  SpecConformanceChecker,
  UXQualityChecker,
  PermissionMatrixChecker,
  DesignStandardsChecker,
  SecurityChecker,
  type DesignTokens,
} from '@qa/checkers';
import { promises as fs } from 'fs';
import type { BrowserContext, Page } from 'playwright';

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
    }
  | { type: 'STEP_STARTED'; stepIndex: number; stepName: string; action: string; target?: string; testCaseId: string }
  | { type: 'STEP_COMPLETED'; stepIndex: number; passed: boolean; durationMs: number; error?: string; screenshotUrl?: string }
  | { type: 'FINDINGS_UPDATED'; totalFindings: number }
  | { type: 'RUN_COMPLETED'; runId: string; report: ReleaseReport };

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
}

export class FlowTestOrchestrator {
  private browserManager = new BrowserManager();
  private preflightChecker = new PreFlightChecker();
  private bugChecker = new BugDetectionChecker();
  private specChecker = new SpecConformanceChecker();
  private uxChecker = new UXQualityChecker();
  private designChecker = new DesignStandardsChecker();
  private securityChecker = new SecurityChecker();

  async run(options: RunOptions): Promise<ReleaseReport> {
    const startTime = Date.now();
    const runId = options.runId || `run-${Date.now()}`;
    // Nothing the run streams or writes may carry a sign-in detail.
    const redactor = new Redactor(options.profile?.roles || []);
    const emitEvent = options.onEvent || (() => {});
    const onEvent = (event: OrchestratorEvent) => emitEvent(redactor.deep(event));
    const outputDir = options.outputDir || path.join(process.cwd(), '.qa-report');
    const evidenceDir = path.join(outputDir, 'evidence');
    const authDir = path.join(outputDir, 'auth');
    const repoRoot = options.repoRoot || process.cwd();

    const sourceLocator = new SourceLocator(repoRoot);
    const reproGenerator = new ReproScriptGenerator(evidenceDir);
    const reportGenerator = new ReportGenerator(outputDir);
    const suppressionsManager = new SuppressionsManager(outputDir);

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
    const preflight = await this.preflightChecker.runPreFlight(
      options.targetUrl,
      options.profile,
      options.tunnelAuth,
      {
        browserManager: this.browserManager,
        authDir,
      }
    );

    if (!preflight.ok) {
      throw new Error(`Pre-flight check failed: ${preflight.error}`);
    }
    console.log(`[QA Orchestrator] Pre-flight check PASSED.`);

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
    const plannedTestPoints = testCasesToRun.length * breakpoints.length;

    for (const testCase of testCasesToRun) {
      for (const bp of breakpoints) {
        onEvent({
          type: 'TEST_POINT_STARTED',
          testCaseId: testCase.id,
          testCaseName: testCase.name || testCase.flowId,
          role: testCase.role,
          breakpoint: bp,
          index: results.length,
          total: plannedTestPoints,
        });
        console.log(`[QA Orchestrator] Executing ${testCase.id} ("${testCase.flowId}") on ${bp} as ${testCase.role}...`);
        const pointStartTime = Date.now();
        const testCaseEvidenceDir = path.join(evidenceDir, `${testCase.id}-${bp}`);
        const evidenceCollector = new EvidenceCollector(testCaseEvidenceDir);

        const storageState = roleStorageStates[testCase.role];

        let context: BrowserContext | undefined;
        let page: Page | undefined;
        let testPointPassed = true;
        let stepError: string | undefined;
        let pointResult: TestPointResult | undefined;

        try {
          // Inside the try: a browser that can't open a page costs this test point, not the run.
          ({ context, page } = await this.browserManager.openPage({
            headless: options.headless ?? true,
            viewport: BREAKPOINT_VIEWPORTS[bp],
            tunnelAuth: options.tunnelAuth,
            baseUrl: options.targetUrl,
            storageState,
            recordVideoDir: recordVideo ? testCaseEvidenceDir : undefined,
          }));
          evidenceCollector.attach(page);

          const startUrl = new URL(testCase.startPage, options.targetUrl).toString();
          await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

          // Execute each step with up to 2 retries
          for (let i = 0; i < testCase.steps.length; i++) {
            const step = testCase.steps[i];
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
            const MAX_RETRIES = step.optional ? 0 : 2;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
              try {
                if (step.action === 'click') {
                  const locator = await locateElement(page, step.selector || '');
                  await locator.waitFor({ state: 'visible', timeout: step.optional ? 1500 : 4000 });
                  await locator.click({ timeout: step.optional ? 1500 : 4000 });
                } else if (step.action === 'fill') {
                  const locator = await locateElement(page, step.selector || '');
                  await locator.waitFor({ state: 'visible', timeout: 4000 });
                  const value = resolveCredentialPlaceholders(step.value || '', testCase.role, options.profile?.roles || []);
                  await locator.fill(value, { timeout: 4000 });
                } else if (step.action === 'select') {
                  const locator = await locateElement(page, step.selector || '');
                  await locator.waitFor({ state: 'visible', timeout: 4000 });
                  await locator.selectOption(step.value || '', { timeout: 4000 });
                } else if (step.action === 'navigate') {
                  await page.goto(new URL(step.value || '', options.targetUrl).toString(), {
                    waitUntil: 'domcontentloaded',
                    timeout: 10000,
                  });
                } else if (step.action === 'wait') {
                  await page.waitForTimeout(1000);
                }

                await page.waitForTimeout(300);
                stepSuccess = true;
                currentStepError = undefined;
                break;
              } catch (err: unknown) {
                // Playwright colours its messages for terminals; reports want plain text.
                currentStepError = (err instanceof Error ? err.message : String(err)).replace(/\x1b\[[0-9;]*m/g, '');
                if (attempt < MAX_RETRIES) {
                  await page.waitForTimeout(500);
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
                ? `/api/evidence/${path.relative(outputDir, stepEvidence.screenshotPath).replace(/\\/g, '/')}`
                : undefined,
            });

            // If a step fails after retries, cascade remaining steps as Blocked
            if (!stepSuccess && !skipped) {
              for (let j = i + 1; j < testCase.steps.length; j++) {
                const blockedStep = testCase.steps[j];
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

          // Evaluate Checkers
          const stepEvidenceList = evidenceCollector.getStepEvidenceList();

          // 1. Bug Detection
          const bugFindings = this.bugChecker.check(stepEvidenceList, {
            testCaseId: testCase.id,
            flowId: testCase.flowId,
            role: testCase.role,
            breakpoint: bp,
            urlPath: page.url(),
            planIsGuess: testCase.expectations.origin === 'ai-guess',
          });

          // 2. Spec Conformance
          const observations: string[] = [];
          const specFindings = await this.specChecker.check(page, testCase, stepEvidenceList, {
            role: testCase.role,
            breakpoint: bp,
            baseUrl: options.targetUrl,
            onObservation: (o) => observations.push(o),
          });

          // 3. UX Quality
          const uxFindings = await this.uxChecker.check(page, {
            testCaseId: testCase.id,
            role: testCase.role,
            breakpoint: bp,
            urlPath: new URL(page.url(), options.targetUrl).pathname,
            enableAxe: options.enableA11y ?? true,
            entryPath: new URL(options.targetUrl).pathname,
          });

          // 3b. Security (passive): passwords in page addresses
          const securityFindings = [
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
            })),
          ];

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
          if (designTokens) {
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
          if (testPointPassed) {
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

          const pointFindings = [...bugFindings, ...specFindings, ...uxFindings, ...securityFindings, ...permFindings, ...designFindings];

          // Enrich findings with Source Code Locator and Repro Script
          for (const f of pointFindings) {
            if (f.where.dataTestId) {
              const srcLoc = await sourceLocator.findByTestId(f.where.dataTestId);
              if (srcLoc) {
                f.sourceLocation = srcLoc;
              }
            }

            const reproPath = await reproGenerator.generate(f, testCase, options.targetUrl);
            f.reproScriptPath = path.relative(process.cwd(), reproPath).replace(/\\/g, '/');
            allFindings.push(f);
          }

          // Unconfirmed AI guesses never fail a test point on their own, and that includes a step of
          // an AI plan that couldn't find its control. Every failed step has a finding saying why.
          const hasRealFinding = pointFindings.some((f) => !f.needsConfirmation);
          const status: TestPointResult['status'] = hasRealFinding
            ? 'Failed'
            : pointFindings.length > 0
              ? 'Could not verify'
              : testPointPassed
                ? 'Passed'
                : 'Failed';

          pointResult = {
            testCaseId: testCase.id,
            flowId: testCase.flowId,
            role: testCase.role,
            status,
            durationMs: Date.now() - pointStartTime,
            findings: pointFindings,
            stepEvidence: stepEvidenceList,
            error: stepError,
            observations: observations.length > 0 ? observations : undefined,
          };
        } catch (fatalErr: unknown) {
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
            resolution: 'Check the page loads at this address for this role; a timeout usually means the page is slow or the server stopped.',
            verifyCommand: `qa-test verify F-RUN-${testCase.id}-${bp}`,
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
        }
        results.push(pointResult!);
        onEvent({ type: 'FINDINGS_UPDATED', totalFindings: allFindings.length });
      }
    }

    await this.browserManager.close();

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
      completionRate: totalTestPoints > 0 ? (totalTestPoints / totalTestPoints) * 100 : 100,
    };

    // Apply Suppressions & Compute Delta
    // One problem, one finding, however many test points, widths or roles ran into it.
    const uniqueFindings = mergeDuplicateFindings(allFindings);
    await suppressionsManager.applySuppressions(uniqueFindings);
    const delta = await suppressionsManager.computeDelta(uniqueFindings);
    const activeSuppressions = await suppressionsManager.loadSuppressions();

    // Build Traceability Matrix
    const traceability: TraceabilityEntry[] = [];
    for (const r of results) {
      const tc = testCasesToRun.find((t) => t.id === r.testCaseId);
      const reqId = tc?.requirementId || `REQ-${tc?.flowId || r.flowId}`;
      const lastStep = r.stepEvidence[r.stepEvidence.length - 1];
      traceability.push({
        requirementId: reqId,
        testCaseId: r.testCaseId,
        flowId: r.flowId,
        name: tc?.name,
        status: r.status,
        description:
          tc?.expectations.text?.description ||
          tc?.expectations.url?.description ||
          tc?.name,
        evidencePath: lastStep?.screenshotPath,
      });
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
      traceability,
      suppressions: activeSuppressions,
      delta,
      notes: notes.length > 0 ? notes : undefined,
      aiModels: options.aiModels,
    };

    // Hide sign-in details (and secret-looking URL parameters) everywhere before anything is kept.
    await redactor.files(evidenceDir);
    const report = withPortablePaths(redactor.deep(fullReport), outputDir);

    // Emit reports to .qa-report
    console.log(`[QA Orchestrator] Generating release readiness report in ${outputDir}...`);
    await reportGenerator.generate(report);
    console.log(`[QA Orchestrator] Reports generated: report.md and findings.json`);

    onEvent({ type: 'RUN_COMPLETED', runId, report });

    return report;
  }
}
