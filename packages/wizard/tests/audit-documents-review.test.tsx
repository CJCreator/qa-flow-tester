import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AuditFinding, AuditGetReply, AuditResult, EditOverlay, PageContent } from '@qa/types/src/browser.js';
import {
  chooseAction,
  draftToPatch,
  emptyDraft,
  findingRows,
  hierarchyTree,
  isDraftEmpty,
  recommendationRows,
  resetAction,
  resetFinding,
  resetSection,
  sectionRows,
  setFindingField,
  setPageRemoved,
  setSectionText,
  type ReviewDraft,
} from '../src/screens/audit/documents/review-model';
import { loadAudit, loadEdits, loadPageContent, saveEdits } from '../src/screens/audit/documents/review-api';
import {
  ReviewDocumentsScreen,
  ReviewDocumentsView,
  type ReviewDocumentsViewProps,
} from '../src/screens/audit/documents/ReviewDocumentsScreen';

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

const AUDIT_ID = 'abcd1234';

const findings: AuditFinding[] = [
  {
    id: 'AF-001',
    rule: 'duplicate-title',
    group: 'technical',
    area: 'search-ranking',
    title: 'Two pages share a title',
    detail: 'The home page and the services page both use the title "Shop".',
    suggestion: 'Give each page its own title.',
    impact: 'high',
    effort: 'low',
    urlPath: '/',
    sectionId: null,
    pages: ['/', '/services'],
    source: 'rule',
  },
  {
    id: 'AF-002',
    rule: 'missing-alt',
    group: 'content',
    area: 'accessibility',
    title: 'An image has no alt text',
    detail: 'The shop photo has no alt attribute.',
    suggestion: 'Describe the photo in its alt text.',
    impact: 'medium',
    effort: 'low',
    urlPath: '/services',
    sectionId: 's2',
    source: 'ai',
    advisory: true,
  },
];

const result = {
  auditId: AUDIT_ID,
  version: 2,
  url: 'https://shop.example.org/',
  pages: [
    {
      urlPath: '/',
      title: 'Shop',
      depth: 0,
      coverage: 'sample',
      recommendation: {
        urlPath: '/',
        action: 'repair',
        reason: 'The layout works; the text needs work.',
        findingIds: ['AF-001'],
        decidedBy: 'rule',
      },
    },
    { urlPath: '/services', title: 'Services', depth: 1, coverage: 'covered', sampleUrlPath: '/' },
    { urlPath: '/contact', title: null, depth: 1, coverage: 'covered', sampleUrlPath: '/' },
  ],
  hierarchy: {
    root: {
      urlPath: '/',
      title: 'Shop',
      placedBy: 'start',
      children: [
        { urlPath: '/services', title: 'Services', placedBy: 'menu', children: [] },
        { urlPath: '/contact', title: null, placedBy: 'path', children: [] },
        { urlPath: '/services', title: 'Services', placedBy: 'path', children: [] },
      ],
    },
    links: [],
  },
  findings,
  roadmap: [],
} as unknown as AuditResult;

function overlay(over: Partial<EditOverlay> = {}): EditOverlay {
  return { findings: [], sections: [], removedPages: [], recommendations: [], proposal: {}, updatedAt: null, ...over };
}

function getReply(edits: EditOverlay = overlay()): AuditGetReply {
  return {
    summary: { auditId: AUDIT_ID, url: result.url, host: 'shop.example.org', createdAt: '2026-11-01T00:00:00Z', versions: [] },
    version: {
      auditId: AUDIT_ID,
      version: 2,
      url: result.url,
      limits: { maxPages: 50, maxDepth: 3, includePaths: [], excludePaths: [] },
      language: 'en',
      status: 'done',
      startedAt: '2026-11-01T00:00:00Z',
    },
    result,
    edits,
  } as unknown as AuditGetReply;
}

