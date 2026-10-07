import { describe, it, expect } from 'vitest';
import { TestPlanner } from '../src/discovery/test-planner.js';
import { applySafeAnswers, formQuestion, FORM_ANSWERS } from '../src/discovery/questions.js';
import type { DiscoveredFlow, DiscoveryDraft } from '@qa/types';

describe('TestPlanner', () => {
  it('should compile active flows into valid SpecFile and TestCase items', () => {
    const draft: DiscoveryDraft = {
      version: '1.0',
      productId: 'test-product',
      targetUrl: 'http://localhost:3000',
      timestamp: new Date().toISOString(),
      pages: [{ urlPath: '/invoices/new', title: 'New Invoice', interactiveElementsCount: 3, formsCount: 1 }],
      flows: [
        {
          id: 'FLOW-INV-1',
          name: 'Create Invoice',
          role: 'manager',
          description: 'Submit an invoice',
          startPage: '/invoices/new',
          steps: [
            { action: 'fill', selector: '#customer', value: 'Test', name: 'Customer' },
            { action: 'click', selector: '#submit', name: 'Submit' },
          ],
          candidateExpectations: {
            url: { pattern: '/invoices/*' },
          },
        },
      ],
      sensitiveActions: [],
      ambiguityQuestions: [],
    };

    const planner = new TestPlanner();
    const spec = planner.plan(draft);

    expect(spec.product).toBe('test-product');
    expect(spec.testCases).toHaveLength(1);
    expect(spec.testCases[0].id).toBe('TC-FLOW-INV-1');
    expect(spec.testCases[0].requirementId).toBe('REQ-FLOW-INV-1');
    expect(spec.testCases[0].steps).toHaveLength(2);
  });

  it('should omit flows marked outOfScope or on outOfScope pages', () => {
    const draft: DiscoveryDraft = {
      version: '1.0',
      productId: 'test-product',
      targetUrl: 'http://localhost:3000',
      timestamp: new Date().toISOString(),
      pages: [
        { urlPath: '/admin', title: 'Admin Page', interactiveElementsCount: 2, formsCount: 0, outOfScope: true },
        { urlPath: '/dashboard', title: 'Dashboard', interactiveElementsCount: 5, formsCount: 1 },
      ],
      flows: [
        {
          id: 'FLOW-1',
          name: 'Admin Flow',
          role: 'admin',
          description: 'Admin actions',
          startPage: '/admin',
          steps: [{ action: 'wait', name: 'Wait' }],
        },
        {
          id: 'FLOW-2',
          name: 'Explicitly Excluded Flow',
          role: 'member',
          description: 'Ignored',
          startPage: '/dashboard',
          steps: [{ action: 'wait', name: 'Wait' }],
          outOfScope: true,
        },
        {
          id: 'FLOW-3',
          name: 'Active Flow',
          role: 'member',
          description: 'Keep me',
          startPage: '/dashboard',
          steps: [{ action: 'wait', name: 'Wait' }],
        },
      ],
      sensitiveActions: [],
      ambiguityQuestions: [],
    };

    const planner = new TestPlanner();
    const spec = planner.plan(draft);

    expect(spec.testCases).toHaveLength(1);
    expect(spec.testCases[0].id).toBe('TC-FLOW-3');
  });

  it('should filter out steps targeting elements skipped via ambiguity questions', () => {
    const draft: DiscoveryDraft = {
      version: '1.0',
      productId: 'test-product',
      targetUrl: 'http://localhost:3000',
      timestamp: new Date().toISOString(),
      pages: [{ urlPath: '/settings', title: 'Settings', interactiveElementsCount: 2, formsCount: 0 }],
      flows: [
        {
          id: 'FLOW-DELETE',
          name: 'Settings Flow',
          role: 'admin',
          description: 'Delete Account',
          startPage: '/settings',
          steps: [
            { action: 'wait', name: 'Inspect Page' },
            { action: 'click', selector: '[data-testid="danger-delete-btn"]', name: 'Delete Account' },
          ],
        },
      ],
      sensitiveActions: [],
      ambiguityQuestions: [
        {
          id: 'Q-1',
          targetElement: '[data-testid="danger-delete-btn"]',
          urlPath: '/settings',
          question: 'Encountered delete action. What should happen?',
          options: ['Allow', 'Skip permanently (out of scope)'],
          selectedAnswer: 'Skip permanently (out of scope)',
          category: 'sensitive_action',
        },
      ],
    };

    const planner = new TestPlanner();
    const spec = planner.plan(draft);

    expect(spec.testCases).toHaveLength(1);
    // The second step (targeting danger-delete-btn) should have been filtered out
    expect(spec.testCases[0].steps).toHaveLength(1);
    expect(spec.testCases[0].steps[0].name).toBe('Inspect Page');
  });
});

