/** The exported expectRefused embeds the Check-up's refusal rule; both must judge the /lab pages the same way (ADR 0024). */
import { describe, it, expect } from 'vitest';
import { CAPTURE_BASELINE_SOURCE, REFUSAL_RULE_SOURCE } from '@qa/checkers';
import type { ReviewPlan, TestCase } from '@qa/types';
import { planToPlaywrightProject } from '../src/plan/playwright-export.js';

const rejectsCase: TestCase = {
  id: 'TC-R1',
  flowId: 'rejects',
  name: 'Sign up rejects an empty name',
  role: 'visitor',
  startPage: '/lab/signup?mode=server',
  steps: [{ action: 'click', selector: 'button[type="submit"]', name: 'Press Sign up' }],
  expectations: {
    refusal: { formPath: '/lab/signup', submitSelector: 'button[type="submit"]', message: 'valid email' },
  },
  kind: 'page-test',
  intent: 'rejects',
};
const plan: ReviewPlan = {
  runId: 'r',
  targetUrl: 'https://shop.example/',
  discoveredAt: '2026-10-01T00:00:00Z',
  pages: [],
  flows: [],
  questions: [],
  testCases: [rejectsCase],
};

function helperSource(name: 'CAPTURE_BASELINE_SOURCE' | 'REFUSAL_RULE_SOURCE'): string {
  const helpers = planToPlaywrightProject(plan).find((f) => f.path === 'support/helpers.ts')!.content;
  const m = helpers.match(new RegExp('const ' + name + ' = String\.raw`([^`]*)`;'));
  if (!m) throw new Error(name + ' not found in support/helpers.ts');
  return m[1]!;
}

describe('expectRefused parity', () => {
  it('the exported helpers embed the rule byte for byte', () => {
    expect(helperSource('REFUSAL_RULE_SOURCE')).toBe(REFUSAL_RULE_SOURCE);
    expect(helperSource('CAPTURE_BASELINE_SOURCE')).toBe(CAPTURE_BASELINE_SOURCE);
  });
});
