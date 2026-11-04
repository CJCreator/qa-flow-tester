/** Rejects/Limits through expandPlan: Test Copy gating, Test cap, Ambiguity Question, opening steps (ADR 0024). No browser. */
import { describe, it, expect } from 'vitest';
import type { AmbiguityQuestion, DiscoveryDraft, PlanPage, PlanPageTest } from '@qa/types';
import { expandPlan, OVER_TEST_CAP, INTENT_SWITCHED_OFF } from '../src/plan/expand.js';
import { deriveRejects } from '../src/plan/rejects.js';
import { INTENT_ANSWERS, intentQuestionsFor } from '../src/discovery/questions.js';
import { SafetyFilter } from '../src/discovery/safety-filter.js';
import type { PlannerForm } from '../src/plan/ai-planner.js';

const formWith = (submit = '#go'): PlannerForm => ({
  urlPath: '/lab/signup',
  method: 'POST',
  submitButtonSelector: submit,
  inputs: [{ selector: '#email', label: 'Email', type: 'email', required: true }],
});

function pageWith(tests: PlanPageTest[]): PlanPage {
  return {
    id: 'page:/lab/signup',
    urlPath: '/lab/signup',
    title: 'Signup',
    coverage: 'tested',
    reachedBy: ['visitor'],
    tests,
    source: 'fallback',
  };
}

function draftOf(pages: PlanPage[], questions: AmbiguityQuestion[] = []): DiscoveryDraft {
  return {
    version: '1.0',
    targetUrl: 'https://x.example/',
    timestamp: '',
    siteType: 'app',
    pages: [],
    forms: [],
    flows: [],
    sensitiveActions: [],
    ambiguityQuestions: questions,
    plan: { pages, navigation: [], layoutGroups: [], otherHosts: [] },
  } as unknown as DiscoveryDraft;
}

const rejects = (): PlanPageTest[] => deriveRejects([pageWith([])], [formWith()]).map((o) => o.test);

describe('Test Copy gating', () => {
  it('readOnly: Rejects are listed with the Test Copy reason and do not run', () => {
    const out = expandPlan(draftOf([pageWith(rejects())]), { readOnly: true, screenSizes: ['1440px'] });
    expect(out.testCases.filter((t) => t.intent === 'rejects')).toEqual([]);
    expect(out.wontRun.length).toBeGreaterThan(0);
    for (const w of out.wontRun) expect(w.reason).toContain('Needs a test copy');
  });

  it('not readOnly: Rejects run, with intent and refusal expectation', () => {
    const out = expandPlan(draftOf([pageWith(rejects())]), { readOnly: false, screenSizes: ['1440px'] });
    const tcs = out.testCases.filter((t) => t.intent === 'rejects');
    expect(tcs.length).toBe(rejects().length);
    expect(tcs[0].expectations.refusal?.submitSelector).toBe('#go');
    expect(out.summary.intents?.rejects.items).toBe(tcs.length);
    expect(out.summary.intents?.rejects.tests).toBe(tcs.length);
  });
});

describe('Test cap', () => {
  const tests = (n: number): PlanPageTest[] =>
    Array.from({ length: n }, (_, i) => ({ ...rejects()[0], id: `rejects:${i}`, name: `Rejects: ${i}` }));
  const works: PlanPageTest = { id: 'w', name: 'Works', role: 'visitor', steps: [{ action: 'wait', name: 'Wait' }], source: 'ai' };

  it('fans out per screen size and trims only Rejects, last planned first, deterministically', () => {
    const draft = () => draftOf([pageWith([works, ...tests(5)])]);
    const sizes = ['375px', '1440px'] as const;
    const full = expandPlan(draft(), { readOnly: false, screenSizes: [...sizes] });
    const base = full.summary.tests - 10; // 5 Rejects x 2 sizes
    const capped = expandPlan(draft(), { readOnly: false, screenSizes: [...sizes], testCap: base + 4 });
    expect(capped.testCases.filter((t) => t.intent === 'rejects').map((t) => t.name)).toEqual([
      'Rejects: 0',
      'Rejects: 1',
    ]);
    expect(capped.wontRun.filter((w) => w.reason === OVER_TEST_CAP).map((w) => w.itemId)).toEqual([
      'rejects:4',
      'rejects:3',
      'rejects:2',
    ]);
    expect(capped.summary.overCap).toBe(6);
    expect(capped.summary.lines.some((l) => l.text === '6 Tests are over the Test cap and switched off')).toBe(true);
    expect(capped.testCases.some((t) => t.name === 'Works')).toBe(true);
    const again = expandPlan(draft(), { readOnly: false, screenSizes: [...sizes], testCap: base + 4 });
    expect(again.testCases).toEqual(capped.testCases);
  });

  it('never drops Works or pages even when over the cap', () => {
    const out = expandPlan(draftOf([pageWith([works, ...tests(2)])]), {
      readOnly: false,
      screenSizes: ['1440px'],
      testCap: 1,
    });
    expect(out.testCases.filter((t) => t.intent === 'rejects')).toEqual([]);
    expect(out.testCases.some((t) => t.kind === 'page')).toBe(true);
    expect(out.testCases.some((t) => t.name === 'Works')).toBe(true);
  });

  it('default cap is 2000: small plans are untouched, no overCap', () => {
    const out = expandPlan(draftOf([pageWith(tests(3))]), { readOnly: false, screenSizes: ['1440px'] });
    expect(out.summary.overCap).toBeUndefined();
  });
});

