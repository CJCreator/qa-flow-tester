import { describe, it, expect } from 'vitest';
import { generateRankedRecommendations } from '../src/recommendations.js';
import type { Finding } from '@qa/types';

describe('Ranked Recommendations (recommendations.ts)', () => {
  const sampleFindings: Finding[] = [
    {
      id: 'F-001',
      title: 'Missing Content-Security-Policy header',
      severity: 'Major',
      checker: 'security',
      where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: 'Set CSP', actual: 'No CSP header present' },
      stepsToReproduce: [],
      evidence: {},
      resolution: "Add Content-Security-Policy: default-src 'self'",
    },
    {
      id: 'F-002',
      title: 'Content overflows the screen horizontally at 375px',
      severity: 'Major',
      checker: 'performance',
      where: { urlPath: '/products', role: 'visitor', breakpoint: '375px' },
      expectedVsActual: { expected: 'No overflow', actual: 'Horizontal scroll bar visible' },
      stepsToReproduce: [],
      evidence: {},
      resolution: 'Use max-width: 100% on container elements',
    },
    {
      id: 'F-003',
      title: '<html> element is missing a lang attribute',
      severity: 'Minor',
      checker: 'seo',
      where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: 'lang attribute present', actual: 'No lang attribute' },
      stepsToReproduce: [],
      evidence: {},
      resolution: 'Add lang="en" to <html>',
    },
  ];

  it('splits recommendations into quick-win and bigger-change categories', () => {
    const recs = generateRankedRecommendations(sampleFindings);
    expect(recs.length).toBeGreaterThan(0);

    const quickWins = recs.filter((r) => r.category === 'quick-win');
    const biggerChanges = recs.filter((r) => r.category === 'bigger-change');

    expect(
      quickWins.some((r) => r.title.includes('lang attribute') || r.title.includes('Content-Security-Policy'))
    ).toBe(true);
    expect(biggerChanges.some((r) => r.title.includes('overflows the screen'))).toBe(true);
  });

  it('produces identical ranking order across runs', () => {
    const run1 = generateRankedRecommendations(sampleFindings);
    const run2 = generateRankedRecommendations(sampleFindings);

    expect(run1.map((r) => r.title)).toEqual(run2.map((r) => r.title));
  });

  it('links each recommendation to its finding IDs', () => {
    const recs = generateRankedRecommendations(sampleFindings);
    for (const rec of recs) {
      expect(rec.findingIds.length).toBeGreaterThan(0);
      expect(rec.affectedPages.length).toBeGreaterThan(0);
    }
  });
});
