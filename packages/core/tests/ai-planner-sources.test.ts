/** Sources in the AI Planner (ADR 0020): role binding, Denial Plan Items, Not found in app. No browser. */
import { describe, it, expect } from 'vitest';
import type { AIMessage, AICompletionOptions, AIProviderType, ElementInventoryItem, PageInventoryItem } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { buildSiteGraph } from '../src/plan/site-graph.js';
import { sampleLayoutGroups } from '../src/plan/sampling.js';
import { planPagesAndMenus, estimatePageRequests, type PagePlannerInput } from '../src/plan/ai-planner.js';
import { readBinding, deriveDenials, deriveNotFound, documentedItems } from '../src/plan/sources.js';
import type { ParsedRequirementHint } from '../src/discovery/context-parser.js';
import { expandPlan } from '../src/plan/expand.js';
import { SafetyFilter } from '../src/discovery/safety-filter.js';

const el = (name: string, selector: string): ElementInventoryItem => ({
  role: 'button',
  name,
  selector,
  tagName: 'button',
  visible: true,
  enabled: true,
});

const users: PageInventoryItem = {
  urlPath: '/users',
  title: 'Users',
  interactiveElementsCount: 2,
  formsCount: 0,
  elements: [el('Create user', '[data-testid="create-user"]'), el('Delete user', '[data-testid="delete-user"]')],
  reachedBy: ['Admin', 'Viewer'],
  links: [],
  layoutGroup: 'a',
};

const reqs: ParsedRequirementHint[] = [
  { id: 'REQ-1', name: 'Create user', description: 'Only Admin can create users', rules: [], document: 'spec.md', section: 'Users' },
  { id: 'REQ-2', name: 'Export invoices', description: 'Admin can export invoices', rules: [], document: 'spec.md', section: 'Billing' },
];

class Scripted implements AIProvider {
  readonly providerType: AIProviderType = 'mock';
  readonly prompts: string[] = [];
  constructor(
    private bind: string,
    private test: object = {
      name: 'Admin creates a user',
      steps: [{ action: 'click', selector: '[data-testid="create-user"]', name: 'Press Create user' }],
      expect: {},
      requirementId: 'REQ-1',
    }
  ) {}
  async generateText(messages: AIMessage[], _o?: AICompletionOptions): Promise<string> {
    const prompt = messages.map((m) => m.content).join('\n');
    this.prompts.push(prompt);
    if (prompt.includes('Requirements:\n')) return this.bind;
    if (prompt.includes('Pages:\n')) return JSON.stringify({ pages: [{ urlPath: '/users', tests: [this.test] }] });
    return '{}';
  }
}

function input(extra: Partial<PagePlannerInput> = {}): PagePlannerInput {
  const pages = [users];
  return {
    pages,
    forms: [],
    coverage: sampleLayoutGroups(pages).coverage,
    graph: buildSiteGraph(pages, '/users'),
    targetUrl: 'https://app.example/',
    siteType: 'app',
    readOnly: false,
    redact: (t) => t,
    requirements: reqs,
    roles: ['Admin', 'Viewer'],
    ...extra,
  };
}

const goodBind = JSON.stringify({
  requirements: [
    { id: 'REQ-1', roles: ['Admin'], deniedRoles: ['Viewer'] },
    { id: 'REQ-2', roles: ['Admin'], deniedRoles: [] },
  ],
});

