import { normalizePlanIntents, normalizeTestIntents } from '@qa/types';
import type { DiscoveredFlow, PageLink, ReviewPlan, TestCase } from '@qa/types';
import type { StoredPlanRecord } from './session/checkup-session.js';

/** Plans saved before Intent carry the old Denial kind; read them as `intent: 'denied'`. */
export function normalizeStoredPlan(record: StoredPlanRecord): StoredPlanRecord {
  if (!record?.plan || !record.context) return record;
  const draftPlan = record.context.draft?.plan;
  return {
    ...record,
    status: record.status ?? 'awaiting-review',
    plan: normalizePlanIntents(record.plan),
    context: {
      ...record.context,
      draft: draftPlan
        ? {
            ...record.context.draft,
            plan: { ...draftPlan, pages: draftPlan.pages.map((p) => ({ ...p, tests: normalizeTestIntents(p.tests) })) },
          }
        : record.context.draft,
    },
  };
}

/**
 * The plan as the review screen needs it: without each page's raw inventory of controls, and with
 * its links cut down to where they go (the map's lines). The full plan stays on the server.
 */
export function planForClient(plan: ReviewPlan): ReviewPlan {
  const { testCases: _testCases, ...rest } = plan;
  return {
    ...rest,
    pages: plan.pages.map(({ elements: _elements, links, ...page }) => ({
      ...page,
      links: links?.filter((l) => !l.leavesSite).map((l) => ({ to: l.to, landsOn: l.landsOn }) as PageLink),
    })),
  };
}

/**
 * What a PATCH that only switched items, answered questions or changed sizes changed: the summary,
 * what won't run, the answers, the sizes, and the items touched (a page whole when one of its tests was).
 */
export function planDelta(plan: ReviewPlan, touched: Set<string>) {
  const pageTouched = (p: NonNullable<ReviewPlan['planPages']>[number]) =>
    touched.has(p.id) || p.tests.some((t) => touched.has(t.id));
  return {
    delta: true as const,
    summary: plan.summary,
    wontRun: plan.wontRun,
    screenSizes: plan.screenSizes,
    questions: plan.questions,
    planPages: (plan.planPages || []).filter(pageTouched),
    navigation: (plan.navigation || []).filter((n) => touched.has(n.id)),
    flows: plan.flows.filter((f) => touched.has(`journey:${f.id}`)),
  };
}

/** A test case in the shape the plan check reads. */
export function asFlow(testCase: TestCase): DiscoveredFlow {
  return {
    id: testCase.id,
    name: testCase.name || testCase.id,
    role: testCase.role,
    description: '',
    startPage: testCase.startPage,
    steps: testCase.steps || [],
  };
}

