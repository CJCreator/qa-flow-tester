/** Plan.intentsOff in expandPlan: tests of a switched-off Intent move to wontRun, not the run. */
import { describe, it, expect } from 'vitest';
import { expandPlan } from '../src/plan/expand.js';

const test = (id: string, intent?: 'rejects' | 'limits') => ({
  id,
  name: `Test ${id}`,
  role: 'visitor',
  steps: [{ action: 'wait', name: 'Look' }],
  source: 'ai',
  ...(intent ? { intent } : {}),
});

function draft(intentsOff?: string[]) {
  return {
    version: '1.0',
    productId: 'p',
    targetUrl: 'https://app.example/',
    timestamp: '2026-09-30T00:00:00Z',
    pages: [],
    flows: [],
    sensitiveActions: [],
    ambiguityQuestions: [],
    plan: {
      pages: [
        {
          id: 'pg-1',
          urlPath: '/form',
          title: 'Form',
          coverage: 'tested',
          reachedBy: ['visitor'],
          source: 'ai',
          tests: [test('t-plain'), test('t-rej', 'rejects'), test('t-lim', 'limits')],
        },
      ],
      navigation: [],
      layoutGroups: [],
      otherHosts: [],
      ...(intentsOff ? { intentsOff } : {}),
    },
  } as any;
}

describe('expandPlan intentsOff', () => {
  it('runs every test when no Intent is off', () => {
    const out = expandPlan(draft(), { readOnly: false, screenSizes: ['1440px'] });
    expect(out.testCases.filter((c) => c.kind === 'page-test')).toHaveLength(3);
    expect(out.wontRun).toHaveLength(0);
  });

  it('moves tests of an off Intent to wontRun as switched off, and keeps the rest', () => {
    const out = expandPlan(draft(['rejects']), { readOnly: false, screenSizes: ['1440px'] });
    const ran = out.testCases.filter((c) => c.kind === 'page-test').map((c) => c.planItemId);
    expect(ran).toEqual(['t-plain', 't-lim']);
    expect(out.wontRun).toEqual([
      { itemId: 't-rej', what: '/form: Test t-rej', reason: 'Switched off in the review.' },
    ]);
    expect(out.summary.intents).toBeDefined();
    expect(out.summary.intents?.rejects.tests).toBe(0);
    expect(out.summary.intents?.limits.tests).toBeGreaterThan(0);
  });
});
