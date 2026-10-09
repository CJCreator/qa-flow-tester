import type {
  AmbiguityQuestion,
  Breakpoint,
  DiscoveryDraft,
  PlanGradedCheck,
  PlanSummary,
  PlanWontRun,
  TestCase,
} from '@qa/types';
import { TestPlanner } from '../discovery/test-planner.js';
import { NEEDS_TEST_COPY } from '../live-site.js';
import { expandValidationTestCases } from '../validator-expander.js';

/** The graded aspects every tested page gets at every screen size (scoring.ts grades them). */
export const GRADED_CHECKS: PlanGradedCheck[] = [
  {
    id: 'check:works',
    name: 'Works',
    description: 'No browser errors or failed requests, every step works, and what was expected happens.',
  },
  {
    id: 'check:accessible',
    name: 'Accessible',
    description: 'WCAG 2.2 AA with axe-core, plus tap target sizes, after each page loads and after each test on it.',
  },
  {
    id: 'check:fast',
    name: 'Fast and mobile',
    description: 'Load speed and Core Web Vitals, and nothing spilling sideways or overlapping on small screens.',
  },
  {
    id: 'check:findable',
    name: 'Findable',
    description: 'Page titles, descriptions and headings, and link health, for search engines.',
  },
  {
    id: 'check:secure',
    name: 'Secure',
    description: 'A secure connection and headers, and no passwords in page addresses.',
  },
  {
    id: 'check:looks',
    name: 'Looks and reads well',
    description:
      'Design tokens and visual baselines when given, and the AI’s visual review of each screen after the run.',
  },
];

const SWITCHED_OFF = 'Switched off in the review.';
/** About how long one test takes, from real check-ups: for "about N minutes". */
const SECONDS_PER_TEST = 4;

export interface ExpandedPlan {
  /** The tests the runner executes, in order. */
  testCases: TestCase[];
  /** Planned tests a live site leaves out, for the report. */
  notRun: Array<{ id: string; flowId: string; name: string; role: string; reason: string }>;
  wontRun: PlanWontRun[];
  summary: PlanSummary;
}

/**
 * Turns the Plan into the tests the runner executes. It is the one expansion the approval summary
 * and the run both use, so what the review counts is exactly what runs:
 * - a visit to every tested page, as everyone who reached it, where every graded check runs;
 * - each test the AI planned on a page, as the explorer it was planned from;
 * - each Navigation Check, as everyone who saw the link, at the sizes where it can be clicked,
 *   and a link that leaves the site as one request, once;
 * - each journey.
 */
