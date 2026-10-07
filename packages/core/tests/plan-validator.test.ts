import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import type { AIMessage, AICompletionOptions, AIProviderType, DiscoveredFlow, PageInventoryItem } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { PlanValidator } from '../src/discovery/plan-validator.js';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';
import { TestPlanner } from '../src/discovery/test-planner.js';
import { server } from '../../../fixtures/test-app/server.js';

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

/** Scripts the journey requests; the page and menu planner gets an empty answer and falls back to fixed rules. */
class ScriptedAIProvider implements AIProvider {
  readonly providerType: AIProviderType = 'mock';
  /** Journey prompts, in order. */
  readonly prompts: string[] = [];
  /** Every prompt, the page and menu planner's included. */
  readonly allPrompts: string[] = [];
  constructor(private responses: string[]) {}
  async generateText(messages: AIMessage[], _options?: AICompletionOptions): Promise<string> {
    const prompt = messages.map((m) => m.content).join('\n');
    this.allPrompts.push(prompt);
    if (!prompt.includes('synthesizing application flows')) return '{}';
    this.prompts.push(prompt);
    return this.responses[Math.min(this.prompts.length - 1, this.responses.length - 1)];
  }
}

const invented = JSON.stringify({
  flows: [
    {
      id: 'FLOW-DASH',
      name: 'Dashboard buttons',
      role: 'manager',
      description: 'Use the dashboard',
      startPage: '/dashboard',
      steps: [
        {
          action: 'click',
          selector: '[data-testid="dashboard-element-1"]',
          name: 'Interact with first dashboard element',
        },
      ],
    },
  ],
});

const repaired = JSON.stringify({
  flows: [
    {
      id: 'FLOW-DASH',
      name: 'Dashboard buttons',
      role: 'manager',
      description: 'Use the dashboard',
      startPage: '/dashboard',
      steps: [{ action: 'click', selector: '[data-testid="trigger-error-btn"]', name: 'Trigger Console Error' }],
    },
  ],
});

describe('Discovery grounds the AI plan in the real page', () => {
  const PORT = 3502;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-plan-validator');

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('shows the AI the real elements, and repairs an invented step with them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ai = new ScriptedAIProvider([invented, repaired]);
    const draft = await new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'fixture',
      outputDir: path.join(outputDir, 'repaired'),
      aiProvider: ai,
    });
    warn.mockRestore();

    expect(ai.prompts[0]).toContain('button "Trigger Console Error" → selector: [data-testid="trigger-error-btn"]');
    expect(ai.prompts).toHaveLength(2);
    expect(ai.prompts[1]).toContain('dashboard-element-1');
    expect(draft.flows[0].steps[0].selector).toBe('[data-testid="trigger-error-btn"]');
    expect(draft.flows[0].needsHelp).toBeUndefined();
    // Kept with the draft, so edits made in the plan review are checked against them too.
    expect(draft.forms?.find((f) => f.urlPath === '/invoices/new')?.inputs.length).toBeGreaterThan(0);
  }, 60000);

  it('never runs a step that is still invented after the repair, and asks about it instead', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ai = new ScriptedAIProvider([invented, invented]);
    const draft = await new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'fixture',
      outputDir: path.join(outputDir, 'still-invented'),
      aiProvider: ai,
    });
    warn.mockRestore();

    expect(draft.flows[0].needsHelp?.[0]).toContain('dashboard-element-1');
    expect(
      draft.ambiguityQuestions.some((q) => q.category === 'unverified_step' && q.question.includes('Dashboard buttons'))
    ).toBe(true);
    expect(new TestPlanner().plan(draft).testCases).toEqual([]);
  }, 60000);

  it('does not send test passwords to the AI', async () => {
    const ai = new ScriptedAIProvider([repaired]);
    await new DiscoveryAgent().discover({
      targetUrl: baseUrl,
      productId: 'fixture',
      outputDir: path.join(outputDir, 'no-passwords'),
      aiProvider: ai,
      profile: {
        name: 'Fixture',
        productId: 'fixture',
        roles: [
          { role: 'manager', username: 'manager@example.com', password: 'manager-password', loginPath: '/login' },
        ],
      },
    });
    expect(ai.allPrompts.join('\n')).not.toContain('manager-password');
  }, 60000);
});
