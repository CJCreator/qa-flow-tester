import { describe, it, expect } from 'vitest';
import type { AuditFinding, ContentHeading, ContentImage, HeadingLevel, PageContent, Section } from '@qa/types';
import { contentProblems } from '../src/audit/analysis/content-problems.js';
import { seoBasics } from '../src/audit/analysis/seo-basics.js';
import { createFindingIdAllocator } from '../src/audit/analysis/finding-ids.js';

/** A page with a title, a description and one H1: no content problem unless a test changes that. */
function page(urlPath: string, overrides: Partial<PageContent> = {}): PageContent {
  const text = overrides.text ?? `Text of ${urlPath}`;
  return {
    urlPath,
    title: `Title of ${urlPath}`,
    description: `Description of ${urlPath}`,
    text,
    headings: [h(1, `Heading of ${urlPath}`)],
    images: [],
    links: [],
    forms: [],
    ctas: [],
    language: { primary: 'en', others: [], declared: 'en' },
    sections: [{ id: 's1', kind: 'page', start: 0, end: text.length }],
    ...overrides,
  };
}

function h(level: HeadingLevel, text = `H${level}`): ContentHeading {
  return { level, text, sectionId: 's1' };
}

function img(src: string, alt: string | null, sectionId = 's1'): ContentImage {
  return { src, alt, sectionId };
}

/** Sections over a text built from parts: [kind, text][]. */
function withSections(parts: Array<[Section['kind'], string]>): Pick<PageContent, 'text' | 'sections'> {
  let text = '';
  const sections: Section[] = [];
  parts.forEach(([kind, part], i) => {
    if (i > 0) text += '\n';
    const start = i === 0 ? 0 : text.length;
    text += part;
    sections.push({ id: `s${i + 1}`, kind, start, end: text.length });
  });
  for (let i = 0; i < sections.length - 1; i++) sections[i].end = sections[i + 1].start;
  return { text, sections };
}

function run(pages: PageContent[]): AuditFinding[] {
  return contentProblems(pages, createFindingIdAllocator());
}

const byRule = (findings: AuditFinding[], rule: string) => findings.filter((f) => f.rule === rule);

/** ADR 0018 words a finding must never use. */
const CLAIM_WORDS = /\b(compliant|accessible|secure|passes)\b/i;

function expectWellFormed(findings: AuditFinding[]): void {
  for (const f of findings) {
    expect(f.id).toMatch(/^AF-\d{3,}$/);
    expect(f.source).toBe('rule');
    for (const key of ['rule', 'group', 'area', 'title', 'detail', 'suggestion', 'impact', 'effort', 'urlPath'] as const) {
      expect(typeof f[key], `${f.rule}.${key}`).toBe('string');
      expect(f[key], `${f.rule}.${key}`).not.toBe('');
    }
    expect(f).toHaveProperty('sectionId');
    for (const text of [f.title, f.detail, f.suggestion]) expect(text).not.toMatch(CLAIM_WORDS);
  }
}

