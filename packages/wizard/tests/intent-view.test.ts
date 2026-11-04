import { describe, expect, it } from 'vitest';
import type { PlanPageTest } from '@qa/types';
import {
  INTENT_LABELS,
  filterByIntent,
  intentCounts,
  intentSummaryLine,
  openingLine,
  overCapLine,
  wontRunReason,
  withIntentSwitched,
} from '../src/lib/intent-view';
import { EMPTY_FORM, testCapOf } from '../src/lib/form';
import { hasNonDefaultOptions } from '../src/lib/onboarding';

const test = (id: string, intent?: PlanPageTest['intent']): PlanPageTest => ({
  id,
  name: id,
  role: 'visitor',
  steps: [],
  source: 'fallback',
  intent,
});

const summary = {
  tests: 30,
  pages: 3,
  pagesListed: 3,
  screenSizes: ['1440px' as const],
  lines: [],
  intents: {
    works: { items: 2, tests: 6 },
    rejects: { items: 3, tests: 9 },
    limits: { items: 1, tests: 3 },
    denied: { items: 0, tests: 0 },
  },
  overCap: 4,
};

describe('Intent view', () => {
  it('labels the four Intents', () => {
    expect(Object.values(INTENT_LABELS)).toEqual(['Works', 'Rejects', 'Limits', 'Denied']);
  });

  it('counts per Intent from the summary, and from the items without one', () => {
    expect(intentCounts({ summary, planPages: [], flows: [] }).map((c) => [c.label, c.items, c.tests])).toEqual([
      ['Works', 2, 6],
      ['Rejects', 3, 9],
      ['Limits', 1, 3],
      ['Denied', 0, 0],
    ]);
    const counted = intentCounts({
      planPages: [
        {
          id: 'p',
          urlPath: '/',
          title: '',
          coverage: 'tested',
          reachedBy: ['visitor'],
          tests: [test('a', 'rejects'), test('b', 'rejects')],
        } as never,
      ],
      flows: [],
    });
    expect(counted.find((c) => c.intent === 'rejects')?.items).toBe(2);
  });

  it('writes the approval line per Intent and the over-cap line', () => {
    expect(intentSummaryLine({ summary, planPages: [], flows: [] })).toBe(
      'Works 6 Tests · Rejects 9 Tests · Limits 3 Tests'
    );
    expect(overCapLine({ summary, testCap: 50 })).toContain('4 Tests are over the Test cap of 50');
    expect(overCapLine({ summary: { ...summary, overCap: 0 } })).toBeNull();
  });

  it('filters by Intent; an item with no Intent is Works; a legacy Denial reads as Denied', () => {
    const items = [test('w'), test('r', 'rejects'), { ...test('d'), kind: 'denial' }];
    expect(filterByIntent(items, 'works').map((i) => i.id)).toEqual(['w']);
    expect(filterByIntent(items, 'denied').map((i) => i.id)).toEqual(['d']);
    expect(filterByIntent(items, null)).toHaveLength(3);
  });

  it('switching an Intent off sets intentsOff, in Intent order, and back on removes it', () => {
    const off = withIntentSwitched(withIntentSwitched([], 'limits', true), 'rejects', true);
    expect(off).toEqual(['rejects', 'limits']);
    expect(withIntentSwitched(off, 'rejects', false)).toEqual(['limits']);
  });

  it('shows opening steps as "Opens by:"', () => {
    expect(openingLine({})).toBeNull();
    const line = openingLine({
      openingSteps: [{ action: 'click', name: 'Edit', selector: '#edit' }],
    });
    expect(line).toMatch(/^Opens by: /);
  });

  it('words the Test Copy reason with the defined term', () => {
    expect(wontRunReason('Needs a test copy: it sends a form.')).toMatch(/^Needs a Test Copy/);
    expect(wontRunReason('Over the Test cap.')).toBe('Over the Test cap.');
  });

  it('reads the Test cap from the form: blank is the default, clamped to 1..100000', () => {
    expect(testCapOf(EMPTY_FORM)).toBeUndefined();
    expect(testCapOf({ testCap: '500' })).toBe(500);
    expect(testCapOf({ testCap: '999999' })).toBe(100000);
    expect(testCapOf({ testCap: '0' })).toBeUndefined();
    expect(testCapOf({ testCap: 'abc' })).toBeUndefined();
    expect(hasNonDefaultOptions({ ...EMPTY_FORM, testCap: '10' })).toBe(true);
  });
});
