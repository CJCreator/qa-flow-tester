import { describe, it, expect } from 'vitest';
import type { Finding } from '../src/index.js';
import { groupIntoProblems, problemKey } from '../src/problems.js';

const finding = (id: string, checker: string, title: string, issueKey: string, urlPath = '/') =>
  ({
    id,
    checker,
    severity: 'Major',
    title,
    issueKey,
    where: { urlPath, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected: '', actual: '' },
    stepsToReproduce: [],
    evidence: {},
  }) as unknown as Finding;

const seoTitle = (urlPath = '/') =>
  finding('F1', 'seo', 'Page is missing a title tag', 'seo|Page is missing a title tag|', urlPath);
const axeTitle = (urlPath = '/') =>
  finding(
    'F2',
    'ux-quality',
    'WCAG 2.4.2 Page Titled violation: Page should have title element (document-title)',
    'ux-quality|WCAG 2.4.2 Page Titled violation: Page should have title element (document-title)|',
    urlPath
  );

describe('problemKey: a missing page title', () => {
  it('is one key for the search check and the accessibility scan', () => {
    expect(problemKey(seoTitle())).toBe(problemKey(axeTitle()));
  });

  it('groups the two findings into one problem that lists both and counts toward the first area', () => {
    const problems = groupIntoProblems([seoTitle('/'), axeTitle('/'), seoTitle('/about')]);
    expect(problems).toHaveLength(1);
    expect(problems[0].findings).toHaveLength(3);
    expect(problems[0].pages).toEqual(['/', '/about']);
    expect(problems[0].aspects).toEqual(['Findable', 'Accessible']);
  });
});

describe('problemKey: everything else is unchanged', () => {
  it('keeps the issueKey of a finding that is not shared', () => {
    const f = finding('F3', 'seo', 'Page is missing a meta description', 'seo|Page is missing a meta description|');
    expect(problemKey(f)).toBe('seo|Page is missing a meta description|');
  });

  it('falls back to the lower-cased plain title without an issueKey', () => {
    expect(problemKey({ title: 'Page is missing a meta description' })).toBe(
      'the page is missing a summary for search results'
    );
  });

  it('keeps two different problems apart', () => {
    const other = finding('F4', 'seo', 'Page is missing a meta description', 'seo|Page is missing a meta description|');
    expect(groupIntoProblems([seoTitle(), other])).toHaveLength(2);
  });
});
