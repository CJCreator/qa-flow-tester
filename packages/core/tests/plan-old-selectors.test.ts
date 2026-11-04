import { describe, it, expect } from 'vitest';
import type { ReviewPlan } from '@qa/types';
import { expandValidationTestCases } from '../src/validator-expander.js';
import { planToPlaywrightProject } from '../src/plan/playwright-export.js';

// A plan saved before selectorReason existed: CSS steps, no reason.
const saved = JSON.stringify({
  runId: 'old',
  targetUrl: 'https://shop.example/',
  discoveredAt: '2026-01-01T00:00:00Z',
  pages: [],
  flows: [],
  questions: [],
  testCases: [
    {
      id: 'TC-1',
      flowId: 'j',
      name: 'Old',
      role: 'visitor',
      startPage: '/',
      kind: 'journey',
      steps: [
        { action: 'click', selector: 'div.card > a.buy', name: 'Buy' },
        { action: 'fill', selector: '#email', value: 'a@b.c', name: 'Email' },
      ],
      expectations: {},
    },
  ],
});

describe('old plans without selectorReason', () => {
  it('load, expand and export unchanged', () => {
    const plan = JSON.parse(saved) as ReviewPlan;
    expect(plan.testCases).toBeDefined();
    const testCases = plan.testCases ?? [];
    expect(expandValidationTestCases(testCases)).toEqual(testCases);
    expect(testCases[0]!.steps.every((s) => s.selectorReason === undefined)).toBe(true);
    const files = planToPlaywrightProject(plan);
    const spec = files.map((f) => f.content).join('\n');
    expect(spec).toContain('(await sel(page, "div.card > a.buy")).click();');
    expect(spec).toContain('(await sel(page, "#email")).fill("a@b.c");');
    expect(spec).not.toContain('reason for CSS');
  });
});
