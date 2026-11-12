import type {
  ReviewPlan,
  TestCase,
  Breakpoint,
  DiscoveryDraft,
  ProductProfile,
  ReleaseReport,
  SiteMapSummary,
  AIProviderType,
} from '@qa/types';
import { signInReasonText, journeyPages } from '@qa/types';
import { expandPlan, GRADED_CHECKS } from './expand.js';
import { NEEDS_TEST_COPY } from '../live-site.js';
import { TestPlanner } from '../discovery/test-planner.js';
import { buildPageSweep } from '../discovery/page-sweep.js';
import type { MemorySummary } from '../site-memory.js';

/**
 * Structural context read by plan building functions.
 * The runner's StoredPlanRecord['context'] satisfies this structurally without exposing secrets.
 */
export interface PlanBuildContext {
  runId: string;
  targetUrl: string;
  productId: string;
  draft: DiscoveryDraft;
  profile?: ProductProfile;
  breakpoints?: Breakpoint[];
  reportNotes?: string[];
  pageCoverage?: ReleaseReport['pageCoverage'];
  readOnly?: boolean;
  searchChecks?: boolean;
  visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean };
  customTestCases?: boolean;
  testCap?: number;
  designNotes?: string;
  productContext?: string;
  contextDocuments?: Array<{ name: string; chars?: number; text?: string }>;
  aiModels?: { text?: string; vision?: string };
  ai?: { provider?: AIProviderType; model?: string; apiKey?: string };
}

/** Why a plan has no tests: shown in Plan Review under "Nothing to test". */
export const NO_TESTS_REASON =
  'Nothing to test: the scan found no page or journey to check. Add a page or a journey, or choose another address.';

/** A sanity test case for runs that have no reviewed plan. Never added to a plan the person reviews. */
export function defaultTestCase(): TestCase {
  return {
    id: 'TC-DEFAULT-001',
    flowId: 'landing-verification',
    name: 'Home page sanity check',
    role: 'visitor',
    startPage: '/',
    steps: [{ action: 'wait', name: 'Wait for page load' }],
    expectations: { url: { pattern: '/*' } },
  };
}

/** An empty plan structure before discovery. */
export function emptyPlan(runId: string, targetUrl: string): ReviewPlan {
  return {
    runId,
    targetUrl,
    discoveredAt: new Date().toISOString(),
    pages: [],
    flows: [],
    questions: [],
  };
}

/** The screen sizes a run uses. */
export function screenSizesOf(context: PlanBuildContext): Breakpoint[] {
  return context.breakpoints?.length ? context.breakpoints : ['375px', '768px', '1440px'];
}

/**
 * The tests a plan runs, and the planned tests a live site leaves out (they need a test copy).
 * A complete Plan is expanded by expandPlan, the one expansion the approval summary shares; a
 * draft from before it runs its journeys and the page sweep.
 */
export function testsFor(context: PlanBuildContext): {
  specTestCases: TestCase[];
  notRun: Array<{ id: string; flowId: string; name: string; role: string; reason: string }>;
  wontRun?: ReviewPlan['wontRun'];
  summary?: ReviewPlan['summary'];
  noTests?: string;
} {
  const { draft } = context;
  const readOnly = !!context.readOnly;
  if (draft.plan) {
    const expanded = expandPlan(draft, {
      readOnly,
      screenSizes: screenSizesOf(context),
      questions: draft.ambiguityQuestions,
      testCap: context.testCap,
    });
    return {
      specTestCases: expanded.testCases,
      notRun: expanded.notRun,
      wontRun: expanded.wontRun,
      summary: expanded.summary,
      noTests: expanded.testCases.length > 0 ? undefined : NO_TESTS_REASON,
    };
  }
  const specTestCases = [...new TestPlanner().plan(draft, { readOnly }).testCases, ...buildPageSweep(draft)];
  const notRun = readOnly
    ? draft.flows
        .filter((f) => f.needsTestCopy && !f.outOfScope && !f.needsHelp?.length)
        .map((f) => ({ id: `TC-${f.id}`, flowId: f.id, name: f.name, role: f.role, reason: NEEDS_TEST_COPY }))
    : [];
  return { specTestCases, notRun, noTests: specTestCases.length > 0 ? undefined : NO_TESTS_REASON };
}

/** The graded checks, each saying up front when it can't be graded this time. */
export function gradedChecksFor(context: PlanBuildContext): ReviewPlan['gradedChecks'] {
  const budget = context.draft.plan?.budget;
  const noVision = !context.aiModels?.vision && context.ai?.provider === 'openrouter';
  const noRequests = budget?.left !== undefined && budget.left <= 0;
  const hasDesign = !!context.designNotes?.trim();
  return GRADED_CHECKS.map((check) => {
    if (check.id === 'check:looks' && !hasDesign && (!context.ai || noVision || noRequests)) {
      return {
        ...check,
        notGraded: !context.ai
          ? 'Needs the AI to look over the screens, and no AI is set up.'
          : noVision
            ? 'Needs an AI model that reads screenshots, and none is free right now. Choose one in Settings.'
            : 'Needs AI requests to look over the screens, and none are left today. Finish it from the report later.',
      };
    }
    if (check.id === 'check:findable' && context.searchChecks === false) {
      return {
        ...check,
        notGraded: 'Not checked: this isn’t the public site. Broken links are still checked, under Works.',
      };
    }
    return check;
  });
}

