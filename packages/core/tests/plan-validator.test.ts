import { describe, it, expect } from 'vitest';
import type { DiscoveredFlow, PageInventoryItem } from '@qa/types';
import { PlanValidator } from '../src/discovery/plan-validator.js';

const el = (role: string, name: string, selector: string, extra: Record<string, unknown> = {}) => ({
  role,
  name,
  selector,
  tagName: role === 'textbox' ? 'input' : 'button',
  visible: true,
  enabled: true,
  ...extra,
});

const pages: PageInventoryItem[] = [
  {
    urlPath: '/invoices/new',
    title: 'Create Invoice',
    interactiveElementsCount: 3,
    formsCount: 1,
    elements: [
      el('textbox', 'Customer', '[data-testid="customer-field"]', { testId: 'customer-field', id: 'customer' }),
      el('textbox', 'Amount', '[data-testid="amount-field"]', { testId: 'amount-field', id: 'amount' }),
      el('button', 'Save', '[data-testid="save-btn"]', { testId: 'save-btn' }),
    ],
  },
  {
    urlPath: '/dashboard',
    title: 'Dashboard',
    interactiveElementsCount: 1,
    formsCount: 0,
    elements: [
      el('button', 'Trigger Console Error', '[data-testid="trigger-error-btn"]', { testId: 'trigger-error-btn' }),
    ],
  },
];

const flow = (steps: DiscoveredFlow['steps'], startPage = '/invoices/new'): DiscoveredFlow => ({
  id: 'FLOW-T',
  name: 'Test flow',
  role: 'manager',
  description: '',
  startPage,
  steps,
});

describe('PlanValidator', () => {
  const validator = new PlanValidator(pages);

  it('accepts steps written in any of the selector forms the runner understands', () => {
    const issues = validator.checkFlow(
      flow([
        { action: 'fill', selector: '[data-testid=customer-field]', value: 'Acme', name: 'Customer' },
        { action: 'fill', selector: '#amount', value: '10', name: 'Amount' },
        { action: 'click', selector: 'role=button[name="Save"]', name: 'Save' },
        { action: 'navigate', value: '/dashboard', name: 'Go to dashboard' },
        { action: 'click', selector: 'Trigger Console Error', name: 'Trigger error' },
      ])
    );
    expect(issues).toEqual([]);
  });

  it('rejects a step aimed at an element that does not exist, naming it', () => {
    const issues = validator.checkFlow(
      flow(
        [
          {
            action: 'click',
            selector: '[data-testid="dashboard-element-1"]',
            name: 'Interact with first dashboard element',
          },
        ],
        '/dashboard'
      )
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('dashboard-element-1');
    expect(issues[0].message).toContain('/dashboard');
  });

  it('checks a step against its own page until a click may have changed the page', () => {
    // The save button exists, but not on the dashboard, where this flow starts.
    expect(
      validator.checkFlow(flow([{ action: 'click', selector: '[data-testid="save-btn"]', name: 'Save' }], '/dashboard'))
    ).toHaveLength(1);
    // After a click the page is unknown, so any page that was found counts.
    expect(
      validator.checkFlow(
        flow(
          [
            { action: 'click', selector: '[data-testid="trigger-error-btn"]', name: 'Trigger' },
            { action: 'click', selector: '[data-testid="save-btn"]', name: 'Save' },
          ],
          '/dashboard'
        )
      )
    ).toEqual([]);
  });

  it('flags a fill step aimed at a button, and selectors it cannot check', () => {
    const issues = validator.checkFlow(
      flow([
        { action: 'fill', selector: '[data-testid="save-btn"]', value: 'x', name: 'Fill save' },
        { action: 'click', selector: 'form > div:nth-child(3) .btn', name: 'Odd selector' },
      ])
    );
    expect(issues.map((i) => i.stepIndex)).toEqual([0, 1]);
    expect(issues[0].message).toContain('not a field');
  });

  it('clears the "needs your help" mark once a flow has been fixed', () => {
    const fixed: DiscoveredFlow = {
      ...flow([{ action: 'click', selector: '[data-testid="save-btn"]', name: 'Save' }]),
      needsHelp: ['Step "Save" targets [data-testid="gone-btn"], but no such element exists on /invoices/new.'],
    };
    const broken = flow([{ action: 'click', selector: '[data-testid="gone-btn"]', name: 'Save' }]);
    broken.id = 'FLOW-BROKEN';

    validator.markFlowsNeedingHelp([fixed, broken]);
    expect(fixed.needsHelp).toBeUndefined();
    expect(broken.needsHelp?.[0]).toContain('gone-btn');
  });

  it('accepts the form selectors the crawler recorded, which the element list may not name', () => {
    const submit = flow([{ action: 'click', selector: 'button[type="submit"]', name: 'Submit' }]);
    expect(validator.checkFlow(submit)).toHaveLength(1);
    const withForms = new PlanValidator(pages, [
      { urlPath: '/invoices/new', inputs: [], submitButtonSelector: 'button[type="submit"]' },
    ]);
    expect(withForms.checkFlow(submit)).toEqual([]);
  });

  it('checks nothing for drafts recorded before elements were kept', () => {
    const legacy = new PlanValidator([{ urlPath: '/', title: '', interactiveElementsCount: 3, formsCount: 0 }]);
    expect(legacy.canCheck).toBe(false);
    expect(legacy.checkFlow(flow([{ action: 'click', selector: '#anything', name: 'x' }]))).toEqual([]);
  });
});
