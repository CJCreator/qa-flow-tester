import { describe, it, expect } from 'vitest';
import type { Finding } from '@qa/types';
import { ASPECT_CHECKERS, DEFAULT_RELEASE_GATES, releaseVerdict } from '@qa/types';
import { mergeDuplicateFindings } from '../src/finding-groups.js';
import { calculateSiteAspectGrades } from '../src/scoring.js';

const seoFinding = (overrides: Partial<Finding> & { urlPath: string }): Finding => {
  const { urlPath, ...rest } = overrides;
  return {
    id: `F-${urlPath}`,
    title: 'Page is missing a meta description',
    severity: 'Minor',
    checker: 'seo',
    where: { urlPath, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected: '', actual: '' },
    stepsToReproduce: [],
    evidence: {},
    resolution: '',
    testCaseId: `TC-${urlPath}`,
    ...rest,
  };
};

const pages = (n: number) => Array.from({ length: n }, (_, i) => `/page-${i + 1}`);

describe('T-47 one problem across pages counts once', () => {
  it('ten pages with the same Minor merge into one problem on ten pages, Standard gives 93 and grade A', () => {
    const findings = pages(10).map((urlPath) => seoFinding({ urlPath }));
    const merged = mergeDuplicateFindings(findings);

    expect(merged).toHaveLength(1);
    expect(merged[0].seenAt?.pages).toHaveLength(10);
    expect(merged[0].issueKey).not.toContain('/page-');

    const findable = calculateSiteAspectGrades(merged).aspects.Findable;
    expect(findable.score).toBe(93);
    expect(findable.grade).toBe('A');
  });

  it('the same ten Minors without merging also give 93, the key is the title on every page', () => {
    const findings = pages(10).map((urlPath) => seoFinding({ urlPath }));
    const findable = calculateSiteAspectGrades(findings).aspects.Findable;
    expect(findable.score).toBe(93);
    expect(findable.grade).toBe('A');
  });

  it('the verdict reads ten pages with one Minor as Ready to release', () => {
    const findings = pages(10).map((urlPath) => seoFinding({ urlPath }));
    const grades = calculateSiteAspectGrades(mergeDuplicateFindings(findings));
    const verdict = releaseVerdict(mergeDuplicateFindings(findings), undefined, grades);
    expect(verdict.ready).toBe(true);
    expect(verdict.stamp).toBe('Ready to release');
    expect(verdict.total).toBe(1);
  });

  it('two pages with the same Major give one Major problem, and the area grade is B, not capped at C', () => {
    const findings = pages(2).map((urlPath) => seoFinding({ urlPath, severity: 'Major' }));

    const raw = calculateSiteAspectGrades(findings).aspects.Findable;
    expect(raw.score).toBe(75);
    expect(raw.grade).toBe('B');

    const merged = calculateSiteAspectGrades(mergeDuplicateFindings(findings)).aspects.Findable;
    expect(merged.score).toBe(75);
    expect(merged.grade).toBe('B');
  });

  it('a merged element that appears on two pages is one finding with both pages', () => {
    const element = { cssSelector: 'header a.logo' };
    const merged = mergeDuplicateFindings([
      seoFinding({ urlPath: '/a', checker: 'ux-quality', title: 'Link has no text', where: { urlPath: '/a', role: 'visitor', breakpoint: '1440px', ...element } }),
      seoFinding({ urlPath: '/b', checker: 'ux-quality', title: 'Link has no text', where: { urlPath: '/b', role: 'visitor', breakpoint: '1440px', ...element } }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].seenAt?.pages).toEqual(['/a', '/b']);
  });
});

describe('T-47 crash grade reads is5xx only', () => {
  it('a step titled "Trigger uncaught exception" does not produce a crash grade', () => {
    const grades = calculateSiteAspectGrades([
      {
        ...seoFinding({ urlPath: '/' }),
        id: 'F-STEP',
        title: 'Trigger uncaught exception',
        severity: 'Minor',
        checker: 'bug-detection',
      },
    ]);
    expect(grades.aspects.Works.grade).not.toBe('F');
  });

  it('a real first-party 5xx produces a crash grade', () => {
    const grades = calculateSiteAspectGrades([
      {
        ...seoFinding({ urlPath: '/items/500' }),
        id: 'F-500',
        title: 'HTTP 500 on /items/500',
        severity: 'Blocker',
        checker: 'bug-detection',
        is5xx: true,
      },
    ]);
    expect(grades.aspects.Works.grade).toBe('F');
  });

  it('a third-party 5xx does not produce a crash grade', () => {
    const grades = calculateSiteAspectGrades([
      {
        ...seoFinding({ urlPath: '/' }),
        id: 'F-3P',
        title: 'Third-party request failed',
        severity: 'Minor',
        checker: 'bug-detection',
        is5xx: true,
        thirdParty: true,
      },
    ]);
    expect(grades.aspects.Works.grade).not.toBe('F');
  });
});

describe('T-47 an empty run is never ready', () => {
  it('a run with no checkers is Not ready yet with "No checks ran"', () => {
    const grades = calculateSiteAspectGrades([], { checkersRun: [] });
    const verdict = releaseVerdict([], undefined, grades);
    expect(verdict.ready).toBe(false);
    expect(verdict.stamp).toBe('Not ready yet');
    expect(verdict.reason).toBe('No checks ran.');
  });

  it('releaseVerdict with no findings and no grades is not ready', () => {
    const verdict = releaseVerdict([], undefined, undefined);
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toBe('No checks ran.');
  });

  it('an empty run is not ready under lenient either', () => {
    expect(releaseVerdict([], DEFAULT_RELEASE_GATES.lenient).ready).toBe(false);
  });

  it('a clean run with every area checked is ready', () => {
    const allCheckers = Object.values(ASPECT_CHECKERS).flat();
    const grades = calculateSiteAspectGrades([], { checkersRun: allCheckers });
    expect(Object.values(grades.aspects).every((a) => a.checked !== false)).toBe(true);
    expect(releaseVerdict([], undefined, grades).ready).toBe(true);
  });

  it('a run where one area was never checked is not ready under Standard, and ready under Lenient', () => {
    const grades = calculateSiteAspectGrades([], {
      checkersRun: Object.values(ASPECT_CHECKERS)
        .flat()
        .filter((c) => !ASPECT_CHECKERS.Secure.includes(c)),
    });
    expect(grades.aspects.Secure.checked).toBe(false);
    expect(releaseVerdict([], DEFAULT_RELEASE_GATES.standard, grades).ready).toBe(false);
    expect(releaseVerdict([], DEFAULT_RELEASE_GATES.lenient, grades).ready).toBe(true);
  });
});
