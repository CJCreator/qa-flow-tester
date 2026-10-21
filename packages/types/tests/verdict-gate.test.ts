import { describe, it, expect } from 'vitest';
import { DEFAULT_RELEASE_GATES, releaseVerdict } from '../src/verdict.js';
import type { Finding, SiteAspectGrades, AspectGrade } from '../src/index.js';

const finding = (id: string, severity: Finding['severity'], title = `Problem ${id}`) => ({
  id,
  severity,
  title,
  checker: 'bug-detection' as const,
});

const grades = (worst: AspectGrade | null): SiteAspectGrades => {
  const ok = { grade: 'A' as AspectGrade | null, score: 100, findings: [] as string[] };
  return {
    aspects: {
      Works:
        worst === null ? { grade: null, score: 0, findings: [], checked: false } : { ...ok, grade: worst, score: 70 },
      Accessible: ok,
      'Fast and mobile': ok,
      Findable: ok,
      Secure: ok,
      'Looks and reads well': ok,
    },
    overallGrade: worst ?? 'A',
    overallScore: 90,
  };
};

describe('releaseVerdict gate matrix', () => {
  it('standard is the default and fails on a Blocker', () => {
    const v = releaseVerdict([finding('1', 'Blocker')]);
    expect(v.ready).toBe(false);
    expect(v.stamp).toBe('Not ready yet');
    expect(releaseVerdict([finding('1', 'Blocker')], DEFAULT_RELEASE_GATES.standard).ready).toBe(false);
  });

  it('one Major with every area at C or better does not fail Standard', () => {
    expect(releaseVerdict([finding('1', 'Major')], undefined, grades('C')).ready).toBe(true);
    expect(releaseVerdict([finding('1', 'Major')]).ready).toBe(true);
  });

  it('an area graded D fails Standard even with no problems', () => {
    const v = releaseVerdict([], undefined, grades('D'));
    expect(v.ready).toBe(false);
    expect(v.breaches?.[0]).toContain('Works grade is D');
  });

  it('strict fails on a Major, lenient only on a Blocker', () => {
    const major = [finding('1', 'Major')];
    expect(releaseVerdict(major, DEFAULT_RELEASE_GATES.strict).ready).toBe(false);
    expect(releaseVerdict(major, DEFAULT_RELEASE_GATES.lenient).ready).toBe(true);
    expect(releaseVerdict([finding('2', 'Blocker')], DEFAULT_RELEASE_GATES.lenient).ready).toBe(false);
    expect(releaseVerdict([], DEFAULT_RELEASE_GATES.strict, grades('C')).ready).toBe(false);
  });

  it('an area nothing checked is listed, never counted as a pass or a failure', () => {
    // T-47: standard now requires every area checked (enforceAllAreas); lenient only lists it.
    expect(releaseVerdict([], undefined, grades(null), { skipped: 2, blocked: 1 }).ready).toBe(false);
    const v = releaseVerdict([], DEFAULT_RELEASE_GATES.lenient, grades(null), { skipped: 2, blocked: 1 });
    expect(v.ready).toBe(true);
    expect(v.notChecked).toEqual(['Works']);
    expect(v.skippedTests).toBe(3);
    expect(v.reason).toContain('1 area not checked');
    expect(v.reason).toContain('3 tests did not run');
  });

  it('adds nothing to the reason when everything ran', () => {
    const v = releaseVerdict([], undefined, grades('A'), { skipped: 0, blocked: 0 });
    expect(v.reason).toBe('No problems found.');
    expect(v.notChecked).toBeUndefined();
  });
});
