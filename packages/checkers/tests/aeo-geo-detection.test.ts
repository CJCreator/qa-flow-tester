import { describe, it, expect } from 'vitest';
import { AeoChecker, type AeoPageDetails } from '../src/aeo.js';
import { GeoChecker, type GeoPageDetails } from '../src/geo.js';
import type { Page } from 'playwright';

function createMockPage<T>(details: T): Page {
  return {
    evaluate: async () => details,
    context: () => {
      throw new Error('Playwright request API used');
    },
  } as unknown as Page;
}

const defaultAeoDetails: AeoPageDetails = {
  jsonLdScripts: [],
  hasBreadcrumbsNav: true,
  questionHeadings: [],
  wordCount: 200,
  listCount: 1,
  tableCount: 0,
};

const defaultGeoDetails: GeoPageDetails = {
  totalHtmlLength: 3000,
  textLength: 1000,
  wordCount: 200,
  hasMainOrArticle: true,
  externalLinkCount: 2,
  hasAuthorByline: true,
  hasDatePublished: true,
};

describe('AEO and GEO Detection Logic (Unit Tier)', () => {
  const aeoChecker = new AeoChecker();
  const geoChecker = new GeoChecker();

  describe('AEO Organization / WebSite Schema and Site-Wide State', () => {
    it('flags missing Organization/WebSite schema on homepage (urlPath: /) when not previously recorded', async () => {
      const siteWide = new Set<string>();
      const page = createMockPage({
        ...defaultAeoDetails,
        jsonLdScripts: [],
      });

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-HOME',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/',
        siteWide,
      });

      const orgFinding = findings.find((f) => f.title.includes('missing Organization or WebSite'));
      expect(orgFinding).toBeDefined();
      expect(orgFinding?.severity).toBe('Minor');
      expect(orgFinding?.categoryTag).toBe('AEO');
      expect(orgFinding?.title).toBe('Homepage is missing Organization or WebSite structured data');
      expect(siteWide.has('org-schema')).toBe(true);
    });

    it('flags missing schema on homepage with empty urlPath', async () => {
      const siteWide = new Set<string>();
      const page = createMockPage(defaultAeoDetails);

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-EMPTY',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '',
        siteWide,
      });

      expect(findings.some((f) => f.title.includes('missing Organization or WebSite'))).toBe(true);
      expect(siteWide.has('org-schema')).toBe(true);
    });

    it('does not re-flag missing schema on subsequent homepage visits when org-schema is in siteWide', async () => {
      const siteWide = new Set<string>(['org-schema']);
      const page = createMockPage(defaultAeoDetails);

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-HOME-2',
        role: 'visitor',
        breakpoint: '768px',
        urlPath: '/',
        siteWide,
      });

      expect(findings.some((f) => f.title.includes('missing Organization or WebSite'))).toBe(false);
    });

    it('does not flag missing schema on homepage when valid Organization schema is present, and sets org-schema in siteWide', async () => {
      const siteWide = new Set<string>();
      const page = createMockPage({
        ...defaultAeoDetails,
        jsonLdScripts: [
          JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme Corp' }),
        ],
      });

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-ORG-PRESENT',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/',
        siteWide,
      });

      expect(findings.some((f) => f.title.includes('missing Organization or WebSite'))).toBe(false);
      expect(siteWide.has('org-schema')).toBe(true);
    });

    it('does not flag missing schema on homepage when WebSite schema is present', async () => {
      const siteWide = new Set<string>();
      const page = createMockPage({
        ...defaultAeoDetails,
        jsonLdScripts: [JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'Acme Site' })],
      });

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-SITE-PRESENT',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/',
        siteWide,
      });

      expect(findings.some((f) => f.title.includes('missing Organization or WebSite'))).toBe(false);
      expect(siteWide.has('org-schema')).toBe(true);
    });

    it('/about page never raises org-schema finding and never sets org-schema in siteWide', async () => {
      const siteWide = new Set<string>();
      const page = createMockPage(defaultAeoDetails);

      const aboutFindings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-ABOUT',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/about',
        siteWide,
      });

      expect(aboutFindings.some((f) => f.title.includes('missing Organization or WebSite'))).toBe(false);
      expect(siteWide.has('org-schema')).toBe(false);

      // Subsequent homepage check still fires because org-schema was not set by /about
      const homeFindings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-HOME',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/',
        siteWide,
      });

      expect(homeFindings.some((f) => f.title.includes('missing Organization or WebSite'))).toBe(true);
      expect(siteWide.has('org-schema')).toBe(true);
    });
  });

  describe('AEO Question Headings & Direct Answers', () => {
    it('accepts a direct answer between 10 and 100 words', async () => {
      const page = createMockPage({
        ...defaultAeoDetails,
        questionHeadings: [
          {
            text: 'How do I reset my password?',
            nextParagraphWordCount: 25,
            hasAnswerParagraph: true,
            answerIsStructured: false,
          },
        ],
      });

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-Q1',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/faq',
      });

      expect(findings.some((f) => f.title.includes('lacks a concise direct answer'))).toBe(false);
    });

    it('flags answer under 10 words when not structured', async () => {
      const page = createMockPage({
        ...defaultAeoDetails,
        questionHeadings: [
          {
            text: 'How do I reset my password?',
            nextParagraphWordCount: 4,
            hasAnswerParagraph: true,
            answerIsStructured: false,
          },
        ],
      });

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-SHORT',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/faq',
      });

      const f = findings.find((x) => x.title.includes('lacks a concise direct answer'));
      expect(f).toBeDefined();
      expect(f?.expectedVsActual.actual).toContain('4 words');
    });

    it('flags answer over 100 words when not structured', async () => {
      const page = createMockPage({
        ...defaultAeoDetails,
        questionHeadings: [
          {
            text: 'How do I reset my password?',
            nextParagraphWordCount: 120,
            hasAnswerParagraph: true,
            answerIsStructured: false,
          },
        ],
      });

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-LONG',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/faq',
      });

      const f = findings.find((x) => x.title.includes('lacks a concise direct answer'));
      expect(f).toBeDefined();
      expect(f?.expectedVsActual.actual).toContain('120 words');
    });

    it('accepts structured answers (lists, tables, dl) regardless of word count', async () => {
      const page = createMockPage({
        ...defaultAeoDetails,
        questionHeadings: [
          {
            text: 'What are the system requirements?',
            nextParagraphWordCount: 180,
            hasAnswerParagraph: true,
            answerIsStructured: true,
          },
        ],
      });

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-STRUCT',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/faq',
      });

      expect(findings.some((f) => f.title.includes('lacks a concise direct answer'))).toBe(false);
    });

    it('flags question with no answer paragraph at all', async () => {
      const page = createMockPage({
        ...defaultAeoDetails,
        questionHeadings: [
          {
            text: 'Why choose our platform?',
            nextParagraphWordCount: 0,
            hasAnswerParagraph: false,
            answerIsStructured: false,
          },
        ],
      });

      const findings = await aeoChecker.checkPage(page, {
        testCaseId: 'TC-NO-ANSWER',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/faq',
      });

      const f = findings.find((x) => x.title.includes('lacks a concise direct answer'));
      expect(f).toBeDefined();
      expect(f?.expectedVsActual.actual).toBe('Heading is not followed by an immediate answer');
    });
  });

  describe('GEO Author Attribution and Content Checks', () => {
    it('flags content page (>=300 words) lacking author byline and published date', async () => {
      const page = createMockPage({
        ...defaultGeoDetails,
        wordCount: 450,
        hasAuthorByline: false,
        hasDatePublished: false,
      });

      const findings = await geoChecker.checkPage(page, {
        testCaseId: 'TC-GEO-AUTHOR',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/blog/post-1',
      });

      const bylineFinding = findings.find((f) => f.title.includes('lacks author byline'));
      expect(bylineFinding).toBeDefined();
      expect(bylineFinding?.severity).toBe('Minor');
      expect(bylineFinding?.categoryTag).toBe('GEO');
    });

    it('does not flag author byline when hasAuthorByline is true', async () => {
      const page = createMockPage({
        ...defaultGeoDetails,
        wordCount: 450,
        hasAuthorByline: true,
        hasDatePublished: false,
      });

      const findings = await geoChecker.checkPage(page, {
        testCaseId: 'TC-GEO-OK',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/blog/post-1',
      });

      expect(findings.some((f) => f.title.includes('lacks author byline'))).toBe(false);
    });

    it('does not flag author byline when hasDatePublished is true', async () => {
      const page = createMockPage({
        ...defaultGeoDetails,
        wordCount: 450,
        hasAuthorByline: false,
        hasDatePublished: true,
      });

      const findings = await geoChecker.checkPage(page, {
        testCaseId: 'TC-GEO-DATE',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/blog/post-1',
      });

      expect(findings.some((f) => f.title.includes('lacks author byline'))).toBe(false);
    });
  });
});