describe('Sources in the planner', () => {
  it('AC1: carries the Source and proposed roles, unconfirmed', async () => {
    const out = await planPagesAndMenus(input(), new Scripted(goodBind));
    const t = out.pages[0].tests.find((x) => x.kind !== 'denial')!;
    expect(t.docSource).toEqual({ document: 'spec.md', section: 'Users', requirementId: 'REQ-1' });
    expect(t.proposedRoles).toEqual(['Admin']);
    expect(t.rolesConfirmed).toBe(false);
  });

  it('AC2: an admin-only action gets a Denial item for Viewer under the same Source, asserting hidden', async () => {
    const out = await planPagesAndMenus(input(), new Scripted(goodBind));
    const denial = out.pages[0].tests.find((x) => x.kind === 'denial')!;
    expect(denial.role).toBe('Viewer');
    expect(denial.docSource?.requirementId).toBe('REQ-1');
    expect(denial.expectations?.elementState).toEqual({ selector: '[data-testid="create-user"]', visible: false });
    expect(out.pages[0].tests.filter((x) => x.kind === 'denial')).toHaveLength(1);
  });

  it('AC3: a requirement with no matching test is Not found with a reason, not a failure, not a test', async () => {
    const out = await planPagesAndMenus(input(), new Scripted(goodBind));
    expect(out.notFound).toHaveLength(1);
    expect(out.notFound![0]).toMatchObject({
      docSource: { requirementId: 'REQ-2', document: 'spec.md' },
      reason: 'No page or control matching “Export invoices” was found as Admin',
    });
    expect(out.documentedItems).toEqual({ reached: 1, total: 2 });
    const draft = { version: '1.0', productId: 'p', targetUrl: 'https://app.example/', timestamp: '2026-09-30T00:00:00Z', pages: [], flows: [], sensitiveActions: [], ambiguityQuestions: [], plan: { pages: out.pages, navigation: out.navigation, layoutGroups: [], otherHosts: [] } } as any;
    const expanded = expandPlan(draft, { readOnly: false, screenSizes: [] });
    expect(expanded.testCases.some((c) => c.name.includes('Export invoices'))).toBe(false);
    expect(expanded.wontRun.some((w) => w.what.includes('Export invoices'))).toBe(false);
  });

  it('sends role names and requirements to the AI', async () => {
    const ai = new Scripted(goodBind);
    await planPagesAndMenus(input(), ai);
    expect(ai.prompts[0]).toContain('["Admin","Viewer"]');
    expect(ai.prompts[0]).toContain('REQ-1');
    expect(estimatePageRequests(input())).toBe(2);
  });

  it('unusable role answer (invalid JSON) -> every role allowed, no invented Denial', async () => {
    const out = await planPagesAndMenus(input(), new Scripted('not json'));
    expect(out.pages[0].tests.some((x) => x.kind === 'denial')).toBe(false);
    expect(out.pages[0].tests[0].proposedRoles).toEqual(['Admin', 'Viewer']);
    expect(out.notes.join(' ')).toContain('every role is allowed');
  });

  it('unknown ids and roles are dropped; ambiguous entries fall back', () => {
    const { binding } = readBinding(
      {
        requirements: [
          { id: 'NOPE', roles: ['Admin'], deniedRoles: ['Viewer'] },
          { id: 'REQ-1', roles: ['Admin', 'Ghost'], deniedRoles: ['Viewer', 'Ghost'] },
          { id: 'REQ-2', roles: ['Admin'], deniedRoles: ['Admin'] },
        ],
      },
      reqs,
      ['Admin', 'Viewer']
    );
    expect(binding.has('NOPE')).toBe(false);
    expect(binding.get('REQ-1')).toEqual({ roles: ['Admin'], deniedRoles: ['Viewer'] });
    expect(binding.get('REQ-2')).toEqual({ roles: ['Admin', 'Viewer'], deniedRoles: [] });
  });

  it('a test naming an unknown requirement keeps no Source', async () => {
    const ai = new Scripted(goodBind, {
      name: 'Opens create',
      steps: [{ action: 'click', selector: '[data-testid="create-user"]' }],
      expect: {},
      requirementId: 'REQ-99',
    });
    const out = await planPagesAndMenus(input(), ai);
    expect(out.pages[0].tests[0].docSource).toBeUndefined();
  });

  it('no AI: nothing is listed as Not found and no Denial is invented', async () => {
    const out = await planPagesAndMenus(input(), undefined);
    expect(out.notFound).toBeUndefined();
    expect(out.pages[0].tests.some((x) => x.kind === 'denial')).toBe(false);
  });

  it('safety: an AI step on "Delete user" is dropped even when a Denial would follow', async () => {
    const ai = new Scripted(goodBind, {
      name: 'Admin deletes a user',
      steps: [{ action: 'click', selector: '[data-testid="delete-user"]', name: 'Press Delete user' }],
      expect: {},
      requirementId: 'REQ-1',
    });
    const out = await planPagesAndMenus(input(), ai);
    const tests = out.pages[0].tests;
    expect(tests.some((t) => t.steps.some((st) => st.selector === '[data-testid="delete-user"]'))).toBe(false);
    expect(tests.some((t) => t.docSource || t.kind === 'denial')).toBe(false);
  });

  it('pure helpers: denial needs an allowed-role test; documentedItems clamps', () => {
    const page: any = { urlPath: '/x', reachedBy: ['Viewer'], tests: [] };
    const binding = new Map([['REQ-1', { roles: ['Admin'], deniedRoles: ['Viewer'] }]]);
    page.tests.push({
      id: 't1',
      name: 'n',
      role: 'Viewer',
      steps: [{ action: 'click', selector: '#a' }],
      docSource: { document: 'd', requirementId: 'REQ-1' },
      source: 'ai',
    });
    expect(deriveDenials([page], binding, { safety: new SafetyFilter() })).toHaveLength(0);
    expect(deriveNotFound([], [page], binding)).toEqual([]);
    expect(documentedItems(2, 5)).toEqual({ reached: 2, total: 2 });
  });
});