describe('contentProblems', () => {
  it('reports nothing for distinct, complete pages', () => {
    expect(run([page('/'), page('/about')])).toEqual([]);
  });

  it('missing title: null or empty, whole page (REQ-014 AC-3)', () => {
    const findings = run([page('/a', { title: null }), page('/b', { title: '   ' }), page('/c')]);
    const missing = byRule(findings, 'missing-title');
    expect(missing.map((f) => f.urlPath)).toEqual(['/a', '/b']);
    for (const f of missing) {
      expect(f.sectionId).toBeNull();
      expect(f.detail).toContain(f.urlPath);
    }
    expectWellFormed(findings);
  });

  it('duplicate title after trimming and collapsing whitespace lists both pages (REQ-014 AC-2)', () => {
    const findings = run([
      page('/a', { title: 'Fresh  Bread ' }),
      page('/b', { title: '\nFresh Bread' }),
      page('/c', { title: null }),
      page('/d', { title: '' }),
    ]);
    const dup = byRule(findings, 'duplicate-title');
    expect(dup).toHaveLength(1);
    expect(dup[0].pages).toEqual(['/a', '/b']);
    expect(dup[0].urlPath).toBe('/a');
    expect(dup[0].sectionId).toBeNull();
    expectWellFormed(findings);
  });

  it('pages without a title are not counted as duplicates', () => {
    const findings = run([page('/a', { title: null }), page('/b', { title: null }), page('/c', { title: ' ' })]);
    expect(byRule(findings, 'duplicate-title')).toEqual([]);
    expect(byRule(findings, 'missing-title')).toHaveLength(3);
  });

  it('missing description names the page (REQ-014 AC-4)', () => {
    const findings = run([page('/a', { description: null }), page('/b', { description: '' }), page('/c')]);
    const missing = byRule(findings, 'missing-description');
    expect(missing.map((f) => f.urlPath)).toEqual(['/a', '/b']);
    expect(missing.every((f) => f.sectionId === null && f.detail.includes(f.urlPath))).toBe(true);
    expectWellFormed(findings);
  });

  it('duplicate description lists both pages (REQ-014 AC-5)', () => {
    const findings = run([
      page('/a', { description: 'Cakes made daily.' }),
      page('/b'),
      page('/c', { description: ' Cakes   made daily. ' }),
    ]);
    const dup = byRule(findings, 'duplicate-description');
    expect(dup).toHaveLength(1);
    expect(dup[0].pages).toEqual(['/a', '/c']);
    expectWellFormed(findings);
  });

  it('missing alt: one per image with no alt attribute, empty alt not reported (REQ-014 AC-6)', () => {
    const findings = run([
      page('/gallery', {
        ...withSections([
          ['header', 'Bakery'],
          ['main', 'Gallery'],
        ]),
        images: [img('/img/a.jpg', null, 's2'), img('/img/deco.png', ''), img('/img/b.jpg', null, 's2'), img('/img/c.jpg', 'A cake')],
      }),
    ]);
    const alt = byRule(findings, 'missing-alt');
    expect(alt.map((f) => f.target)).toEqual(['/img/a.jpg', '/img/b.jpg']);
    for (const f of alt) {
      expect(f.urlPath).toBe('/gallery');
      expect(f.sectionId).toBe('s2');
    }
    expectWellFormed(findings);
  });

  it('duplicate content compares the main Sections after whitespace normalisation', () => {
    const findings = run([
      page('/a', { ...withSections([['header', 'Menu A'], ['main', 'Same  words\nhere'], ['footer', 'Foot A']]) }),
      page('/b', { ...withSections([['header', 'Menu B'], ['main', 'Same words here'], ['footer', 'Foot B']]) }),
      page('/c', { ...withSections([['main', 'Other words']]) }),
    ]);
    const dup = byRule(findings, 'duplicate-content');
    expect(dup).toHaveLength(1);
    expect(dup[0].pages).toEqual(['/a', '/b']);
    expect(dup[0].sectionId).toBe('s2');
    expectWellFormed(findings);
  });

  it('duplicate content falls back to the whole text when there is no main Section', () => {
    const findings = run([page('/a', { text: 'Hello   world' }), page('/b', { text: 'Hello world' })]);
    expect(byRule(findings, 'duplicate-content').map((f) => f.pages)).toEqual([['/a', '/b']]);
  });

  it('pages sharing title and description but not main text give no duplicate content', () => {
    const shared = { title: 'Shop', description: 'Buy bread.' };
    const findings = run([page('/a', { ...shared, text: 'Rye bread' }), page('/b', { ...shared, text: 'White bread' })]);
    expect(byRule(findings, 'duplicate-content')).toEqual([]);
    expect(byRule(findings, 'duplicate-title')).toHaveLength(1);
    expect(byRule(findings, 'duplicate-description')).toHaveLength(1);
  });

  it('empty text and text cut at the per-page limit are not compared', () => {
    const findings = run([
      page('/a', { text: '' }),
      page('/b', { text: '  ' }),
      page('/c', { text: 'Long text', textTruncated: true }),
      page('/d', { text: 'Long text', textTruncated: true }),
    ]);
    expect(byRule(findings, 'duplicate-content')).toEqual([]);
  });

  it('heading problems: no H1, more than one H1, a skipped level', () => {
    const findings = run([
      page('/none', { headings: [h(2), h(3)] }),
      page('/two', { headings: [h(1), h(2), h(1)] }),
      page('/skip', { headings: [h(1), h(2), h(4)] }),
      page('/fine', { headings: [h(1), h(2), h(3), h(2), h(3)] }),
    ]);
    expect(byRule(findings, 'no-h1').map((f) => f.urlPath)).toEqual(['/none']);
    expect(byRule(findings, 'multiple-h1').map((f) => f.urlPath)).toEqual(['/two']);
    const skip = byRule(findings, 'skipped-heading-level');
    expect(skip.map((f) => f.urlPath)).toEqual(['/skip']);
    expect(skip[0].detail).toContain('H2');
    expect(skip[0].detail).toContain('H4');
    expect(findings.every((f) => f.sectionId === null)).toBe(true);
    expectWellFormed(findings);
  });

  it('ids come from the shared allocator, unique and in order', () => {
    const ids = createFindingIdAllocator(7);
    const findings = contentProblems([page('/a', { title: null, description: null }), page('/b', { title: null })], ids);
    expect(findings.map((f) => f.id)).toEqual(['AF-007', 'AF-008', 'AF-009']);
    expect(ids.nextNumber).toBe(10);
  });

  it('every finding is complete and free of ADR 0018 claim words', () => {
    const findings = run([
      page('/a', { title: null, description: null, headings: [], images: [img('/x.png', null)] }),
      page('/b', { title: 'T', description: 'D', headings: [h(1), h(1), h(3)], text: 'same' }),
      page('/c', { title: 'T', description: 'D', text: 'same' }),
    ]);
    const rules = new Set(findings.map((f) => f.rule));
    for (const rule of [
      'missing-title',
      'missing-description',
      'no-h1',
      'multiple-h1',
      'skipped-heading-level',
      'missing-alt',
      'duplicate-title',
      'duplicate-description',
      'duplicate-content',
    ]) {
      expect(rules.has(rule), rule).toBe(true);
    }
    expectWellFormed(findings);
  });
});

