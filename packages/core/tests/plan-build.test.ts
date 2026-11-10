import { describe, it, expect } from 'vitest';
import {
  emptyPlan,
  buildPlan,
  testsFor,
  screenSizesOf,
  gradedChecksFor,
  siteMapOf,
  handCheckNotes,
  defaultTestCase,
  type PlanBuildContext,
} from '../src/plan/build.js';
import type { DiscoveryDraft, PageInventoryItem, PlanPage, Breakpoint } from '@qa/types';

describe('Plan building in @qa/core (T-208)', () => {
  it('emptyPlan returns clean empty plan with timestamp', () => {
    const plan = emptyPlan('run-101', 'http://example.com');
    expect(plan.runId).toBe('run-101');
    expect(plan.targetUrl).toBe('http://example.com');
    expect(plan.pages).toEqual([]);
    expect(plan.flows).toEqual([]);
    expect(plan.questions).toEqual([]);
    expect(plan.discoveredAt).toBeDefined();
  });

  it('defaultTestCase returns standard sanity test case', () => {
    const tc = defaultTestCase();
    expect(tc.id).toBe('TC-DEFAULT-001');
    expect(tc.flowId).toBe('landing-verification');
    expect(tc.role).toBe('visitor');
    expect(tc.startPage).toBe('/');
  });

  it('screenSizesOf returns defaults when unspecified, and returns custom breakpoints when specified', () => {
    const draft: DiscoveryDraft = {
      version: '1',
      productId: 'p1',
      targetUrl: 'http://example.com',
      timestamp: new Date().toISOString(),
      pages: [],
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
    };
    const defaultContext: PlanBuildContext = {
      runId: 'run-1',
      targetUrl: 'http://example.com',
      productId: 'p1',
      draft,
    };
    expect(screenSizesOf(defaultContext)).toEqual(['375px', '768px', '1440px']);

    const customContext: PlanBuildContext = {
      ...defaultContext,
      breakpoints: ['1440px' as Breakpoint],
    };
    expect(screenSizesOf(customContext)).toEqual(['1440px']);
  });

  it('testsFor expands plan when draft.plan exists, and falls back to sweep and TestPlanner when draft.plan is missing', () => {
    const pages: PageInventoryItem[] = [
      {
        urlPath: '/',
        title: 'Home',
        interactiveElementsCount: 1,
        formsCount: 0,
        elements: [
          { selector: '#btn', role: 'button', name: 'Click me', tagName: 'button', visible: true, enabled: true },
        ],
      },
    ];

    const planPages: PlanPage[] = [
      {
        id: 'page-1',
        urlPath: '/',
        title: 'Home',
        coverage: 'tested',
        reachedBy: ['visitor'],
        source: 'fallback',
        tests: [
          {
            id: 't-1',
            name: 'Home test',
            role: 'visitor',
            source: 'fallback',
            steps: [{ action: 'wait', name: 'Wait' }],
          },
        ],
      },
    ];

    const draftWithPlan: DiscoveryDraft = {
      version: '1',
      productId: 'p1',
      targetUrl: 'http://example.com',
      timestamp: new Date().toISOString(),
      pages,
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
      plan: {
        pages: planPages,
        navigation: [],
        layoutGroups: [],
        otherHosts: [],
      },
    };

    const contextWithPlan: PlanBuildContext = {
      runId: 'run-1',
      targetUrl: 'http://example.com',
      productId: 'p1',
      draft: draftWithPlan,
    };

    const resWithPlan = testsFor(contextWithPlan);
    expect(resWithPlan.specTestCases.length).toBeGreaterThan(0);
    expect(resWithPlan.notRun).toEqual([]);

    // Draft without draft.plan
    const draftWithoutPlan: DiscoveryDraft = {
      version: '1',
      productId: 'p1',
      targetUrl: 'http://example.com',
      timestamp: new Date().toISOString(),
      pages,
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
    };
    const contextWithoutPlan: PlanBuildContext = {
      runId: 'run-1',
      targetUrl: 'http://example.com',
      productId: 'p1',
      draft: draftWithoutPlan,
    };
    const resWithoutPlan = testsFor(contextWithoutPlan);
    expect(resWithoutPlan.specTestCases.length).toBeGreaterThan(0);
  });

  it('testsFor yields no tests and sets noTests when nothing expands, never a substituted default', () => {
    const emptyDraft = (withPlan: boolean): DiscoveryDraft => ({
      version: '1',
      productId: 'p1',
      targetUrl: 'http://example.com',
      timestamp: new Date().toISOString(),
      pages: [],
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
      ...(withPlan ? { plan: { pages: [], navigation: [], layoutGroups: [], otherHosts: [] } } : {}),
    });
    for (const withPlan of [true, false]) {
      const context: PlanBuildContext = {
        runId: 'run-empty',
        targetUrl: 'http://example.com',
        productId: 'p1',
        draft: emptyDraft(withPlan),
      };
      const res = testsFor(context);
      expect(res.specTestCases).toEqual([]);
      expect(res.noTests).toBeTruthy();
      const plan = buildPlan({ context, aiAvailable: false, reason: '' });
      expect(plan.testCases).toEqual([]);
      expect(plan.noTests).toContain('Nothing to test');
      expect(plan.testCases?.some((t) => t.id === 'TC-DEFAULT-001')).toBe(false);
    }
  });

  it('testsFor leaves noTests unset when tests exist', () => {
    const context: PlanBuildContext = {
      runId: 'run-1',
      targetUrl: 'http://example.com',
      productId: 'p1',
      draft: {
        version: '1',
        productId: 'p1',
        targetUrl: 'http://example.com',
        timestamp: new Date().toISOString(),
        pages: [],
        flows: [],
        sensitiveActions: [],
        ambiguityQuestions: [],
        plan: {
          pages: [
            {
              id: 'page-1',
              urlPath: '/',
              title: 'Home',
              coverage: 'tested',
              reachedBy: ['visitor'],
              source: 'fallback',
              tests: [
                {
                  id: 't-1',
                  name: 'Home test',
                  role: 'visitor',
                  source: 'fallback',
                  steps: [{ action: 'wait', name: 'Wait' }],
                },
              ],
            },
          ],
          navigation: [],
          layoutGroups: [],
          otherHosts: [],
        },
      },
    };
    expect(testsFor(context).noTests).toBeUndefined();
  });

  it('testsFor populates notRun for readOnly context when flows need test copy', () => {
    const draft: DiscoveryDraft = {
      version: '1',
      productId: 'p1',
      targetUrl: 'http://example.com',
      timestamp: new Date().toISOString(),
      pages: [],
      flows: [
        {
          id: 'flow-write',
          name: 'Submit Order Form',
          role: 'user',
          description: 'Fills in and sends the order form',
          startPage: '/order',
          needsTestCopy: true,
          steps: [],
        },
      ],
      sensitiveActions: [],
      ambiguityQuestions: [],
    };

    const context: PlanBuildContext = {
      runId: 'run-ro',
      targetUrl: 'http://example.com',
      productId: 'p1',
      readOnly: true,
      draft,
    };

    const res = testsFor(context);
    expect(res.notRun).toHaveLength(1);
    expect(res.notRun[0]).toMatchObject({
      id: 'TC-flow-write',
      flowId: 'flow-write',
      name: 'Submit Order Form',
    });
  });

  it('gradedChecksFor marks looks and findable according to context', () => {
    const draft: DiscoveryDraft = {
      version: '1',
      productId: 'p1',
      targetUrl: 'http://example.com',
      timestamp: new Date().toISOString(),
      pages: [],
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
      plan: {
        pages: [],
        navigation: [],
        layoutGroups: [],
        otherHosts: [],
      },
    };

    const contextNoAi: PlanBuildContext = {
      runId: 'run-1',
      targetUrl: 'http://example.com',
      productId: 'p1',
      draft,
      searchChecks: false,
    };

    const checks = gradedChecksFor(contextNoAi) ?? [];
    expect(checks).toHaveLength(6);
    const looks = checks.find((c) => c.id === 'check:looks');
    expect(looks?.notGraded).toContain('no AI is set up');
    const findable = checks.find((c) => c.id === 'check:findable');
    expect(findable?.notGraded).toContain('this isn’t the public site');
  });

  it('buildPlan produces full ReviewPlan with relative screenshot paths', () => {
    const pages: PageInventoryItem[] = [
      {
        urlPath: '/',
        title: 'Home',
        interactiveElementsCount: 0,
        formsCount: 0,
        screenshotPath: 'pages/home.png',
        elements: [],
      },
    ];

    const planPages: PlanPage[] = [
      {
        id: 'p-1',
        urlPath: '/',
        title: 'Home',
        coverage: 'tested',
        reachedBy: ['visitor'],
        source: 'fallback',
        screenshotPath: 'pages/home.png',
        tests: [],
      },
    ];

    const draft: DiscoveryDraft = {
      version: '1',
      productId: 'p1',
      targetUrl: 'http://example.com',
      timestamp: '2026-10-15T10:00:00.000Z',
      pages,
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
      plan: {
        pages: planPages,
        navigation: [],
        layoutGroups: [],
        otherHosts: [],
      },
    };

    const context: PlanBuildContext = {
      runId: 'run-test',
      targetUrl: 'http://example.com',
      productId: 'p1',
      draft,
    };

    const plan = buildPlan({
      context,
      aiAvailable: false,
      reason: 'Live production site',
      relative: (file?: string) => (file ? `/custom-evidence/${file}` : undefined),
    });

    expect(plan.runId).toBe('run-test');
    expect(plan.targetUrl).toBe('http://example.com');
    expect(plan.readOnlyReason).toBe('Live production site');
    expect(plan.pages[0].screenshotPath).toBe('/custom-evidence/pages/home.png');
    expect(plan.planPages?.[0].screenshotPath).toBe('/custom-evidence/pages/home.png');
    expect(plan.screenSizes).toEqual(['375px', '768px', '1440px']);
  });

  it('siteMapOf and handCheckNotes extract summary and hand checks', () => {
    const draft: DiscoveryDraft = {
      version: '1',
      productId: 'p1',
      targetUrl: 'http://example.com',
      timestamp: new Date().toISOString(),
      pages: [
        {
          urlPath: '/',
          title: 'Home',
          interactiveElementsCount: 0,
          formsCount: 0,
          screenshotPath: 'shot.png',
          reachedBy: ['visitor'],
          elements: [],
        },
      ],
      flows: [
        {
          id: 'flow-1',
          name: 'Manual check flow',
          role: 'visitor',
          description: 'A journey with a rule only a person can check',
          startPage: '/',
          steps: [],
          userRules: [
            { text: 'Verify phone number banner', origin: 'user', checkable: false },
            { text: 'Auto check', origin: 'user', checkable: true },
          ],
        },
      ],
      sensitiveActions: [],
      ambiguityQuestions: [],
    };

    const siteMap = siteMapOf(draft, 'run-1', (f) => (f ? `/rel/${f}` : undefined));
    expect(siteMap.pages).toHaveLength(1);
    expect(siteMap.pages[0].screenshotPath).toBe('/rel/shot.png');
    expect(siteMap.journeys).toHaveLength(1);
    expect(siteMap.journeys[0].id).toBe('flow-1');

    const notes = handCheckNotes(draft);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toBe('Check by hand (“Manual check flow”): Verify phone number banner');
  });
});
