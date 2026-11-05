import { describe, it, expect } from 'vitest';
import type { Finding } from '@qa/types';
import { UXQualityChecker } from '../src/ux-quality.js';

const f = (id: string, urlPath: string, selector = 'header > a'): Finding =>
  ({
    id,
    severity: 'Major',
    checker: 'ux-quality',
    title: 'WCAG Violation: color-contrast',
    where: { urlPath, role: 'shopper', breakpoint: '1440px', cssSelector: selector },
    expectedVsActual: { expected: 'contrast >= 4.5', actual: '2.1' },
    stepsToReproduce: [],
    evidence: {},
    resolution: '',
  }) as Finding;

describe('UX findings are deduplicated per normalized route (C7)', () => {
  const checker = new UXQualityChecker();

  it('the same route with different query noise is one finding', () => {
    const out = checker.deduplicateFindings([f('a', '/checkout?utm=1'), f('b', '/Checkout/')]);
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('the same element on different routes stays distinct', () => {
    const out = checker.deduplicateFindings([f('a', '/checkout'), f('b', '/invoices')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('the same route with a different element stays distinct', () => {
    const out = checker.deduplicateFindings([f('a', '/checkout?x=1', 'nav > a'), f('b', '/checkout', 'header > a')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