export function expandPlan(
  draft: DiscoveryDraft,
  options: { readOnly: boolean; screenSizes: Breakpoint[]; questions?: AmbiguityQuestion[] }
): ExpandedPlan {
  const plan = draft.plan ?? { pages: [], navigation: [], layoutGroups: [], otherHosts: [] };
  const sizes = options.screenSizes;
  const testCases: TestCase[] = [];
  const notRun: ExpandedPlan['notRun'] = [];
  const wontRun: PlanWontRun[] = [];
  const count = { page: 0, test: 0, nav: 0, link: 0 };
  const id = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}`;

  for (const page of plan.pages) {
    if (page.coverage === 'covered') continue;
    if (page.skipped) {
      wontRun.push({ itemId: page.id, what: `Page ${page.urlPath}`, reason: SWITCHED_OFF });
      continue;
    }
    for (const role of page.reachedBy) {
      testCases.push({
        id: id('PAGE', ++count.page),
        kind: 'page',
        planItemId: page.id,
        flowId: 'page-visit',
        name: role === 'visitor' ? `Visit ${page.urlPath}` : `Visit ${page.urlPath} as ${role}`,
        role,
        startPage: page.urlPath,
        steps: [{ action: 'wait', name: 'Look at the page' }],
        expectations: { pageWorks: {} },
      });
    }
    for (const test of page.tests) {
      const reason = test.skipped
        ? SWITCHED_OFF
        : test.needsHelp?.length
          ? test.needsHelp[0]
          : options.readOnly && test.needsTestCopy
            ? NEEDS_TEST_COPY
            : undefined;
      if (reason) {
        wontRun.push({ itemId: test.id, what: `${page.urlPath}: ${test.name}`, reason });
        if (reason === NEEDS_TEST_COPY)
          notRun.push({ id: test.id, flowId: 'page-test', name: test.name, role: test.role, reason });
        continue;
      }
      testCases.push({
        id: id('TEST', ++count.test),
        kind: 'page-test',
        planItemId: test.id,
        flowId: 'page-test',
        name: test.name,
        role: test.role,
        startPage: page.urlPath,
        steps: test.steps.map((s) => ({ ...s })),
        expectations: test.expectations ?? {},
        ...(test.docSource ? { docSource: test.docSource } : {}),
        ...(test.docSeverity ? { docSeverity: test.docSeverity } : {}),
        ...(test.docStale ? { docStale: true } : {}),
      });
    }
  }

  for (const nav of plan.navigation) {
    if (nav.skipped) {
      wontRun.push({ itemId: nav.id, what: nav.name, reason: SWITCHED_OFF });
      continue;
    }
    if (nav.leavesSite) {
      testCases.push({
        id: id('LINK', ++count.link),
        kind: 'link',
        planItemId: nav.id,
        flowId: 'link-check',
        name: nav.name,
        role: nav.roles[0] ?? 'visitor',
        startPage: nav.startPage,
        steps: [{ action: 'check-link', value: nav.to, name: `Check the link to ${nav.to}` }],
        expectations: {},
        breakpoints: sizes.slice(0, 1),
      });
      continue;
    }
    const hidden = (nav.notAt || []).filter((s) => sizes.includes(s));
    const visible = sizes.filter((s) => !hidden.includes(s));
    // A link goes to the same place at every width: it's clicked at the widest size where it shows
    // plainly, and again only where a menu button has to be opened first to reach it.
    const viaMenu = visible.filter((s) => (nav.menuSteps || []).some((step) => step.onlyAt?.includes(s)));
    const plain = visible.filter((s) => !viaMenu.includes(s));
    const at = visible.filter((s) => viaMenu.includes(s) || s === plain[plain.length - 1]);
    if (hidden.length > 0) {
      wontRun.push({
        itemId: nav.id,
        what: at.length > 0 ? `${nav.name}, at ${hidden.join(' and ')}` : nav.name,
        reason: 'The link is hidden at that screen size and no menu button shows it.',
      });
    }
    if (at.length === 0) continue;
    for (const role of nav.roles) {
      testCases.push({
        id: id('NAV', ++count.nav),
        kind: 'navigation',
        planItemId: nav.id,
        flowId: 'navigation',
        name: nav.roles.length > 1 && role !== 'visitor' ? `${nav.name} (as ${role})` : nav.name,
        role,
        startPage: nav.startPage,
        steps: [
          ...(nav.menuSteps || []).map((s) => ({ ...s })),
          { action: 'click', selector: nav.selector, name: `Click “${nav.linkName}”` },
        ],
        // Each role lands where it landed while exploring: a signed-out visitor on the sign-in page.
        expectations: {
          url: { pattern: nav.landsOnBy ? (nav.landsOnBy[role] ?? nav.to) : (nav.landsOn ?? nav.to) },
          pageWorks: { description: nav.expectation },
        },
        breakpoints: at.length === sizes.length ? undefined : at,
      });
    }
  }

  // A journey's validation rules become tests of their own here, as the orchestrator would make them,
  // so the plan counts and lists them too.
  const journeys = expandValidationTestCases(
    new TestPlanner()
      .plan(draft, { readOnly: options.readOnly })
      .testCases.map((tc): TestCase => ({ ...tc, kind: 'journey', planItemId: `journey:${tc.flowId}` }))
  );
  testCases.push(...journeys);
  const ranJourneys = new Set(journeys.map((tc) => tc.flowId));
  for (const flow of draft.flows) {
    if (ranJourneys.has(flow.id)) continue;
    const reason = flow.outOfScope
      ? SWITCHED_OFF
      : flow.needsHelp?.length
        ? flow.needsHelp[0]
        : options.readOnly && flow.needsTestCopy
          ? NEEDS_TEST_COPY
          : 'An answer in the review leaves it out.';
    wontRun.push({ itemId: `journey:${flow.id}`, what: `Journey: ${flow.name}`, reason });
    if (reason === NEEDS_TEST_COPY)
      notRun.push({ id: `TC-${flow.id}`, flowId: flow.id, name: flow.name, role: flow.role, reason });
  }
  for (const path of draft.exploration?.notReached || []) {
    wontRun.push({ what: `Page ${path}`, reason: 'It’s behind a sign-in no role could get past.' });
  }

  return { testCases, notRun, wontRun, summary: summarize(draft, testCases, wontRun, sizes, options.questions) };
}

function summarize(
  draft: DiscoveryDraft,
  testCases: TestCase[],
  wontRun: PlanWontRun[],
  sizes: Breakpoint[],
  questions: AmbiguityQuestion[] = draft.ambiguityQuestions
): PlanSummary {
  const plan = draft.plan ?? { pages: [], navigation: [], layoutGroups: [], otherHosts: [] };
  const tests = testCases.reduce(
    (n, tc) => n + (tc.breakpoints ? tc.breakpoints.filter((b) => sizes.includes(b)).length : sizes.length),
    0
  );
  const visited = new Set(testCases.filter((tc) => tc.kind === 'page').map((tc) => tc.startPage));
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const lines: PlanSummary['lines'] = [
    {
      text: `${plural(tests, 'test', 'tests')} on ${plural(visited.size, 'page', 'pages')} at ${plural(sizes.length, 'screen size', 'screen sizes')} (${sizes.join(', ')})`,
      itemIds: [],
    },
  ];
  const covered = plan.pages.filter((p) => p.coverage === 'covered' && !p.skipped);
  if (covered.length > 0) {
    lines.push({
      text: `${plural(covered.length, 'page is', 'pages are')} covered by Sample Pages and not visited`,
      itemIds: covered.map((p) => p.id),
    });
  }
  const fallback = [
    ...plan.pages.filter((p) => p.coverage !== 'covered' && p.source === 'fallback').map((p) => p.id),
    ...plan.navigation.filter((n) => n.source === 'fallback').map((n) => n.id),
    ...draft.flows.filter((f) => f.source === 'fallback').map((f) => `journey:${f.id}`),
  ];
  if (fallback.length > 0) {
    lines.push({
      text: `${plural(fallback.length, 'item was', 'items were')} planned by fixed rules, not the AI`,
      itemIds: fallback,
    });
  }
  const unanswered = questions.filter((q) => !q.selectedAnswer);
  if (unanswered.length > 0) {
    lines.push({
      text: `${plural(unanswered.length, 'question', 'questions')} will use the safe answer`,
      itemIds: unanswered.map((q) => q.id),
    });
  }
  if (wontRun.length > 0) {
    lines.push({
      text: `${plural(wontRun.length, 'item', 'items')} won’t run`,
      itemIds: wontRun.flatMap((w) => (w.itemId ? [w.itemId] : [])),
    });
  }
  return {
    tests,
    pages: visited.size,
    pagesListed: plan.pages.length,
    screenSizes: sizes,
    lines,
    minutes: Math.max(1, Math.round((tests * SECONDS_PER_TEST) / 60)),
  };
}
