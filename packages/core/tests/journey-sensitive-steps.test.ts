import { describe, it, expect } from 'vitest';
import { TestPlanner } from '../src/discovery/test-planner.js';
import { SENSITIVE_ANSWERS } from '../src/discovery/questions.js';
import type { DiscoveryDraft } from '@qa/types';

describe('journey-sensitive-steps', () => {
  const createDraft = (): DiscoveryDraft => ({
    version: '1.0',
    productId: 'test-product',
    targetUrl: 'http://localhost:3000',
    timestamp: new Date().toISOString(),
    pages: [
      {
        urlPath: '/checkout',
        title: 'Checkout',
        interactiveElementsCount: 2,
        formsCount: 0,
        elements: [
          { tagName: 'button', role: 'button', name: 'Place order', selector: '#place-order', visible: true, enabled: true },
          { tagName: 'input', role: 'textbox', name: 'Email', selector: '#email', visible: true, enabled: true },
        ],
      },
    ],
    flows: [
      {
        id: 'FLOW-1',
        name: 'Checkout Flow',
        role: 'user',
        description: 'Complete order flow',
        startPage: '/checkout',
        steps: [
          { action: 'fill', selector: '#email', value: 'user@example.com', name: 'Fill Email' },
          { action: 'click', selector: '#place-order', name: 'Press “Place order”' },
        ],
      },
    ],
    sensitiveActions: [],
    ambiguityQuestions: [],
  });

  it('drops sensitive click step when there are no answered questions', () => {
    const draft = createDraft();
    const spec = new TestPlanner().plan(draft);

    expect(spec.testCases).toHaveLength(1);
    const tc = spec.testCases[0];
    expect(tc.steps).toHaveLength(1);
    expect(tc.steps[0].selector).toBe('#email');
    expect(tc.steps.some((s) => s.selector === '#place-order')).toBe(false);
  });

  it('keeps sensitive click step when answered with SENSITIVE_ANSWERS.allow', () => {
    const draft = createDraft();
    draft.ambiguityQuestions = [
      {
        id: 'Q-SENSITIVE-1',
        category: 'sensitive_action',
        key: 'sensitive:/checkout:#place-order',
        targetElement: '#place-order',
        urlPath: '/checkout',
        question: 'Should the tests press "Place order"?',
        options: [SENSITIVE_ANSWERS.skip, SENSITIVE_ANSWERS.allow],
        safeAnswer: SENSITIVE_ANSWERS.skip,
        selectedAnswer: SENSITIVE_ANSWERS.allow,
      },
    ];

    const spec = new TestPlanner().plan(draft);
    expect(spec.testCases).toHaveLength(1);
    const tc = spec.testCases[0];
    expect(tc.steps).toHaveLength(2);
    expect(tc.steps.map((s) => s.selector)).toEqual(['#email', '#place-order']);
  });

  it('drops click on an element named Continue whose AI step name is "Delete the invoice"', () => {
    const draft = createDraft();
    draft.pages[0].elements = [
      { tagName: 'button', role: 'button', name: 'Continue', selector: '#continue-btn', visible: true, enabled: true },
      { tagName: 'input', role: 'textbox', name: 'Email', selector: '#email', visible: true, enabled: true },
    ];
    draft.flows[0].steps = [
      { action: 'fill', selector: '#email', value: 'user@example.com', name: 'Fill Email' },
      { action: 'click', selector: '#continue-btn', name: 'Delete the invoice' },
    ];

    const spec = new TestPlanner().plan(draft);
    expect(spec.testCases).toHaveLength(1);
    const tc = spec.testCases[0];
    expect(tc.steps).toHaveLength(1);
    expect(tc.steps[0].selector).toBe('#email');
    expect(tc.steps.some((s) => s.selector === '#continue-btn')).toBe(false);
  });
});
