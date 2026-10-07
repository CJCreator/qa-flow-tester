import path from 'path';
import type { ReleaseReport, TestPointResult } from '@qa/types';
import { SafePublicCrawler, scanScope } from './competitive/safe-crawler.js';
import { ReportGenerator, withPortablePaths } from './reporter.js';
import { Redactor } from './redact.js';
import { mergeDuplicateFindings } from './finding-groups.js';
import type { OrchestratorEvent } from './orchestrator.js';

export interface SafeWebsiteScanOptions {
  targetUrl: string;
  productId?: string;
  outputDir?: string;
  runId?: string;
  headless?: boolean;
  /** Default true: public sites' robots.txt is honored. */
  respectRobots?: boolean;
  /** Pages to visit by following same-site links. Default 25. */
  maxPages?: number;
  /** Minimum pause between page loads. Default 2000 ms. */
  pageDelayMs?: number;
  onEvent?: (event: OrchestratorEvent) => void;
}

const SCAN_TEST_CASE_ID = 'SAFE-SCAN';

/**
 * Read-only scan of a public website: Safe Interaction Mode crawl plus bug-detection and
 * accessibility checks, written as the same report.md / findings.json a product run produces.
 * Never signs in, submits a form, or sends a mutating request.
 */
export async function runSafeWebsiteScan(options: SafeWebsiteScanOptions): Promise<ReleaseReport> {
  const startTime = Date.now();
  const runId = options.runId || `run-${Date.now()}`;
  const productId = options.productId || new URL(options.targetUrl).hostname;
  const outputDir = options.outputDir || path.join(process.cwd(), '.qa-report');
  const onEvent = options.onEvent || (() => {});

  // Nothing is signed into, but a site can still put a token in an address: hide it everywhere.
  const redactor = new Redactor();
  const emit = (event: OrchestratorEvent) => onEvent(redactor.deep(event));
  const maxPages = options.maxPages ?? 25;

  emit({
    type: 'RUN_STARTED',
    runId,
    targetUrl: options.targetUrl,
    productId,
    testCaseCount: maxPages,
    mode: 'safe-public',
  });

  let stepIndex = 0;
  let stepStartedAt = Date.now();
  const scan = await new SafePublicCrawler().scan({
    entryUrl: options.targetUrl,
    flowName: 'Safe website scan',
    outputDir,
    headless: options.headless,
    respectRobots: options.respectRobots,
    maxPages,
    pageDelayMs: options.pageDelayMs,
    onStepStarted: (index, action) => {
      stepIndex = index - 1;
      stepStartedAt = Date.now();
      emit({
        type: 'STEP_STARTED',
        stepIndex,
        stepName: action,
        action: action.startsWith('Opened') || index === 1 ? 'navigate' : 'click',
        testCaseId: SCAN_TEST_CASE_ID,
      });
    },
    onStepCompleted: (_index, findingsSoFar) => {
      emit({ type: 'STEP_COMPLETED', stepIndex, passed: true, durationMs: Date.now() - stepStartedAt });
      emit({ type: 'FINDINGS_UPDATED', totalFindings: findingsSoFar });
    },
  });

  // One problem, one finding: a third-party file failing on every page is reported once.
  const findings = mergeDuplicateFindings(scan.findings);

  // One result per page visited, holding that page's findings and steps.
  const pathOf = (url: string) => {
    try {
      return new URL(url, options.targetUrl).pathname;
    } catch {
      return url;
    }
  };
  const results: TestPointResult[] = scan.pages.map((visited, i) => {
    const pageFindings = scan.findings.filter((f) => pathOf(f.where.urlPath) === visited.urlPath);
    return {
      testCaseId: `PAGE-${String(i + 1).padStart(3, '0')}`,
      flowId: 'safe-website-scan',
      role: 'visitor',
      status: pageFindings.length > 0 ? 'Failed' : 'Passed',
      durationMs: 0,
      findings: pageFindings,
      stepEvidence: scan.stepEvidence.filter((s) => pathOf(s.urlAfter) === visited.urlPath),
    };
  });
  const passed = results.filter((r) => r.status === 'Passed').length;

  const notes: string[] = [];
  const scope = scanScope(options.targetUrl);
  if (scope !== '/') {
    notes.push(`Stayed within ${scope}, the part of the site the review started in.`);
  }
  if (scan.skippedByRobots.length > 0) {
    notes.push(
      `Skipped ${scan.skippedByRobots.length} ${scan.skippedByRobots.length === 1 ? 'page' : 'pages'} the site's robots.txt asks crawlers to leave alone: ${scan.skippedByRobots.slice(0, 5).join(', ')}${scan.skippedByRobots.length > 5 ? ', …' : ''}.`
    );
  }
  if (scan.pages.length >= maxPages) {
    notes.push(`Stopped after ${maxPages} pages, the limit for a standard review.`);
  }

  const fullReport: ReleaseReport = redactor.deep({
    runId,
    productId,
    targetUrl: options.targetUrl,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    coverage: {
      totalTestPoints: results.length,
      passed,
      failed: results.length - passed,
      blocked: 0,
      skipped: 0,
      couldNotVerify: 0,
      completionRate: 100,
    },
    results,
    findings,
    scanMode: 'safe-public',
    notes: notes.length > 0 ? notes : undefined,
    pages: scan.pages,
  });
  const report = withPortablePaths(fullReport, outputDir);

  await redactor.files(path.join(outputDir, 'evidence'));
  await new ReportGenerator(outputDir).generate(report);
  emit({ type: 'RUN_COMPLETED', runId, report });
  return report;
}