/**
 * Builds the plan that review shows, from the run's draft.
 * Thumbnails are addressed using the optional `relative` resolver.
 */
export function buildPlan(input: {
  context: PlanBuildContext;
  targetUrl?: string;
  discoveredAt?: string;
  sinceLastRun?: MemorySummary;
  aiAvailable: boolean;
  reason: string;
  /** Run-relative evidence path -> the address used in the Plan. */
  relative?: (file?: string) => string | undefined;
}): ReviewPlan {
  const { context, sinceLastRun, aiAvailable, reason, relative } = input;
  const { draft, readOnly } = context;
  const targetUrl = input.targetUrl || context.targetUrl;
  const discoveredAt = input.discoveredAt || draft.timestamp || new Date().toISOString();
  const rel = relative ?? ((file?: string) => (file ? `/api/evidence/runs/${context.runId}/${file}` : undefined));
  const { specTestCases, wontRun, summary, noTests } = testsFor(context);

  return {
    runId: context.runId,
    targetUrl,
    discoveredAt,
    siteType: draft.siteType,
    pages: draft.pages.map((p) => ({ ...p, screenshotPath: rel(p.screenshotPath) })),
    flows: draft.flows,
    questions: draft.ambiguityQuestions,
    testCases: specTestCases,
    readOnly: readOnly || undefined,
    testCap: context.testCap,
    intentsOff: draft.plan?.intentsOff?.length ? draft.plan.intentsOff : undefined,
    readOnlyReason: reason || undefined,
    notes: draft.exploration?.notes?.length ? draft.exploration.notes : undefined,
    sinceLastRun: sinceLastRun?.seenBefore
      ? {
          newPages: sinceLastRun.newPages,
          newJourneys: sinceLastRun.newJourneys,
          newQuestions: sinceLastRun.newQuestions,
          rememberedAnswers: sinceLastRun.rememberedAnswers,
        }
      : undefined,
    aiAvailable,
    signedInAs: draft.exploration?.signedInAs,
    productContext: context.productContext,
    designNotes: context.designNotes,
    planPages: draft.plan?.pages.map((p) => ({
      ...p,
      screenshotPath: rel(p.screenshotPath) ?? p.screenshotPath,
    })),
    navigation: draft.plan?.navigation,
    gradedChecks: draft.plan ? gradedChecksFor(context) : undefined,
    layoutGroups: draft.plan?.layoutGroups,
    screenSizes: screenSizesOf(context),
    roles: draft.plan
      ? [...new Set<string>(draft.pages.flatMap((p) => (p.reachedBy?.length ? p.reachedBy : ['visitor'])))]
      : undefined,
    wontRun,
    noTests,
    budget: draft.plan?.budget,
    summary,
    otherHosts: draft.plan?.otherHosts,
    plannedWhileCrawling: draft.plan?.plannedWhileCrawling || undefined,
    notFound: draft.plan?.notFound?.length ? draft.plan.notFound : undefined,
    documentedItems: draft.plan?.documentedItems,
    rolesNotTested: draft.exploration?.signInFailures
      ? Object.entries(draft.exploration.signInFailures).map(([role, reasonKey]) => ({
          role,
          reason: reasonKey,
          text: signInReasonText(reasonKey),
        }))
      : undefined,
    contextDocuments: context.contextDocuments?.map((d) => ({
      name: d.name,
      chars: typeof d.chars === 'number' ? d.chars : (d.text?.length ?? 0),
    })),
  };
}

/** The site as the plan saw it, kept in the report so the report can be drawn as a map. */
export function siteMapOf(
  draft: DiscoveryDraft,
  runId: string,
  relative?: (file?: string) => string | undefined
): SiteMapSummary {
  const rel = relative ?? ((file?: string) => (file ? `/api/evidence/runs/${runId}/${file}` : undefined));
  return {
    siteType: draft.siteType,
    pages: draft.pages.map((p) => ({
      urlPath: p.urlPath,
      title: p.title,
      layoutGroup: p.layoutGroup,
      screenshotPath: rel(p.screenshotPath) ?? p.screenshotPath,
      isNew: p.isNew,
      reachedBy: p.reachedBy,
    })),
    journeys: draft.flows.map((f) => ({
      id: f.id,
      name: f.name,
      reason: f.description,
      pages: journeyPages(f),
      needsTestCopy: f.needsTestCopy,
      skipped: f.outOfScope || (f.needsHelp?.length ?? 0) > 0 || undefined,
      source: f.source,
    })),
  };
}

/** Rules the owner added that no test can check: listed in the report for a person to check. */
export function handCheckNotes(draft: DiscoveryDraft): string[] {
  return draft.flows
    .filter((f) => !f.outOfScope)
    .flatMap((f) =>
      (f.userRules || []).filter((r) => !r.checkable).map((r) => `Check by hand (“${f.name}”): ${r.text}`)
    );
}
