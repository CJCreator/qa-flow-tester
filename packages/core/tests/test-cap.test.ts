/** Test cap edges through expandPlan (ADR 0024). Fuller cases live in rejects-gating.test.ts. */
import { describe, it, expect } from 'vitest';
import type { DiscoveredFlow, DiscoveryDraft, PlanPage, PlanPageTest } from '@qa/types';
import { expandPlan, OVER_TEST_CAP } from '../src/plan/expand.js';
import { deriveRejects } from '../src/plan/rejects.js';

const form = {
  urlPath: '/lab/signup',
  method: 'POST',
  submitButtonSelector: '#go',
  inputs: [{ selector: '#email', label: 'Email', type: 'email', required: true }],
};
const page = (tests: PlanPageTest[]): PlanPage => ({
  id: 'page:/lab/signup',
  urlPath: '/lab/signup',
  title: 'Signup',
  coverage: 'tested',
  reachedBy: ['visitor'],
  tests,
  source: 'fallback',
});
const draft = (tests: PlanPageTest[]) =>
  ({
    version: '1.0',
    targetUrl: 'https://x.example/',
    timestamp: '',
    siteType: 'app',
    pages: [],
    forms: [],
    flows: [],
    sensitiveActions: [],
    ambiguityQuestions: [],
    plan: { pages: [page(tests)], navigation: [], layoutGroups: [], otherHosts: [] },
  }) as unknown as DiscoveryDraft;
const rejects = () => deriveRejects([page([])], [form]).map((o) => o.test);

describe('Test cap edges', () => {
  it('a cap equal to the planned total trims nothing', () => {
    const opts = { readOnly: false, screenSizes: ['1440px' as const] };
    const full = expandPlan(draft(rejects()), opts);
    const same = expandPlan(draft(rejects()), { ...opts, testCap: full.summary.tests });
    expect(same.summary.overCap).toBeUndefined();
    expect(same.testCases).toEqual(full.testCases);
  });

  it('one under the total trims at least one Test and labels it', () => {
    const opts = { readOnly: false, screenSizes: ['1440px' as const] };
    const full = expandPlan(draft(rejects()), opts);
    const out = expandPlan(draft(rejects()), { ...opts, testCap: full.summary.tests - 1 });
    expect(out.summary.overCap).toBeGreaterThan(0);
    expect(out.wontRun.filter((w) => w.reason === OVER_TEST_CAP).length).toBeGreaterThan(0);
  });

  it('does not trim Rejects that are already off for the Test Copy reason', () => {
    const out = expandPlan(draft(rejects()), { readOnly: true, screenSizes: ['1440px'], testCap: 1 });
    expect(out.wontRun.some((w) => w.reason === OVER_TEST_CAP)).toBe(false);
  });
});

/** A journey that presses the form's send button: a Rejects journey (C7). */
const rejectsJourney = (): DiscoveredFlow => ({
  id: 'flow-reject',
  intent: 'rejects',
  name: 'Send the form with a bad email',
  role: 'visitor',
  description: 'Sends an invalid email and expects a refusal',
  startPage: '/lab/signup',
  steps: [
    { action: 'navigate', value: '/lab/signup', name: 'Open the signup page' },
    { action: 'click', selector: '#go', name: 'Press send' },
  ],
  source: 'fallback',
});
const draftWithJourney = (tests: PlanPageTest[]) => ({ ...draft(tests), flows: [rejectsJourney()] }) as DiscoveryDraft;

describe('Test cap is one total across kinds (C7)', () => {
  const opts = { readOnly: false, screenSizes: ['1440px' as const] };

  it('a journey Rejects is dropped by the cap, not just page tests', () => {
    const full = expandPlan(draftWithJourney(rejects()), opts);
    expect(full.testCases.some((tc) => tc.kind === 'journey' && tc.intent === 'rejects')).toBe(true);
    const out = expandPlan(draftWithJourney(rejects()), { ...opts, testCap: full.summary.tests - 1 });
    expect(out.testCases.some((tc) => tc.kind === 'journey')).toBe(false);
    expect(out.testCases.some((tc) => tc.kind === 'page-test')).toBe(true);
    expect(out.wontRun.some((w) => w.reason === OVER_TEST_CAP && w.itemId === 'journey:flow-reject')).toBe(true);
    expect(out.summary.tests).toBeLessThanOrEqual(full.summary.tests - 1);
  });

  it('cap reached across two kinds: drops the last planned first (journey, then page test), deterministically', () => {
    const run = () => expandPlan(draftWithJourney(rejects()), { ...opts, testCap: 1 });
    const out = run();
    // Page visit (Works, never dropped) stays; the journey goes first, then the page Rejects.
    expect(out.testCases.map((tc) => tc.kind)).toEqual(['page']);
    const dropped = out.wontRun.filter((w) => w.reason === OVER_TEST_CAP).map((w) => w.itemId);
    expect(dropped).toEqual([
      'journey:flow-reject',
      ...rejects()
        .map((t) => t.id)
        .reverse(),
    ]);
    expect(out.summary.overCap).toBe(1 + rejects().length);
    expect(run()).toEqual(out);
  });

  it('a cap that fits both kinds trims nothing', () => {
    const full = expandPlan(draftWithJourney(rejects()), opts);
    const same = expandPlan(draftWithJourney(rejects()), { ...opts, testCap: full.summary.tests });
    expect(same.summary.overCap).toBeUndefined();
    expect(same.testCases).toEqual(full.testCases);
  });
});
