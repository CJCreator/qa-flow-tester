/** AC10: on a live site, Denial items that would try a working control are listed as "won't run, and why". */
import { describe, it, expect } from 'vitest';
import type { PlanPage, PlanPageTest } from '@qa/types';
import { deriveDenials } from '../src/plan/sources.js';
import { expandPlan } from '../src/plan/expand.js';
import { SafetyFilter } from '../src/discovery/safety-filter.js';

const source: PlanPageTest = {
  id: 'pagetest:/users:1',
  name: 'Admin creates a user',
  role: 'Admin',
  steps: [{ action: 'click', selector: '#create', name: 'Create user' }],
  docSource: { document: 'spec.md', requirementId: 'REQ-1' },
  source: 'ai',
};

function planPage(tests: PlanPageTest[]): PlanPage {
  return {
    id: 'page:/users',
    urlPath: '/users',
    title: 'Users',
    coverage: 'tested',
    reachedBy: ['Admin', 'Viewer'],
    tests,
    source: 'ai',
  } as PlanPage;
}
const binding = new Map([['REQ-1', { roles: ['Admin'], deniedRoles: ['Viewer'] }]]);

function expand(readOnly: boolean, shown: boolean) {
  const page = planPage([source]);
  for (const d of deriveDenials([page], binding, { controlShownTo: () => shown })) page.tests.push(d.test);
  return expandPlan(
    { version: '1.0', productId: 'p', targetUrl: 'https://app.example/', timestamp: '2026-09-30T00:00:00Z', pages: [], flows: [], sensitiveActions: [], ambiguityQuestions: [], plan: { pages: [page], navigation: [], layoutGroups: [], otherHosts: [] } } as any,
    { readOnly, screenSizes: [] }
  );
}

describe('Denial items and the live-site rule', () => {
  it('control still shown to the denied role: needs a Test Copy, so it is in wontRun on a live site', () => {
    const out = expand(true, true);
    expect(out.wontRun.some((w) => w.what.includes('Viewer cannot') && w.reason.length > 0)).toBe(true);
    expect(out.testCases.some((c) => c.name.startsWith('Viewer cannot'))).toBe(false);
  });

  it('control hidden from the denied role: the check runs even on a live site', () => {
    const out = expand(true, false);
    expect(out.testCases.some((c) => c.name.startsWith('Viewer cannot'))).toBe(true);
  });

  it('a Test Copy runs it', () => {
    const out = expand(false, true);
    expect(out.testCases.some((c) => c.name.startsWith('Viewer cannot'))).toBe(true);
  });

  it('a sensitive control (Delete) always needs a Test Copy for its Denial item', () => {
    const del: PlanPageTest = { ...source, steps: [{ action: 'click', selector: '#del', name: 'Delete user' }] };
    const page = planPage([del]);
    const [d] = deriveDenials([page], binding, { safety: new SafetyFilter() });
    expect(d.test.needsTestCopy).toBe(true);
  });
});
