import type { PlanNotFound } from './plan.js';
import type { RoleNotTested } from './evidence-finding.js';
import type { Breakpoint, RuleOrigin, TestCase } from './test-case.js';
import type { AmbiguityQuestion, PageInventoryItem, DiscoveredFlow } from './discovery.js';
import type { PlanPage, NavigationCheck, PlanGradedCheck, PlanLayoutGroup, AIRequestBudget, PlanWontRun, PlanSummary, PlanOtherHost } from './plan.js';

// --- Phase 1: Plan review types (Tasks 1.2 & 1.3) ---

/**
 * The four states a run moves through when plan review is enabled.
 * - scanning        : discovery + page sweep in progress
 * - awaiting-review : discovery done; plan is on disk; runner is waiting for approval
 * - testing         : plan approved; FlowTestOrchestrator is running
 * - done            : run finished (pass or fail)
 * - failed          : unrecoverable error from any state
 */
export type RunnerPhase = 'idle' | 'scanning' | 'awaiting-review' | 'testing' | 'done' | 'failed';

export interface PlanCheck {
  sentence: string;
  origin: RuleOrigin;
}

export interface PlanJourney {
  id: string;
  name: string;
  role: string;
  reason?: string;
  startPage: string;
  steps: string[];
  checks: PlanCheck[];
  needsHelp?: string[];
}

export interface PlanSiteWideCheck {
  name: string;
  description: string;
}

export interface PlanPageItem {
  urlPath: string;
  title: string;
  layoutGroup?: string;
  screenshotPath?: string;
}

export interface PlanPageGroup {
  section: string;
  layoutGroup: string;
  pages: PlanPageItem[];
}

/**
 * The plan stored on disk after discovery, served at GET /api/runner/plan.
 * This is what the wizard shows on the map screen before testing starts.
 */
export interface ReviewPlan {
  /** Matches the runId from the POST /api/runner/run response. */
  runId: string;
  targetUrl: string;
  siteType?: string;
  /** ISO-8601 timestamp when discovery finished. */
  discoveredAt: string;
  pages: PageInventoryItem[];
  flows: DiscoveredFlow[];
  /**
   * Questions the AI couldn't answer from the page alone — shown on the plan map
   * so the user can answer them before testing starts.
   */
  questions: AmbiguityQuestion[];
  /**
   * Test cases the planner derived from the flows; can be edited via PATCH before approving.
   * Absent until the user has approved once (then kept for re-runs).
   */
  testCases?: TestCase[];
  /** True if the generic template fallback was used because AI discovery failed. */
  usedFallbackDiscovery?: boolean;
  /** The site isn't a test copy: journeys that send a form stay in the plan but aren't run. */
  readOnly?: boolean;
  /** Why the run is read-only, in plain words. */
  readOnlyReason?: string;
  /** Sentences about what the scan could and couldn't reach, e.g. pages behind a sign-in. */
  notes?: string[];
  /** What changed since this site's last run. Absent on a site's first run. */
  sinceLastRun?: { newPages: number; newJourneys: number; newQuestions: number; rememberedAnswers: number };
  /** False when no AI key is set up: fixed rules chose the journeys, and describing a test is off. */
  aiAvailable?: boolean;
  /** Roles that signed in and explored the site. */
  signedInAs?: string[];
  /** Journeys translated to plain sentences with origins. */
  journeys?: PlanJourney[];
  /** Fixed site-wide checks that apply across all pages. */
  siteWideChecks?: PlanSiteWideCheck[];
  /** Scanned pages grouped by section and layout. */
  pageGroups?: PlanPageGroup[];
  /** Attached product specification, PRD, or user stories context. */
  productContext?: string;
  /** Attached design system tokens or styling guidelines. */
  designNotes?: string;

  // The complete Plan (ADR 0009). Absent on plans made before it.
  /** Every page found, and how each is covered. */
  planPages?: PlanPage[];
  /** Every Navigation Check. */
  navigation?: NavigationCheck[];
  /** The graded aspects every tested page gets. */
  gradedChecks?: PlanGradedCheck[];
  layoutGroups?: PlanLayoutGroup[];
  /** Screen sizes the run uses. */
  screenSizes?: Breakpoint[];
  /** Who the run tests as: 'visitor' and the roles that signed in. */
  roles?: string[];
  /** What won't run, and why. */
  wontRun?: PlanWontRun[];
  budget?: AIRequestBudget;
  /** What approving runs, and every default applied. */
  summary?: PlanSummary;
  /** Other hosts the site links to. */
  otherHosts?: PlanOtherHost[];
  /** Some Plan Items were planned while the Spider was still crawling (ADR 0020). */
  plannedWhileCrawling?: boolean;
  /** Documented items with no matching page or control. */
  notFound?: PlanNotFound[];
  /** How many documented items the Check-up reached, of all documented items. */
  documentedItems?: { reached: number; total: number };
  /** Roles that could not sign in, and why. */
  rolesNotTested?: RoleNotTested[];
  /** Product Context documents used: names and sizes only, never the text. */
  contextDocuments?: Array<{ name: string; chars: number }>;
}