describe('Ambiguity Question for Sensitive Action submits', () => {
  const sensitivePage = () =>
    pageWith(
      deriveRejects([pageWith([])], [formWith('#delete-account')], {
        inventory: [
          {
            urlPath: '/lab/signup',
            elements: [{ selector: '#delete-account', name: 'Delete account', role: 'button' }],
          } as never,
        ],
      }).map((o) => o.test)
    );

  it('asks only when the submit matches the Safety Filter', () => {
    expect(intentQuestionsFor([pageWith(rejects())], new SafetyFilter([]))).toEqual([]);
    const qs = intentQuestionsFor([sensitivePage()], new SafetyFilter([]));
    expect(qs).toHaveLength(1);
    expect(qs[0].options).toEqual([INTENT_ANSWERS.run, INTENT_ANSWERS.off, INTENT_ANSWERS.probe]);
    expect(qs[0].safeAnswer).toBe(INTENT_ANSWERS.off);
    expect(qs[0].category).toBe('sensitive_action');
    expect(qs[0].key).toBe('intent:/lab/signup:#delete-account');
  });

  it('unanswered = switched off; Run it keeps; probe removes the submit click', () => {
    const page = sensitivePage();
    const [q] = intentQuestionsFor([page], new SafetyFilter([]));
    const run = (answer?: string) =>
      expandPlan(draftOf([page], [{ ...q, selectedAnswer: answer }]), { readOnly: false, screenSizes: ['1440px'] });
    const off = run();
    expect(off.testCases.filter((t) => t.intent === 'rejects')).toEqual([]);
    expect(off.wontRun.every((w) => w.reason === INTENT_SWITCHED_OFF)).toBe(true);
    const kept = run(INTENT_ANSWERS.run).testCases.filter((t) => t.intent === 'rejects');
    expect(kept.length).toBeGreaterThan(0);
    expect(kept[0].steps.some((s) => s.action === 'click')).toBe(true);
    const probe = run(INTENT_ANSWERS.probe).testCases.filter((t) => t.intent === 'rejects');
    expect(probe.length).toBe(kept.length);
    for (const t of probe) {
      expect(t.steps.some((s) => s.action === 'click')).toBe(false);
      expect(t.expectations.refusal?.probeOnly).toBe(true);
    }
  });
});

describe('Opening steps', () => {
  it('are copied from the form and put before the steps', () => {
    const opening = [{ action: 'click' as const, selector: 'text=New', name: 'Open the form' }];
    const tests = deriveRejects([pageWith([])], [{ ...formWith(), opening }]).map((o) => o.test);
    expect(tests[0].openingSteps).toEqual(opening);
    const out = expandPlan(draftOf([pageWith(tests)]), { readOnly: false, screenSizes: ['1440px'] });
    const tc = out.testCases.find((t) => t.intent === 'rejects')!;
    expect(tc.steps[0]).toMatchObject({ action: 'click', selector: 'text=New', opening: true });
    expect(tc.steps[tc.steps.length - 1].selector).toBe('#go');
  });
});
