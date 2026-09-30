import { describe, it, expect } from 'vitest';
import { calculateSiteAspectGrades, scoreToGrade } from '../src/scoring.js';
import type { Finding } from '@qa/types';

describe('A–F Aspect Grading (scoring.ts)', () => {
  it('converts scores to grades correctly', () => {
    expect(scoreToGrade(95)).toBe('A');
    expect(scoreToGrade(90)).toBe('A');
    expect(scoreToGrade(85)).toBe('B');
    expect(scoreToGrade(80)).toBe('B');
    expect(scoreToGrade(75)).toBe('C');
    expect(scoreToGrade(70)).toBe('C');
    expect(scoreToGrade(65)).toBe('D');
    expect(scoreToGrade(60)).toBe('D');
    expect(scoreToGrade(55)).toBe('F');
  });

  it('caps score and grade at D or F when Blockers exist', () => {
    // 1 blocker caps at D
    expect(scoreToGrade(90, 1)).toBe('D');
    // 2 blockers caps at F
    expect(scoreToGrade(90, 2)).toBe('F');
  });

  it('awards Grade A across all aspects when there are no defects', () => {
    const grades = calculateSiteAspectGrades([]);
    expect(grades.overallGrade).toBe('A');
    expect(grades.overallScore).toBe(100);
    expect(grades.aspects.Works.grade).toBe('A');
    expect(grades.aspects.Accessible.grade).toBe('A');
    expect(grades.aspects['Fast and mobile'].grade).toBe('A');
    expect(grades.aspects.Findable.grade).toBe('A');
    expect(grades.aspects.Secure.grade).toBe('A');
    expect(grades.aspects['Looks and reads well'].grade).toBe('A');
  });

  it('deducts points deterministically based on severity and page spread', () => {
    const sampleFindings: Finding[] = [
      // 1 Major in Works (bug-detection) on 1 page = -15 * 1.0 = -15 -> score 85 (Grade B)
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
        verifyCommand: '',
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
        verifyCommand: '',
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
        verifyCommand: '',
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
        verifyCommand: '',
      },
    ];

    const grades1 = calculateSiteAspectGrades(sampleFindings);
    const grades2 = calculateSiteAspectGrades(sampleFindings);

    // Deterministic check: exact match across runs
    expect(grades1).toEqual(grades2);

    expect(grades1.aspects.Works.score).toBe(85);
    expect(grades1.aspects.Works.grade).toBe('B');
    expect(grades1.aspects.Works.findings).toContain('F-BUG-1');

    expect(grades1.aspects.Accessible.score).toBe(94);
    expect(grades1.aspects.Accessible.grade).toBe('A');
    expect(grades1.aspects.Accessible.findings).toHaveLength(3);
  });

  it('marks an aspect none of whose checks ran as "Not checked", and leaves it out of the overall', () => {
    const crash: Finding = {
      id: 'F-BUG-1',
      title: 'Uncaught Exception',
      severity: 'Major',
      checker: 'bug-detection',
      where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
      expectedVsActual: { expected: '', actual: '' },
      stepsToReproduce: [],
      evidence: {},
      resolution: '',
      verifyCommand: '',
    };
    // Only the bug and accessibility checks ran.
    const grades = calculateSiteAspectGrades([crash], { checkersRun: ['bug-detection', 'ux-quality'] });
    expect(grades.aspects.Works.checked).toBe(true);
    expect(grades.aspects.Accessible.checked).toBe(true);
    for (const aspect of ['Fast and mobile', 'Findable', 'Secure', 'Looks and reads well'] as const) {
      expect(grades.aspects[aspect].checked, aspect).toBe(false);
    }
    // The overall is the average of the two that ran, not lifted by four untouched As.
    expect(grades.overallScore).toBe(Math.round((grades.aspects.Works.score + 100) / 2));
    expect(grades.overallScore).toBeLessThan(calculateSiteAspectGrades([crash]).overallScore);

    // A checker that found something counts as having run, even when it wasn't listed.
    const seo: Finding = { ...crash, id: 'F-SEO-1', checker: 'seo', severity: 'Minor', title: 'Missing meta description' };
    expect(calculateSiteAspectGrades([seo], { checkersRun: [] }).aspects.Findable.checked).toBe(true);

    // Without the list (reports made before it existed), every aspect is graded as before.
    expect(calculateSiteAspectGrades([crash]).aspects.Findable.checked).toBeUndefined();
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
        verifyCommand: '',
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
        verifyCommand: '',
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
        verifyCommand: '',
      },
    ];

    const grades = calculateSiteAspectGrades(criticalFindings);
    expect(grades.aspects.Secure.score).toBeLessThanOrEqual(50);
    expect(grades.aspects.Secure.grade).toBe('F');
    // An F in any aspect caps overall grade at C
    expect(['C', 'D', 'F']).toContain(grades.overallGrade);
  });
});
