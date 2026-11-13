import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReviewPlan } from '@qa/types';
import { PlanSideRail, planSectionNavItems } from '../src/screens/PlanReviewScreen';

const src = readFileSync(resolve(__dirname, '../src/screens/PlanReviewScreen.tsx'), 'utf8');

const samplePlan: ReviewPlan = {
  targetUrl: 'https://example.com',
  pages: [{ urlPath: '/', title: 'Home', kind: 'normal' }],
  planPages: [
    {
      id: 'p1',
      urlPath: '/',
      title: 'Home',
      coverage: 'sampled',
      tests: [{ id: 't1', name: 'Check home', startPage: '/' }],
    },
  ],
  questions: [{ id: 'q1', question: 'Run checkout tests?', urlPath: '/checkout', defaultAnswer: 'no' }],
  navigation: [{ id: 'n1', name: 'Pricing link', startPage: '/', to: '/pricing' }],
  flows: [{ id: 'f1', name: 'Sign up flow', steps: [] }],
  gradedChecks: [{ id: 'c1', name: 'Accessibility', description: 'WCAG 2.2 AA' }],
  wontRun: [{ what: 'Admin panel', reason: 'Behind a sign-in' }],
  rolesNotTested: [{ role: 'admin', text: 'No credentials' }],
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
