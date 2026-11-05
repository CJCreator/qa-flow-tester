import { describe, it, expect } from 'vitest';
import { calculateSiteAspectGrades, scoreToGrade } from '../src/scoring.js';
import type { Finding } from '@qa/types';

describe('A–F Aspect Grading (scoring.ts)', () => {
  it('converts scores to grades correctly per PRD FR-8.1', () => {
    expect(scoreToGrade(95)).toBe('A');
    expect(scoreToGrade(90)).toBe('A');
    expect(scoreToGrade(85)).toBe('B');
    expect(scoreToGrade(75)).toBe('B');
    expect(scoreToGrade(74)).toBe('C');
    expect(scoreToGrade(60)).toBe('C');
    expect(scoreToGrade(55)).toBe('D');
    expect(scoreToGrade(40)).toBe('D');
    expect(scoreToGrade(35)).toBe('F');
  });

  it('caps score and grade at D or F when Blockers exist', () => {
    // 1 blocker caps at D
    expect(scoreToGrade(90, 1)).toBe('D');
    // blocker when score < 40 is F
    expect(scoreToGrade(35, 1)).toBe('F');
  });

  it('awards Grade A across all aspects when there are no defects', () => {
    const grades = calculateSiteAspectGrades([]);
    expect(grades.overallGrade).toBe('A');
    expect(grades.overallScore).toBe(100);
    expect(grades.aspects.Works.grade).toBe('A');
    expect(grades.aspects.Accessible.grade).toBe('A');
    expect(grades.aspects['Fast and mobile'].grade).toBe('A');
    expect(grades.aspects.Findable.grade).toBe('A');
    expect(grades.aspects.Protected.grade).toBe('A');
    expect(grades.aspects['Looks and reads well'].grade).toBe('A');
  });

  it('deducts points deterministically based on severity and page spread', () => {
    const sampleFindings: Finding[] = [
      // 1 Major in Works (bug-detection) on 1 page = -20 * 1.0 = -20 -> score 80 (Grade B)
      {
        id: 'F-BUG-1',
        title: 'Unhandled error in console',
        severity: 'Major',
        checker: 'bug-detection',
        where: { urlPath: '/dashboard', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
      // 1 Minor in Accessible (ux-quality) on 3 pages = -5 * 1.25 = -6.25 -> score 94 (Grade A)
      {
        id: 'F-UX-1',
        title: 'Low contrast on footer link',
        severity: 'Minor',
        checker: 'ux-quality',
        where: { urlPath: '/home', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
      {
        id: 'F-UX-2',
        title: 'Low contrast on footer link',
        severity: 'Minor',
        checker: 'ux-quality',
        where: { urlPath: '/about', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
      {
        id: 'F-UX-3',
        title: 'Low contrast on footer link',
        severity: 'Minor',
        checker: 'ux-quality',
        where: { urlPath: '/contact', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
    ];

    const grades1 = calculateSiteAspectGrades(sampleFindings);
    const grades2 = calculateSiteAspectGrades(sampleFindings);

    // Deterministic check: exact match across runs
    expect(grades1).toEqual(grades2);

    expect(grades1.aspects.Works.score).toBe(80);
    expect(grades1.aspects.Works.grade).toBe('B');
    expect(grades1.aspects.Works.findings).toContain('F-BUG-1');

    expect(grades1.aspects.Accessible.score).toBe(94);
    expect(grades1.aspects.Accessible.grade).toBe('A');
    expect(grades1.aspects.Accessible.findings).toHaveLength(3);
  });

  it('marks an aspect none of whose checks ran as not checked, and leaves it out of the overall score', () => {
    const minorOnHome: Finding = {
      id: 'F-UX-1',
      title: 'Low contrast on footer link',
      severity: 'Minor',
      checker: 'ux-quality',
      where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: '', actual: '' },
      stepsToReproduce: [],
      evidence: {},
      resolution: '',
    };
    // Only the bug and accessibility checks ran; the security one still found something.
    const grades = calculateSiteAspectGrades(
      [minorOnHome, { ...minorOnHome, id: 'F-SEC-1', checker: 'security', title: 'No HSTS' }],
      {
        checkersRun: ['bug-detection', 'ux-quality'],
      }
    );
    expect(grades.aspects.Works).toMatchObject({ grade: 'A', checked: true });
    expect(grades.aspects.Accessible).toMatchObject({ score: 95, checked: true });
    // A checker that found something ran, whatever the list says.
    expect(grades.aspects.Protected).toMatchObject({ score: 95, checked: true });
    for (const aspect of ['Fast and mobile', 'Findable', 'Looks and reads well'] as const) {
      expect(grades.aspects[aspect].checked, aspect).toBe(false);
      // Never an A, never 100: no grade at all.
      expect(grades.aspects[aspect].grade, aspect).toBeNull();
      expect(grades.aspects[aspect].score, aspect).toBe(0);
    }
    // (100 + 95 + 95) / 3, not lifted by three untouched A 100s.
    expect(grades.overallScore).toBe(97);

    // Reports made before this was recorded say nothing either way.
    expect(calculateSiteAspectGrades([]).aspects.Findable.checked).toBeUndefined();
  });

  it('fails an aspect (Grade F) when multiple major/blocker defects occur', () => {
    const criticalFindings: Finding[] = [
      {
        id: 'F-SEC-1',
        title: 'Missing Content-Security-Policy',
        severity: 'Major',
        checker: 'security',
        where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
      {
        id: 'F-SEC-2',
        title: 'Passwords in URL',
        severity: 'Blocker',
        checker: 'security',
        where: { urlPath: '/login', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
      {
        id: 'F-SEC-3',
        title: 'Unencrypted HTTP Scripts',
        severity: 'Major',
        checker: 'security',
        where: { urlPath: '/login', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
    ];

    const grades = calculateSiteAspectGrades(criticalFindings);
    expect(grades.aspects.Protected.score).toBeLessThanOrEqual(50);
    expect(grades.aspects.Protected.grade).toBe('F');
    // The overall grade is never better than the worst area grade
    expect(grades.overallGrade).toBe('F');
  });

  it('keeps AI visual review non-graded as advisory commentary', () => {
    const opinions: Finding[] = Array.from({ length: 30 }, (_, n) => ({
      id: 'AI-' + n,
      severity: 'Minor',
      checker: 'ai-review',
      title: '[AI Review] Opinion number ' + n,
      where: { urlPath: '/p' + n, role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: '', actual: '' },
      stepsToReproduce: [],
      evidence: {},
      resolution: '',
    }));
    const looks = calculateSiteAspectGrades(opinions).aspects['Looks and reads well'];
    expect(looks.score).toBe(100);
    expect(looks.grade).toBe('A');
  });

  it('applies execution stability penalty (-3 per flaky test) to Works score', () => {
    const grades = calculateSiteAspectGrades([], { flakyCount: 2 });
    expect(grades.aspects.Works.score).toBe(94);
    expect(grades.aspects.Works.grade).toBe('A');
  });

  it('assigns Grade F to Works when an unhandled first-party 500 occurs', () => {
    const findings: Finding[] = [
      {
        id: 'F-HTTP-1',
        title: 'HTTP 500 on POST /api/invoices',
        severity: 'Blocker',
        checker: 'bug-detection',
        thirdParty: false,
        is5xx: true,
        where: { urlPath: '/invoices', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
    ];
    const grades = calculateSiteAspectGrades(findings);
    expect(grades.aspects.Works.grade).toBe('F');
  });

  it('reads the crash from the structured status, not the title text', () => {
    const base: Finding = {
      id: 'F-HTTP-404',
      title: 'HTTP 404 on GET /items/500',
      severity: 'Major',
      checker: 'bug-detection',
      thirdParty: false,
      is5xx: false,
      where: { urlPath: '/items/500', role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: '', actual: '' },
      stepsToReproduce: [],
      evidence: {},
      resolution: '',
    };
    const grades = calculateSiteAspectGrades([base]);
    expect(grades.aspects.Works.grade).not.toBe('F');
  });

  it('caps the overall grade at the worst area grade, and is null when nothing was checked', () => {
    const major: Finding = {
      id: 'F-SEC-1',
      title: 'Missing header',
      severity: 'Blocker',
      checker: 'security',
      where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: '', actual: '' },
      stepsToReproduce: [],
      evidence: {},
      resolution: '',
    };
    // Five areas at A and one at D would average above C; the cap holds the overall at D.
    const grades = calculateSiteAspectGrades([major]);
    expect(grades.aspects.Protected.grade).toBe('D');
    expect(grades.overallGrade).toBe('D');

    const none = calculateSiteAspectGrades([], { checkersRun: [] });
    expect(none.overallGrade).toBeNull();
  });

  it('does not assign automatic Grade F for third-party failures', () => {
    const findings: Finding[] = [
      {
        id: 'F-HTTP-TP',
        title: 'Third-party request failed: HTTP 500 on GET https://analytics.example.com/beacon',
        severity: 'Minor',
        checker: 'bug-detection',
        thirdParty: true,
        where: { urlPath: '/home', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
    ];
    const grades = calculateSiteAspectGrades(findings);
    expect(grades.aspects.Works.score).toBe(95);
    expect(grades.aspects.Works.grade).toBe('A');
  });
});

describe('scoring counts problems, not findings (OPEN_ISSUES C1, C4)', () => {
  const at = (id: string, urlPath: string, extra: Partial<Finding> = {}): Finding => ({
    id,
    title: 'Dead End Page: No back button',
    severity: 'Major',
    checker: 'bug-detection',
    where: { urlPath, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected: '', actual: '' },
    stepsToReproduce: [],
    evidence: {},
    resolution: '',
    ...extra,
  });

  it('counts one page-wide Major on two pages once, with the spread multiplier', () => {
    const grades = calculateSiteAspectGrades([at('F-1', '/a'), at('F-2', '/b')]);
    // One problem on two pages: 20 x 1.25 = 25 off, one Major, so Grade B (not two Majors to C).
    expect(grades.aspects.Works.score).toBe(75);
    expect(grades.aspects.Works.grade).toBe('B');
  });

  it('counts a site-wide problem once per site, never spread across pages', () => {
    const missing = (urlPath: string, id: string): Finding => ({
      ...at(id, urlPath),
      title: 'Site is missing a robots.txt file at domain root',
      checker: 'seo',
    });
    const grades = calculateSiteAspectGrades([missing('/a', 'F-1'), missing('/b', 'F-2'), missing('/c', 'F-3')]);
    // 20 off once (not 20 x 1.5 over three pages): Findable 80.
    expect(grades.aspects.Findable.score).toBe(80);
  });

  it('does not give Grade F for a crash named only in the title (no structured 5xx)', () => {
    for (const title of ['Uncaught Exception: boom', 'Application crash on load']) {
      const grades = calculateSiteAspectGrades([at('F-1', '/', { title, is5xx: false })]);
      expect(grades.aspects.Works.grade).not.toBe('F');
    }
  });
});