describe('Answers to the plan review’s questions change what runs', () => {
  const invoiceFlow = (id: string): DiscoveredFlow => ({
    id,
    name: 'Create invoice',
    role: 'manager',
    description: 'Send an invoice',
    startPage: '/invoices/new',
    steps: [
      { action: 'fill', selector: '#amount', value: '10', name: 'Amount' },
      { action: 'click', selector: '[data-testid="save-btn"]', name: 'Save' },
    ],
    candidateExpectations: { origin: 'ai-guess', text: { contains: 'Invoice created' } },
    needsTestCopy: true,
  });
  const draftWith = (answer: string | undefined, extra: Partial<DiscoveryDraft> = {}): DiscoveryDraft => {
    const q = formQuestion(
      {
        urlPath: '/invoices/new',
        submitButtonSelector: '[data-testid="save-btn"]',
        inputs: [{ label: 'Customer' }, { label: 'Amount' }],
      },
      1
    );
    return {
      version: '1.0',
      productId: 'p',
      targetUrl: 'http://localhost:3000',
      timestamp: '',
      pages: [{ urlPath: '/invoices/new', title: 'New invoice', interactiveElementsCount: 3, formsCount: 1 }],
      flows: [invoiceFlow('FLOW-1')],
      sensitiveActions: [],
      ambiguityQuestions: [{ ...q, selectedAnswer: answer }],
      ...extra,
    };
  };

  it('asks in plain words, with a safe answer that sends nothing new', () => {
    const [q] = draftWith(undefined).ambiguityQuestions;
    expect(q.question).toBe(
      'What should happen after someone fills in the form on /invoices/new (Customer and Amount) and sends it?'
    );
    applySafeAnswers([q]);
    expect(q.selectedAnswer).toBe(FORM_ANSWERS.noBreak);
  });

  it('“Just check nothing breaks” keeps the AI’s guess as a guess', () => {
    const [tc] = new TestPlanner().plan(draftWith(FORM_ANSWERS.noBreak)).testCases;
    expect(tc.expectations).toEqual({ origin: 'ai-guess', text: { contains: 'Invoice created' } });
  });

  it('a confirmation page or success message becomes the user’s own check', () => {
    expect(new TestPlanner().plan(draftWith(FORM_ANSWERS.confirmationPage)).testCases[0].expectations).toMatchObject({
      origin: 'user',
      navigatesAway: { fromPath: '/invoices/new' },
    });
    expect(new TestPlanner().plan(draftWith(FORM_ANSWERS.successMessage)).testCases[0].expectations).toMatchObject({
      origin: 'user',
      successMessage: {},
    });
  });

  it('“Don’t test this form” leaves out the journeys that send it', () => {
    expect(new TestPlanner().plan(draftWith(FORM_ANSWERS.exclude)).testCases).toEqual([]);
  });

  it('on a live site a journey that needs a test copy is kept out of the run', () => {
    expect(new TestPlanner().plan(draftWith(undefined), { readOnly: true }).testCases).toEqual([]);
    expect(new TestPlanner().plan(draftWith(undefined)).testCases).toHaveLength(1);
  });

  it('never falls back to the first option for a question with no safe answer recorded', () => {
    const old = {
      id: 'Q',
      urlPath: '/',
      question: '?',
      options: ['Expect navigation', 'Expect banner'],
      category: 'untested_form' as const,
    };
    applySafeAnswers([old]);
    expect(old).not.toHaveProperty('selectedAnswer');
  });
});
