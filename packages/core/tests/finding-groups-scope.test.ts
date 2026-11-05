import { describe, it, expect } from 'vitest';
import type { Finding } from '@qa/types';
import { isSiteScopedFinding, mergeDuplicateFindings } from '../src/finding-groups.js';

const finding = (overrides: Partial<Finding> & { urlPath: string; testCaseId: string }): Finding => {
  const { urlPath, ...rest } = overrides;
  return {
    id: `F-${overrides.testCaseId}`,
    severity: 'Major',
    checker: 'seo',
    title: 'Dead End Page: No back button',
    where: { urlPath, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected: '', actual: '' },
    stepsToReproduce: [],
    evidence: {},
    resolution: '',
    ...rest,
  };
};

describe('site-scoped findings (OPEN_ISSUES C1)', () => {
  it('recognises the site-wide files and the missing favicon, and not page findings', () => {
    expect(
      isSiteScopedFinding({
        title: 'Site is missing a robots.txt file at domain root',
        where: { urlPath: '/robots.txt', role: 'visitor', breakpoint: '1440px' },
      })
    ).toBe(true);
    expect(
      isSiteScopedFinding({
        title: 'Page is missing a favicon link tag',
        where: { urlPath: '/about', role: 'visitor', breakpoint: '1440px' },
      })
    ).toBe(true);
    expect(
      isSiteScopedFinding({
        title: 'Dead End Page: No back button',
        where: { urlPath: '/about', role: 'visitor', breakpoint: '1440px' },
      })
    ).toBe(false);
  });

  it('merges a site-wide finding seen on several pages into one finding that lists the pages', () => {
    const missing = (page: string, id: string) =>
      finding({
        urlPath: page,
        testCaseId: id,
        title: 'Site is missing a sitemap.xml file',
        where: { urlPath: page, role: 'visitor', breakpoint: '1440px' },
      });
    const merged = mergeDuplicateFindings([missing('/', 'P1'), missing('/about', 'P2'), missing('/shop', 'P3')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].seenAt?.pages).toEqual(['/', '/about', '/shop']);
  });

  it('gives the same page-wide problem on two pages one problem key, so it is one problem', () => {
    const deadEnd = (page: string, id: string) => finding({ urlPath: page, testCaseId: id });
    const merged = mergeDuplicateFindings([deadEnd('/a', 'P1'), deadEnd('/b', 'P2')]);
    expect(merged).toHaveLength(2);
    expect(merged[0].issueKey).toBeDefined();
    expect(merged[0].issueKey).toBe(merged[1].issueKey);
  });
});
