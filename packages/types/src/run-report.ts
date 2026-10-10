import type { FindingSeverity, CheckerType, Breakpoint, TestPointStatus } from './test-case.js';
import type { StepEvidence, Finding, RoleNotTested } from './evidence-finding.js';
import type { MarketingReview, SiteAspectGrades, RankedRecommendation, SiteHistoryDiff, SlowerThanLastTime, SiteMapSummary, VisitedPage } from './aspects.js';
import type { AIStage } from './ai.js';
import type { RetryTelemetryEntry } from './hub.js';
import type { AIStageUsage, DocSource } from './plan.js';

export interface TestPointResult {
  testCaseId: string;
  flowId: string;
  role: string;
  status: TestPointStatus;
  durationMs: number;
  findings: Finding[];
  stepEvidence: StepEvidence[];
  error?: string;
  /** Session recording, kept only for failed test points. */
  videoPath?: string;
  /** What the site was seen doing, e.g. the error message it showed. Becomes an 'observed' rule. */
  observations?: string[];
  /** Why a Skipped test point wasn't run, in plain words, e.g. "Needs a test copy". */
  skipReason?: string;
  /** The screen width it ran at. */
  breakpoint?: Breakpoint;
  /** Every check that ran, and how it went, so a report can list the passed ones too. */
  checks?: Array<{ checker: CheckerType; name: string; outcome: 'passed' | 'failed' | 'could-not-verify' }>;
  /**
   * Set when the steps failed at first and the flow passed on a clean second attempt. It still
   * counts as passed, but is shown as unreliable.
   */
  retry?: RetryTelemetryEntry;
}

export interface RunCoverage {
  totalTestPoints: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  couldNotVerify: number;
  /** Test points that failed once, then passed on a clean retry. Already counted in `passed`. */
  flakyFlows?: number;
  completionRate: number; // percentage
}

export interface TraceabilityEntry {
  requirementId: string;
  testCaseId: string;
  flowId: string;
  name?: string;
  status: TestPointStatus;
  description?: string;
  evidencePath?: string;
}

export interface SuppressionRule {
  findingTitle: string;
  urlPath?: string;
  checker?: CheckerType;
  triageStatus: 'Intended' | 'False Positive';
  reason?: string;
  dateAdded: string;
  /** The site it's for, e.g. "localhost:3050". Rules without one apply to every site. */
  host?: string;
}

export interface RunDelta {
  newFindings: number;
  fixedFindings: number;
  openFindings: number;
  suppressedFindings: number;
}

export interface ReleaseReport {
  /** Contract version of the written findings.json (ADR 0017). Absent in files from before the contract. */
  schemaVersion?: number;
  /** Roles that could not sign in, and why. They were not tested. */
  rolesNotTested?: RoleNotTested[];
  /** Documented items reached, of all documented, and the ones not found in the app. */
  documentedItems?: { reached: number; total: number; notFound: Array<{ docSource: DocSource; reason: string }> };
  /** Pages found while exploring, how many were reached, and why the rest were skipped. */
  pageCoverage?: {
    found: number;
    reached: number;
    skipped: Array<{ urlPath: string; why: 'page-limit' | 'did-not-load' | 'robots' | 'sign-in' }>;
  };
  runId: string;
  productId: string;
  targetUrl: string;
  timestamp: string;
  durationMs: number;
  coverage: RunCoverage;
  results: TestPointResult[];
  findings: Finding[];
  traceability?: TraceabilityEntry[];
  suppressions?: SuppressionRule[];
  delta?: RunDelta;
  /** True when this run's test cases came from the generic template fallback, not real AI-driven discovery. */
  usedFallbackDiscovery?: boolean;
  /**
   * 'safe-public' when this report came from a read-only website scan (no sign-in, no form
   * submissions, no data changes), so it must not be read as full product coverage. 'read-only'
   * when a planned run was kept from sending forms because the site isn't a test copy.
   */
  scanMode?: 'full' | 'read-only' | 'safe-public';
  /** Plain sentences about what this run could and couldn't cover, e.g. pages behind a sign-in. */
  notes?: string[];
  /** Pages a website scan visited, in order, grouped by layout (pages built from one template share a group). */
  pages?: VisitedPage[];
  /** The AI models that planned the run (text) and would review screenshots (vision). */
  aiModels?: { text?: string; vision?: string };
  /** Testing was stopped early and the report made from what was done: a partial check-up. */
  partial?: { done: number; planned: number };
  /** The AI's visual review of one screen per layout: how far it got. `remaining` can be finished from the report. */
  visualReview?: { reviewed: number; total: number; remaining: number };
  /** AI tokens used per stage (planning, repair, journeys, visual review), for the developer details. */
  aiUsage?: Partial<Record<AIStage, AIStageUsage>>;
  grades?: SiteAspectGrades;
  /** The marketing basics checklist. Absent when no page was read for it (search checks off, or the home page not tested). */
  marketing?: MarketingReview;
  recommendations?: RankedRecommendation[];
  history?: SiteHistoryDiff;
  /** Pages slower than the last check-up. Absent when none. Not part of `findings`. */
  slowerThanLastTime?: SlowerThanLastTime[];
  singleFileHtmlReportPath?: string;
  /** The site as the plan saw it, so the report can be drawn as a map. Absent for runs without a scan. */
  siteMap?: SiteMapSummary;
  /**
   * "Test again" found nothing new on the site, so this run skipped the review and used the plan
   * approved at this time (ISO-8601).
   */
  testedWithApprovedPlan?: string;
}

/** One finished check-up, as Past check-ups lists it. Written beside each run's report. */
export interface RunSummary {
  runId: string;
  targetUrl: string;
  /** The site as typed, e.g. "localhost:3050": check-ups are grouped by it. */
  host: string;
  /** When the run finished (ISO-8601). */
  timestamp: string;
  durationMs: number;
  ready: boolean;
  stamp: 'Ready to release' | 'Not ready yet';
  reason: string;
  counts: Record<FindingSeverity, number>;
  /** Nothing that could change data was sent. */
  readOnly?: boolean;
  testedWithApprovedPlan?: string;
}
