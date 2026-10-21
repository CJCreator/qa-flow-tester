import { describe, it, expect } from 'vitest';
import { DEFAULT_RELEASE_GATES, nothingWasChecked, releaseVerdict } from '../src/verdict.js';
import type { AspectGrade, AspectType, Finding, SiteAspectGrades } from '../src/index.js';

const ASPECTS: AspectType[] = [
  'Works',
  'Accessible',
  'Fast and mobile',
  'Findable',
  'Secure',
  'Looks and reads well',
];

const finding = (id: string, severity: Finding['severity']) => ({
  id,
  severity,
  title: `Problem ${id}`,
  checker: 'bug-detection' as const,
});

/** Every area at `grade`, except the ones listed as unchecked. */
const areaGrades = (grade: AspectGrade, unchecked: AspectType[] = []): SiteAspectGrades => {
  const aspects = Object.fromEntries(
    ASPECTS.map((a) =>
      unchecked.includes(a)
        ? [a, { grade: null, score: 0, findings: [], checked: false }]
        : [a, { grade, score: grade === 'A' ? 95 : 70, findings: [] }]
    )
  ) as SiteAspectGrades['aspects'];
  return { aspects, overallGrade: grade, overallScore: 90 };
};

const allUnchecked = (): SiteAspectGrades => areaGrades('A', ASPECTS);

describe('T-47 nothingWasChecked', () => {
  it('is true for no findings and no grades', () => {
    expect(nothingWasChecked([], undefined)).toBe(true);
  });

  it('is true when every area is unchecked', () => {
    expect(nothingWasChecked([], allUnchecked())).toBe(true);
  });

  it('is false when one area was checked', () => {
    expect(nothingWasChecked([], areaGrades('A', ['Secure']))).toBe(false);
  });

  it('is false when there are findings, even with every area unchecked', () => {
    expect(nothingWasChecked([finding('1', 'Minor')], allUnchecked())).toBe(false);
    expect(nothingWasChecked([finding('1', 'Minor')], undefined)).toBe(false);
  });
});

describe('T-47 releaseVerdict with nothing checked', () => {
  it('an empty run with no grades is Not ready yet with "No checks ran"', () => {
    const v = releaseVerdict([], undefined, undefined);
    expect(v.ready).toBe(false);
    expect(v.stamp).toBe('Not ready yet');
    expect(v.reason).toBe('No checks ran.');
    expect(v.reason).not.toContain('No problems found');
  });

  it('an empty run where every area is unchecked is not ready under every gate', () => {
    for (const gate of [DEFAULT_RELEASE_GATES.strict, DEFAULT_RELEASE_GATES.standard, DEFAULT_RELEASE_GATES.lenient]) {
      const v = releaseVerdict([], gate, allUnchecked());
      expect(v.ready).toBe(false);
      expect(v.reason).toBe('No checks ran.');
    }
  });

  it('an empty run with every area checked and at A is ready', () => {
    expect(releaseVerdict([], undefined, areaGrades('A')).ready).toBe(true);
  });
});

describe('T-47 enforceAllAreas is read by releaseVerdict', () => {
  const oneUnchecked = areaGrades('A', ['Secure']);

  it('standard fails when an area was not checked', () => {
    const v = releaseVerdict([], DEFAULT_RELEASE_GATES.standard, oneUnchecked);
    expect(v.ready).toBe(false);
    expect(v.breaches?.[0]).toContain('1 area not checked');
    expect(v.notChecked).toEqual(['Secure']);
  });

  it('strict fails when an area was not checked', () => {
    const v = releaseVerdict([], DEFAULT_RELEASE_GATES.strict, oneUnchecked);
    expect(v.ready).toBe(false);
    expect(v.breaches?.[0]).toContain('1 area not checked');
  });

  it('lenient does not fail on an unchecked area, it only lists it', () => {
    const v = releaseVerdict([], DEFAULT_RELEASE_GATES.lenient, oneUnchecked);
    expect(v.ready).toBe(true);
    expect(v.notChecked).toEqual(['Secure']);
    expect(v.reason).toContain('1 area not checked');
  });

  it('a custom gate without enforceAllAreas lists an unchecked area and passes', () => {
    expect(releaseVerdict([], { maxBlockers: 0 }, oneUnchecked).ready).toBe(true);
  });

  it('a custom gate with enforceAllAreas fails on an unchecked area', () => {
    expect(releaseVerdict([], { maxBlockers: 0, enforceAllAreas: true }, oneUnchecked).ready).toBe(false);
  });

  it('standard still passes when every area was checked and a Major is present', () => {
    expect(releaseVerdict([finding('1', 'Major')], DEFAULT_RELEASE_GATES.standard, areaGrades('C')).ready).toBe(true);
  });
});