const INTRO = 'Welcome to the shop.\n';
const SERVICES = 'We repair laptops <b>fast</b>.\n';
const content: PageContent = {
  urlPath: '/services',
  title: 'Services',
  description: null,
  text: INTRO + SERVICES,
  headings: [],
  images: [],
  links: [],
  forms: [],
  ctas: [],
  language: { primary: 'en', others: [], declared: 'en' },
  sections: [
    { id: 's1', kind: 'header', start: 0, end: INTRO.length },
    { id: 's2', kind: 'heading', heading: 'Our services', start: INTRO.length, end: INTRO.length + SERVICES.length },
  ],
};

const noop = () => {};

function view(props: Partial<ReviewDocumentsViewProps> = {}): string {
  const edits = props.edits ?? overlay();
  return renderToStaticMarkup(
    createElement(ReviewDocumentsView, {
      reply: getReply(edits),
      edits,
      draft: emptyDraft(),
      selectedPage: null,
      saving: false,
      message: null,
      onDraft: noop,
      onSelectPage: noop,
      onSave: noop,
      onDiscard: noop,
      ...props,
    })
  );
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function textOf(html: string): string {
  return decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}

/** A fetch that records each call and answers with the next queued reply. */
function fakeFetch(...replies: Array<{ status: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error('no reply queued');
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { impl, calls };
}

// ---------------------------------------------------------------------------------------------------
// AC-1: findings
// ---------------------------------------------------------------------------------------------------

describe('editing a finding (REQ-020)', () => {
  it('sends a patch with only the changed text of that finding', () => {
    let draft = setFindingField(emptyDraft(), 'AF-001', 'title', 'Duplicate page titles');
    draft = setFindingField(draft, 'AF-001', 'suggestion', 'Write a title per page.');
    expect(draftToPatch(draft)).toEqual({
      findings: [{ findingId: 'AF-001', title: 'Duplicate page titles', suggestion: 'Write a title per page.' }],
    });
  });

  it('shows the edited text with the original beside it, before and after the save', () => {
    const draft = setFindingField(emptyDraft(), 'AF-002', 'detail', 'The shop photo lacks alt text.');
    const rows = findingRows(result, overlay(), draft);
    expect(rows[1].shown.detail).toBe('The shop photo lacks alt text.');
    expect(rows[1].changed).toEqual(['detail']);
    expect(rows[1].finding.detail).toBe(findings[1].detail);

    const saved = overlay({ findings: [{ findingId: 'AF-002', detail: 'The shop photo lacks alt text.', editedAt: 'x' }] });
    const html = view({ edits: saved });
    expect(html).toMatch(/<textarea id="review-finding-1-detail"[^>]*>The shop photo lacks alt text\.<\/textarea>/);
    const text = textOf(html);
    expect(text).toContain('Original what was found');
    expect(text).toContain(findings[1].detail);
    expect(html).toContain('aria-label="Reset finding AF-002 to the original text"');
    // An unedited finding offers no reset and no original.
    expect(html).not.toContain('aria-label="Reset finding AF-001 to the original text"');
  });

  it('resets a finding with reset: true, and the original shows again', () => {
    const saved = overlay({ findings: [{ findingId: 'AF-001', title: 'Edited', editedAt: 'x' }] });
    const draft = resetFinding(setFindingField(emptyDraft(), 'AF-001', 'title', 'More'), 'AF-001');
    expect(draftToPatch(draft)).toEqual({ findings: [{ findingId: 'AF-001', reset: true }] });
    expect(findingRows(result, saved, draft)[0].shown.title).toBe(findings[0].title);
    // Typing after a reset starts a fresh edit.
    expect(draftToPatch(setFindingField(draft, 'AF-001', 'detail', 'New'))).toEqual({
      findings: [{ findingId: 'AF-001', detail: 'New' }],
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// AC-2: removing a page
// ---------------------------------------------------------------------------------------------------

describe('removing a page from the hierarchy (REQ-020)', () => {
  it('lists the page in removePages and shows it as removed with a restore control', () => {
    const draft = setPageRemoved(emptyDraft(), overlay(), '/contact', true);
    expect(draftToPatch(draft)).toEqual({ removePages: ['/contact'] });
    const tree = hierarchyTree(result, overlay(), draft);
    expect(tree.children.map((c) => [c.urlPath, c.removed])).toEqual([
      ['/services', false],
      ['/contact', true],
    ]);

    const html = view({ draft });
    const contact = html.slice(html.indexOf('data-page="/contact"'));
    expect(textOf(contact)).toContain('Removed from the Audit Documents');
    expect(contact).toContain('aria-label="Restore /contact to the Audit Documents"');
    expect(html).toContain('aria-label="Remove /services from the Audit Documents"');
    // The start page cannot be removed.
    expect(html).not.toContain('aria-label="Remove / from the Audit Documents"');
  });

  it('shows a saved removal as removed, restores it with restorePages, and drops a change back to the saved state', () => {
    const saved = overlay({ removedPages: ['/services'] });
    expect(view({ edits: saved })).toContain('aria-label="Restore /services to the Audit Documents"');
    const restore = setPageRemoved(emptyDraft(), saved, '/services', false);
    expect(draftToPatch(restore)).toEqual({ restorePages: ['/services'] });
    expect(isDraftEmpty(setPageRemoved(restore, saved, '/services', true))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC-3: Section content
// ---------------------------------------------------------------------------------------------------

describe('editing a Section (REQ-020)', () => {
  it('sends the urlPath, sectionId and new text; reset sends reset: true', () => {
    const draft = setSectionText(emptyDraft(), '/services', 's2', 'We repair laptops the same day.');
    expect(draftToPatch(draft)).toEqual({
      sections: [{ urlPath: '/services', sectionId: 's2', text: 'We repair laptops the same day.' }],
    });
    expect(draftToPatch(resetSection(draft, '/services', 's2'))).toEqual({
      sections: [{ urlPath: '/services', sectionId: 's2', reset: true }],
    });
  });

  it('shows each Section with its edit and the original kept beside it, page text escaped', () => {
    const saved = overlay({
      sections: [{ urlPath: '/services', sectionId: 's2', text: 'Same-day laptop repair.', by: 'person', editedAt: 'x' }],
    });
    const rows = sectionRows(content, saved, emptyDraft());
    expect(rows.map((r) => [r.section.id, r.edited])).toEqual([
      ['s1', false],
      ['s2', true],
    ]);
    expect(rows[1].original).toBe(SERVICES);

    const html = view({ edits: saved, selectedPage: '/services', content: { status: 'loaded', content } });
    expect(html).toMatch(/<label for="review-section-1"[^>]*>Text of Section s2: Our services<\/label>/);
    expect(html).toMatch(/<textarea[^>]*id="review-section-1"[^>]*>Same-day laptop repair\.<\/textarea>/);
    expect(html).toContain('We repair laptops &lt;b&gt;fast&lt;/b&gt;.');
    expect(html).not.toContain('<b>fast</b>');
    expect(html).toContain('aria-label="Reset Section s2: Our services to the original text"');
    expect(html).not.toContain('aria-label="Reset Section s1: Header to the original text"');

    const resetRows = sectionRows(content, saved, resetSection(emptyDraft(), '/services', 's2'));
    expect(resetRows[1].shown).toBe(SERVICES);
  });

  it('shows loading, failure and pick-a-page states for the Sections', () => {
    expect(textOf(view())).toContain('Pick a page in the hierarchy');
    expect(view({ selectedPage: '/services', content: { status: 'loading' } })).toContain('role="status"');
    expect(view({ selectedPage: '/services', content: { status: 'failed', message: 'Could not load.' } })).toMatch(
      /role="alert"[^>]*>Could not load\./
    );
  });
});

// ---------------------------------------------------------------------------------------------------
// Redesign or repair
// ---------------------------------------------------------------------------------------------------

describe('redesign or repair per Sample Page (REQ-020)', () => {
  it('lists Sample Pages only, sends the choice, and resets to the proposed one', () => {
    const rows = recommendationRows(result, overlay(), emptyDraft());
    expect(rows.map((r) => [r.urlPath, r.chosen, r.edited])).toEqual([['/', 'repair', false]]);
    const draft = chooseAction(emptyDraft(), '/', 'redesign');
    expect(draftToPatch(draft)).toEqual({ recommendations: [{ urlPath: '/', action: 'redesign' }] });
    expect(draftToPatch(resetAction(draft, '/'))).toEqual({ recommendations: [{ urlPath: '/', reset: true }] });

    const html = view({ draft });
    expect(html).toMatch(/<input id="review-action-0-redesign"[^>]*checked=""/);
    expect(html).toContain('aria-label="Reset / to the proposed choice"');
  });
});

// ---------------------------------------------------------------------------------------------------
// AC-4: markup
// ---------------------------------------------------------------------------------------------------

/** Avoid words of CONTEXT.md for Website Audit, Audit Document, Section and the Improvement Roadmap. */
const AVOID_WORDS =
  /\b(reports?|plans?|enhancement plan|scan\w*|sitemaps?|scrap\w*|blocks?|components?|regions?|teardown|site review|deliverables?)\b/i;

describe('accessible markup and wording', () => {
  const saved = overlay({
    findings: [{ findingId: 'AF-001', title: 'Edited title', editedAt: 'x' }],
    sections: [{ urlPath: '/services', sectionId: 's1', text: 'Hello.', by: 'rewrite', editedAt: 'x' }],
    removedPages: ['/contact'],
    recommendations: [{ urlPath: '/', action: 'redesign', editedAt: 'x' }],
  });
  const draft: ReviewDraft = setFindingField(emptyDraft(), 'AF-002', 'title', 'Changed');
  const views = {
    full: view({ edits: saved, draft, selectedPage: '/services', content: { status: 'loaded', content } }),
    saved: view({ message: { tone: 'pass', text: 'Changes saved. Exports of the Audit Documents now use them.' } }),
    noResult: renderToStaticMarkup(
      createElement(ReviewDocumentsView, {
        reply: { ...getReply(), result: null },
        edits: overlay(),
        draft: emptyDraft(),
        selectedPage: null,
        saving: false,
        message: null,
        onDraft: noop,
        onSelectPage: noop,
        onSave: noop,
        onDiscard: noop,
      })
    ),
    screen: renderToStaticMarkup(createElement(ReviewDocumentsScreen, { auditId: AUDIT_ID })),
  };

  it('gives every input and textarea a label', () => {
    const html = views.full;
    const fields = [...html.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map((m) => m[0]);
    expect(fields.length).toBeGreaterThanOrEqual(6 + 2 + 2);
    for (const field of fields) {
      const id = field.match(/\sid="([^"]+)"/)?.[1];
      const labelled = (id && html.includes(`<label for="${id}"`)) || /\saria-label="[^"]+"/.test(field);
      expect(labelled, field).toBe(true);
    }
  });

  it('gives every button an accessible name, and every button is a real button', () => {
    for (const [name, html] of Object.entries(views)) {
      for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const [, attrs, inner] = match;
        expect(attrs, name).toContain('type="button"');
        const accessible = /aria-label="[^"]+"/.test(attrs) || textOf(inner).trim() !== '';
        expect(accessible, `${name}: ${match[0]}`).toBe(true);
      }
    }
    expect(views.full).not.toMatch(/tabindex="-?[1-9]/);
  });

  it('uses no Avoid word in UI text', () => {
    for (const [name, html] of Object.entries(views)) {
      const text = textOf(html.replace(/\s(id|for|class|name|data-[a-z-]+)="[^"]*"/g, ''));
      expect(text, name).not.toMatch(AVOID_WORDS);
      expect(html.match(/aria-label="[^"]*"/g)?.join(' ') ?? '', name).not.toMatch(AVOID_WORDS);
    }
  });

  it('uses the CONTEXT.md terms and shows the loading state before the Website Audit arrives', () => {
    const all = Object.values(views).map(textOf).join(' ');
    for (const term of ['Website Audit', 'Section', 'Audit Documents', 'Improvement Roadmap', 'Sample Page']) {
      expect(all).toContain(term);
    }
    expect(views.screen).toContain('<h1');
    expect(views.screen).toContain('Loading the Website Audit');
    expect(textOf(views.noResult)).toContain('no results to review');
  });
});

// ---------------------------------------------------------------------------------------------------
// The calls to the runner
// ---------------------------------------------------------------------------------------------------

describe('review-api', () => {
  it('saves with PATCH /api/audits/:id/edits and the version, and returns the saved edits', async () => {
    const edits = overlay({ removedPages: ['/contact'] });
    const { impl, calls } = fakeFetch({ status: 200, body: { edits } });
    const outcome = await saveEdits(AUDIT_ID, { removePages: ['/contact'] }, 2, impl);
    expect(outcome).toEqual({ ok: true, value: edits });
    expect(calls[0].url).toBe(`/api/audits/${AUDIT_ID}/edits?version=2`);
    expect(calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ removePages: ['/contact'] });
  });

  it('loads the audit, the edits and a page Page Content through auditPath', async () => {
    const { impl, calls } = fakeFetch(
      { status: 200, body: getReply() },
      { status: 200, body: { edits: overlay() } },
      { status: 200, body: { content } }
    );
    expect((await loadAudit(AUDIT_ID, undefined, impl)).ok).toBe(true);
    expect((await loadEdits(AUDIT_ID, 2, impl)).ok).toBe(true);
    const page = await loadPageContent(AUDIT_ID, '/services?a=1&b=2', 2, impl);
    expect(page).toEqual({ ok: true, value: content });
    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
      ['GET', `/api/audits/${AUDIT_ID}`],
      ['GET', `/api/audits/${AUDIT_ID}/edits?version=2`],
      ['GET', `/api/audits/${AUDIT_ID}/content?version=2&path=%2Fservices%3Fa%3D1%26b%3D2`],
    ]);
  });

  it('turns refusals, bad replies and a silent runner into plain sentences', async () => {
    const { impl } = fakeFetch(
      { status: 404, body: { error: 'x', code: 'ERR_AUDIT_NOT_FOUND' } },
      { status: 403, body: { error: 'x', code: 'ERR_FORBIDDEN' } },
      { status: 200, body: { nope: true } },
      new Error('offline')
    );
    expect(await loadAudit(AUDIT_ID, undefined, impl)).toMatchObject({ ok: false, code: 'ERR_AUDIT_NOT_FOUND' });
    expect(await saveEdits(AUDIT_ID, {}, 1, impl)).toMatchObject({ ok: false, message: expect.stringMatching(/permission/) });
    expect(await loadEdits(AUDIT_ID, 1, impl)).toEqual({ ok: false, message: 'The saved edits could not be loaded. Try again.' });
    expect(await loadPageContent(AUDIT_ID, '/', 1, impl)).toMatchObject({ ok: false, message: expect.stringMatching(/not answering/) });
  });

  it('refuses a missing audit id before any request', () => {
    expect(() => saveEdits('', {}, 1, fakeFetch().impl)).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// AC-5: imports
// ---------------------------------------------------------------------------------------------------

describe('imports (T-211)', () => {
  it('reaches @qa/types through browser.js only, and imports no Node-only module and no @qa/core', () => {
    const dir = new URL('../src/screens/audit/documents/', import.meta.url);
    // This task's own files; other screens share the folder and are covered by the T-211 guard in browser-entry.test.ts.
    const files = ['ReviewDocumentsScreen.tsx', 'review-api.ts', 'review-model.ts'];
    for (const file of files) expect(existsSync(new URL(file, dir)), file).toBe(true);
    const testFile = new URL('./audit-documents-review.test.tsx', import.meta.url);
    for (const url of [...files.map((f) => new URL(f, dir)), testFile]) {
      const source = readFileSync(url, 'utf8');
      const specifiers = [...source.matchAll(/from '(@qa\/types[^']*)'/g)].map((m) => m[1]);
      expect(specifiers.length, url.pathname).toBeGreaterThan(0);
      for (const specifier of specifiers) expect(specifier, url.pathname).toBe('@qa/types/src/browser.js');
    }
    for (const file of files) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      const imports = [...source.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]);
      for (const specifier of imports) {
        expect(specifier, file).not.toMatch(/^(node:|@qa\/core|@qa\/runner|@qa\/checkers|fs$|path$|child_process$)/);
        expect(specifier, file).toMatch(/^(react$|@qa\/types\/src\/browser\.js$|\.)/);
      }
    }
  });
});