describe('seoBasics', () => {
  it('records the facts and points at the page findings (REQ-038)', () => {
    const pages = [
      page('/a', {
        title: 'Same',
        description: null,
        headings: [h(1), h(1), h(3)],
        images: [img('/1.png', null), img('/2.png', ''), img('/3.png', null)],
        language: { primary: 'en', others: [], declared: 'en-IN' },
      }),
      page('/b', { title: 'Same' }),
      page('/c', { title: null }),
    ];
    const findings = run(pages);
    const basics = seoBasics(pages[0], findings);
    expect(basics).toMatchObject({
      hasTitle: true,
      hasDescription: false,
      h1Count: 2,
      skippedHeadingLevel: true,
      imagesWithoutAlt: 2,
      htmlLang: 'en-IN',
    });
    const own = findings.filter((f) => f.urlPath === '/a' || f.pages?.includes('/a')).map((f) => f.id);
    expect(basics.findingIds).toEqual(own);
    expect(basics.findingIds.length).toBeGreaterThan(0);
    const allIds = new Set(findings.map((f) => f.id));
    expect(basics.findingIds.every((id) => allIds.has(id))).toBe(true);

    // The duplicate title spans /a and /b: /b points at it without repeating it.
    const b = seoBasics(pages[1], findings);
    const dupId = findings.find((f) => f.rule === 'duplicate-title')!.id;
    expect(b.findingIds).toEqual([dupId]);
    expect(b.hasTitle).toBe(true);
    expect(b.skippedHeadingLevel).toBe(false);

    const c = seoBasics(pages[2], findings);
    expect(c.hasTitle).toBe(false);
    expect(c.htmlLang).toBe('en');
  });

  it('htmlLang is null when the page sets none, and other findings are not cited', () => {
    const p = page('/x', { language: { primary: 'not-identified', others: [], declared: null } });
    const foreign: AuditFinding = {
      id: 'AF-001',
      rule: 'broken-link',
      group: 'technical',
      area: 'usability',
      title: 't',
      detail: 'd',
      suggestion: 's',
      impact: 'high',
      effort: 'low',
      urlPath: '/x',
      sectionId: 's1',
      source: 'rule',
    };
    const basics = seoBasics(p, [foreign]);
    expect(basics.htmlLang).toBeNull();
    expect(basics.findingIds).toEqual([]);
  });
});
