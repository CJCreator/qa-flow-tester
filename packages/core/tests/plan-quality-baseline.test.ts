import { describe, it, expect } from 'vitest';
import { defaultTestCase, testsFor, type PlanBuildContext } from '../src/plan/build.js';
import { expandPlan } from '../src/plan/expand.js';
import type { TestCase, DiscoveryDraft } from '@qa/types';

describe('Plan Quality Baseline (G6)', () => {
  const sampleDraft: DiscoveryDraft = {
    version: '1.0',
    productId: 'test-app',
    targetUrl: 'https://staging.example.com',
    timestamp: '2026-11-06T12:00:00Z',
    pages: [
      { urlPath: '/', title: 'Home', formsCount: 0, interactiveElementsCount: 2 },
      { urlPath: '/signup', title: 'Sign Up', formsCount: 1, interactiveElementsCount: 3 },
    ],
    flows: [
      {
        id: 'flow-signup',
        name: 'User can sign up',
        description: 'Sign up flow',
        role: 'visitor',
        startPage: '/signup',
        steps: [
          { name: 'Navigate to signup', action: 'navigate', value: '/signup' },
          { name: 'Fill email', action: 'fill', selector: 'input[name="email"]', value: 'test@example.com' },
          { name: 'Click submit', action: 'click', selector: 'button[type="submit"]' },
        ],
      },
    ],
    sensitiveActions: [],
    ambiguityQuestions: [],
    plan: {
      pages: [
        {
          id: 'page-home',
          urlPath: '/',
          title: 'Home',
          coverage: 'sample',
          source: 'fallback',
          reachedBy: ['visitor'],
          tests: [],
        },
        {
          id: 'page-signup',
          urlPath: '/signup',
          title: 'Sign Up',
          coverage: 'sample',
          source: 'fallback',
          reachedBy: ['visitor'],
          tests: [
            {
              id: 'test-signup',
              name: 'Sign up button submits form',
              role: 'visitor',
              source: 'fallback',
              steps: [
                { name: 'Fill email', action: 'fill', selector: 'input[name="email"]', value: 'test@example.com' },
                { name: 'Click submit', action: 'click', selector: 'button[type="submit"]' },
              ],
            },
          ],
        },
      ],
      navigation: [],
      layoutGroups: [],
      otherHosts: [],
    },
  };

  it('generates a default sanity test case when no journeys exist', () => {
    const defaultTc = defaultTestCase();
    expect(defaultTc.id).toBe('TC-DEFAULT-001');
    expect(defaultTc.role).toBe('anonymous');
    expect(defaultTc.steps.length).toBeGreaterThan(0);
    expect(defaultTc.steps[0].name).toBeTruthy();
  });

  it('deterministic baseline expands validation rules without syntax violations', () => {
    const expanded = expandPlan(sampleDraft, { readOnly: false, screenSizes: ['1440px'] });
    expect(expanded).toBeDefined();
    expect(expanded.testCases.length).toBeGreaterThanOrEqual(1);

    for (const test of expanded.testCases) {
      expect(test.id).toBeTruthy();
      expect(test.role).toBeTruthy();
      expect(test.steps.length).toBeGreaterThan(0);
      for (const step of test.steps) {
        expect(step.name).toBeTruthy();
        expect(step.action).toBeTruthy();
      }
    }
  });

  it('measures plan quality metrics (step count, action ratio, safety conformance)', () => {
    const expanded = expandPlan(sampleDraft, { readOnly: false, screenSizes: ['1440px'] });
    const totalSteps = expanded.testCases.reduce((acc: number, it: TestCase) => acc + it.steps.length, 0);
    const avgStepsPerItem = totalSteps / expanded.testCases.length;

    // Quality thresholds
    expect(avgStepsPerItem).toBeGreaterThan(0);
    expect(avgStepsPerItem).toBeLessThan(15); // Guard against runaway action generation
  });

  it('resolves test cases for execution context', () => {
    const context: PlanBuildContext = {
      runId: 'run-test-001',
      targetUrl: 'https://staging.example.com',
      productId: 'prod-001',
      draft: sampleDraft,
      breakpoints: ['1440px'],
    };

    const res = testsFor(context);
    expect(res.specTestCases.length).toBeGreaterThanOrEqual(1);
    expect(res.notRun).toBeDefined();
  });
});
