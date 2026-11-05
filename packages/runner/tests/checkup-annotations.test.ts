import { describe, it, expect } from 'vitest';
import { releaseVerdict, DEFAULT_RELEASE_GATES } from '@qa/types';
import type { Finding, SiteAspectGrades } from '@qa/types';
import { githubAnnotations, escapeData, escapeProperty } from '@qa/core';
import { exitCodeFor } from '../src/checkup.js';

function f(over: Partial<Finding> = {}): Finding {
  return {
    id: 'F-1',
    severity: 'Blocker',
    checker: 'bug-detection',
    title: 'Checkout crashes',
    where: { urlPath: '/checkout', role: 'member', breakpoint: '1440px' },
    expectedVsActual: { expected: 'ok', actual: 'crash' },
    stepsToReproduce: [],
    evidence: {},
    resolution: 'Fix the endpoint',
    ...over,
  };
}

describe('githubAnnotations', () => {
  it('emits one line per active Blocker and Major, none for Minor, Suggestion, Intended, needsConfirmation', () => {
    const lines = githubAnnotations([
      f({ id: 'F-1', severity: 'Blocker' }),
      f({ id: 'F-2', severity: 'Major', title: 'Slow' }),
      f({ id: 'F-3', severity: 'Minor' }),
      f({ id: 'F-4', severity: 'Suggestion' }),
      f({ id: 'F-5', severity: 'Blocker', triageStatus: 'Intended' }),
      f({ id: 'F-6', severity: 'Major', triageStatus: 'False Positive' }),
      f({ id: 'F-7', severity: 'Blocker', needsConfirmation: true }),
    ]);
    expect(lines).toHaveLength(2);
  });

  it('Blocker is ::error and Major is ::warning', () => {
    const lines = githubAnnotations([f({ severity: 'Major', title: 'Slow' }), f({ severity: 'Blocker' })]);
    expect(lines[0].startsWith('::error ')).toBe(true);
    expect(lines[1].startsWith('::warning ')).toBe(true);
  });

  it('caps at 50 lines', () => {
    const many = Array.from({ length: 80 }, (_, i) => f({ id: `F-${i}`, title: `T${i}` }));
    expect(githubAnnotations(many)).toHaveLength(50);
  });

  it('escapes %, \\r and \\n in message and also : and , in properties', () => {
    expect(escapeData('100%\r\nnext')).toBe('100%25%0D%0Anext');
    expect(escapeProperty('a:b,c%\n')).toBe('a%3Ab%2Cc%25%0A');
    const [line] = githubAnnotations([f({ title: 'a:b,c', resolution: 'fix 100%' })]);
    expect(line).toContain('title=a%3Ab%2Cc');
    expect(line).toContain('fix 100%25');
  });

  it('title with "\\n::error::injected" yields a single line', () => {
    const lines = githubAnnotations([f({ title: 'Oops\n::error::injected', resolution: 'x\r\n::error::y' })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
    expect(lines[0].match(/::error/g)).toHaveLength(1);
  });

  it('omits file= for absolute, drive-letter or .. paths; keeps a relative sourceLocation with line', () => {
    const at = (file: string, line?: number) => githubAnnotations([f({ sourceLocation: { file, line } })])[0];
    expect(at('/etc/passwd', 3)).not.toContain('file=');
    expect(at('C:\\proj\\a.ts', 3)).not.toContain('file=');
    expect(at('c:/proj/a.ts', 3)).not.toContain('file=');
    expect(at('..\\secret.ts', 3)).not.toContain('file=');
    expect(at('src/../../x.ts', 3)).not.toContain('file=');
    expect(at('src/app/page.tsx', 42)).toContain('file=src/app/page.tsx,line=42,title=');
    expect(at('src/app/page.tsx')).not.toContain('line=');
    expect(at('/etc/passwd', 3)).toContain('/checkout (member, 1440px)');
  });
});

describe('exitCodeFor', () => {
  it('exitCodeFor results for blocker/major/none are unchanged for active and inactive findings', () => {
    const blocker = f({ severity: 'Blocker' });
    const major = f({ severity: 'Major' });
    const minor = f({ severity: 'Minor' });
    expect(exitCodeFor([blocker], 'blocker')).toBe(1);
    expect(exitCodeFor([major], 'blocker')).toBe(0);
    expect(exitCodeFor([major], 'major')).toBe(1);
    expect(exitCodeFor([minor], 'major')).toBe(0);
    expect(exitCodeFor([blocker, major], 'none')).toBe(0);
    expect(exitCodeFor([f({ triageStatus: 'Intended' })], 'blocker')).toBe(0);
    expect(exitCodeFor([f({ triageStatus: 'False Positive' })], 'major')).toBe(0);
    expect(exitCodeFor([f({ needsConfirmation: true })], 'blocker')).toBe(0);
    expect(exitCodeFor([], 'blocker')).toBe(0);
  });

  it('standard exit code always agrees with the stamp', () => {
    const area = { grade: 'A' as const, score: 100, findings: [] as string[] };
    const grades = (worst: 'A' | 'D' | null): SiteAspectGrades => ({
      aspects: {
        Works: worst === null ? { grade: null, score: 0, findings: [], checked: false } : { ...area, grade: worst },
        Accessible: area,
        'Fast and mobile': area,
        Findable: area,
        Protected: area,
        'Looks and reads well': area,
      },
      overallGrade: worst ?? 'A',
      overallScore: 90,
    });
    const cases: Array<[Finding[], SiteAspectGrades | undefined]> = [
      [[], undefined],
      [[f({ severity: 'Blocker' })], undefined],
      [[f({ severity: 'Major' })], undefined],
      [[f({ severity: 'Major' })], grades('A')],
      [[], grades('D')],
      [[], grades(null)],
      [[f({ severity: 'Blocker' })], grades('A')],
    ];
    for (const [findings, g] of cases) {
      const stamp = releaseVerdict(findings, DEFAULT_RELEASE_GATES.standard, g);
      expect(exitCodeFor(findings, 'standard', g)).toBe(stamp.ready ? 0 : 1);
      // The stamp with no gate given is the same Standard rule.
      expect(releaseVerdict(findings, undefined, g).ready).toBe(stamp.ready);
    }
    // One Major with every area at C or better does not fail Standard.
    expect(exitCodeFor([f({ severity: 'Major' })], 'standard', grades('A'))).toBe(0);
  });
});
