import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReviewPlan } from '@qa/types';
import { PlanSideRail, planSectionNavItems } from '../src/screens/PlanReviewScreen';

const src = readFileSync(resolve(__dirname, '../src/screens/PlanReviewScreen.tsx'), 'utf8');

const samplePlan: ReviewPlan = {
  runId: 'run-1',
  targetUrl: 'https://example.com',
  discoveredAt: '2026-11-01T00:00:00.000Z',
  pages: [{ urlPath: '/', title: 'Home', interactiveElementsCount: 0, formsCount: 0 }],
  planPages: [
    {
      id: 'p1',
      urlPath: '/',
      title: 'Home',
      coverage: 'sample',
      reachedBy: ['visitor'],
      source: 'ai',
      tests: [{ id: 't1', name: 'Check home', role: 'visitor', steps: [], source: 'ai' }],
    },
  ],
  questions: [
    {
      id: 'q1',
      urlPath: '/checkout',
      question: 'Run checkout tests?',
      options: ['Yes', 'No'],
      category: 'untested_form',
    },
  ],
  navigation: [
    {
      id: 'n1',
      name: 'Pricing link',
      startPage: '/',
      linkName: 'Pricing',
      selector: 'a[href="/pricing"]',
      to: '/pricing',
      roles: ['visitor'],
      source: 'ai',
    },
  ],
  flows: [{ id: 'f1', name: 'Sign up flow', role: 'visitor', description: 'Sign up', startPage: '/', steps: [] }],
  gradedChecks: [{ id: 'c1', name: 'Accessibility', description: 'WCAG 2.2 AA' }],
  wontRun: [{ what: 'Admin panel', reason: 'Behind a sign-in' }],
  rolesNotTested: [{ role: 'admin', reason: 'wrong-details', text: 'No credentials' }],
  notFound: [],
};

describe('Plan Review approve', () => {
  it('never calls onApprove straight from a button: it goes through approve(), which saves switches first', () => {
    expect(src).not.toMatch(/onClick=\{\(\) => onApprove\(\)\}/);
    expect(src).not.toMatch(/onSubmit=\{\(roles\) => onApprove\(roles\)\}/);
    expect(src).toMatch(/if \(!\(await flushToggles\(\)\)\) return;\s*onApprove\(roles\);/);
  });
});

describe('Plan Review side rail (Issue A)', () => {
  it('includes sections in planSectionNavItems', () => {
    const items = planSectionNavItems(samplePlan);
    const ids = items.map((i) => i.id);
    expect(ids).toContain('plan-questions');
    expect(ids).toContain('plan-summary');
    expect(ids).toContain('plan-finder');
    expect(ids).toContain('plan-pages');
    expect(ids).toContain('plan-navigation');
    expect(ids).toContain('plan-journeys');
    expect(ids).toContain('plan-checks');
    expect(ids).toContain('plan-wontrun');
    expect(ids).toContain('plan-roles-not-tested');
    expect(ids).toContain('plan-docs');
  });

  it('renders sticky desktop side rail hidden on mobile/tablet and visible on lg', () => {
    const html = renderToStaticMarkup(createElement(PlanSideRail, { plan: samplePlan }));
    expect(html).toContain('aria-label="Plan sections"');
    expect(html).toContain('hidden lg:block');
    expect(html).toContain('lg:sticky');
    expect(html).toContain('Needs your answer');
    expect(html).toContain('What approving runs');
    expect(html).toContain('Find in the plan');
    expect(html).toContain('Checks');
  });
});
