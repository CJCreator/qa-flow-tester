import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { OverlapFlag, PageContent, RewriteState } from '@qa/types/src/browser.js';
import {
  AI_UNAVAILABLE,
  NO_AI_KEY,
  NOT_ANSWERING,
  acceptNewCopy,
  approveRewrite,
  listRewrites,
  markCopiedPhrases,
  wordCountText,
  writeNewCopy,
} from '../src/screens/audit/ai/rewrite-api';
import {
  APPROVE_FIRST,
  AUDIT_DOCUMENTS_ONLY,
  RewriteReview,
  RewriteReviewView,
  type RewriteReviewViewProps,
} from '../src/screens/audit/ai/RewriteReview';

// ---------------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------------

const AUDIT_ID = 'abcd1234';
const ORIGINAL = 'We bake fresh bread every single morning in our small shop.';
const FOOTER = 'Call us today.';

const content: PageContent = {
  urlPath: '/about',
  title: 'About',
  description: null,
  text: ORIGINAL + FOOTER,
  headings: [],
  images: [],
  links: [],
  forms: [],
  ctas: [],
  language: { primary: 'en', others: [], declared: 'en' },
  sections: [
    { id: 's1', kind: 'main', heading: 'Our bakery', start: 0, end: ORIGINAL.length },
    { id: 's2', kind: 'footer', start: ORIGINAL.length, end: ORIGINAL.length + FOOTER.length },
  ],
};

const FLAG: OverlapFlag = { words: 'fresh bread every single morning in', wordCount: 6 };
const PROPOSAL = 'Each day we offer Fresh bread, every single morning in town.';

function state(over: Partial<RewriteState> = {}): RewriteState {
  return { urlPath: '/about', sectionId: 's1', approvedAt: null, proposal: null, acceptedAt: null, ...over };
}

const approved = state({ approvedAt: '2026-11-01T10:00:00.000Z' });
const proposed = state({
  approvedAt: '2026-11-01T10:00:00.000Z',
  proposal: { text: PROPOSAL, language: 'en', overlaps: [FLAG], createdAt: '2026-11-01T10:01:00.000Z' },
});

const noop = () => {};

function renderView(props: Partial<RewriteReviewViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(RewriteReviewView, {
      content,
      rewrites: {},
      drafts: {},
      busy: {},
      messages: {},
      onApprove: noop,
      onWrite: noop,
      onDraft: noop,
      onAccept: noop,
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

/** The opening tag of the button with this accessible name. */
function button(html: string, name: string): string {
  const tag = html.match(new RegExp(`<button[^>]*aria-label="${name}"[^>]*>`))?.[0];
  expect(tag, name).toBeDefined();
  return tag!;
}

/** A fetch that records each call and answers with the next queued reply. */
function fakeFetch(...replies: Array<{ status: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error('no reply queued');
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { impl, calls };
}

// ---------------------------------------------------------------------------------------------------
// AC-1: approve before writing
// ---------------------------------------------------------------------------------------------------

describe('approval before a rewrite (REQ-030 AC-1)', () => {
  it('disables Write new copy until the Section is approved, and says why', () => {
    const html = renderView();
    expect(button(html, 'Write new copy for Section s1: Our bakery')).toMatch(/disabled=""/);
    expect(button(html, 'Approve rewrite of Section s1: Our bakery')).not.toMatch(/disabled/);
    expect(textOf(html)).toContain(APPROVE_FIRST);
    expect(button(html, 'Write new copy for Section s1: Our bakery')).toMatch(
      /aria-describedby="rewrite-section-0-approve-first"/
    );
  });

  it('enables Write new copy once approved and drops the Approve rewrite control', () => {
    const html = renderView({ rewrites: { s1: approved } });
    expect(button(html, 'Write new copy for Section s1: Our bakery')).not.toMatch(/disabled/);
    expect(html).not.toContain('aria-label="Approve rewrite of Section s1: Our bakery"');
    expect(textOf(html)).toContain('Approved for a rewrite');
    // The other Section is still not approved.
    expect(button(html, 'Write new copy for Section s2: Footer')).toMatch(/disabled=""/);
  });

  it('sends no rewrite request without an approval', async () => {
    const fake = fakeFetch({ status: 200, body: { rewrite: proposed } });
    const none = await writeNewCopy(AUDIT_ID, undefined, { urlPath: '/about', sectionId: 's1' }, fake.impl);
    const notApproved = await writeNewCopy(AUDIT_ID, state(), { urlPath: '/about', sectionId: 's1' }, fake.impl);
    expect(fake.calls).toHaveLength(0);
    expect(none).toMatchObject({ ok: false, code: 'ERR_NOT_APPROVED' });
    expect(notApproved).toMatchObject({ ok: false, code: 'ERR_NOT_APPROVED' });
  });

  it('sends the rewrite request once approved', async () => {
    const fake = fakeFetch({ status: 200, body: { rewrite: proposed } });
    const outcome = await writeNewCopy(
      AUDIT_ID,
      approved,
      { urlPath: '/about', sectionId: 's1', version: 2, language: 'en' },
      fake.impl
    );
    expect(outcome).toEqual({ ok: true, value: proposed });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.url).toBe(`/api/audits/${AUDIT_ID}/rewrite`);
    expect(fake.calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(fake.calls[0]!.init?.body))).toEqual({
      urlPath: '/about',
      sectionId: 's1',
      version: 2,
      language: 'en',
    });
  });

  it('approves a Section through the approve route', async () => {
    const fake = fakeFetch({ status: 200, body: { rewrite: approved } });
    const outcome = await approveRewrite(AUDIT_ID, { urlPath: '/about', sectionId: 's1' }, fake.impl);
    expect(outcome).toEqual({ ok: true, value: approved });
    expect(fake.calls[0]!.url).toBe(`/api/audits/${AUDIT_ID}/rewrite/approve`);
    expect(fake.calls[0]!.init?.method).toBe('POST');
  });

  it('lists the saved rewrites of a version and drops malformed ones', async () => {
    const fake = fakeFetch({ status: 200, body: { rewrites: [proposed, { urlPath: 3 }] } });
    const outcome = await listRewrites(AUDIT_ID, 2, fake.impl);
    expect(outcome).toEqual({ ok: true, value: [proposed] });
    expect(fake.calls[0]!.url).toBe(`/api/audits/${AUDIT_ID}/rewrite?version=2`);
  });
});

// ---------------------------------------------------------------------------------------------------
// Refusals in plain words
// ---------------------------------------------------------------------------------------------------

describe('refusals', () => {
  it('shows ERR_NO_AI_KEY as the Settings sentence', async () => {
    const fake = fakeFetch({
      status: 409,
      body: { error: 'Add an AI key to write new copy for this Section.', code: 'ERR_NO_AI_KEY' },
    });
    const outcome = await writeNewCopy(AUDIT_ID, approved, { urlPath: '/about', sectionId: 's1' }, fake.impl);
    expect(outcome).toEqual({ ok: false, message: NO_AI_KEY, code: 'ERR_NO_AI_KEY' });
    expect(NO_AI_KEY).toBe('Add an AI key in Settings to write new copy.');
    const html = renderView({ rewrites: { s1: approved }, messages: { s1: { tone: 'fail', text: NO_AI_KEY } } });
    expect(html).toMatch(/role="alert"[^>]*>Add an AI key in Settings to write new copy\.</);
  });

  it('shows an AI failure as the reply sentence, or a generic one when there is none', async () => {
    const said = fakeFetch({ status: 502, body: { error: 'The AI is not available right now. Try again later.' } });
    expect(await writeNewCopy(AUDIT_ID, approved, { urlPath: '/about', sectionId: 's1' }, said.impl)).toMatchObject({
      ok: false,
      message: 'The AI is not available right now. Try again later.',
    });
    const silent = fakeFetch({ status: 502, body: {} });
    expect(await writeNewCopy(AUDIT_ID, approved, { urlPath: '/about', sectionId: 's1' }, silent.impl)).toMatchObject({
      ok: false,
      message: AI_UNAVAILABLE,
    });
  });

  it('says the tool is not answering when the request fails', async () => {
    const fake = fakeFetch(new Error('offline'));
    expect(await approveRewrite(AUDIT_ID, { urlPath: '/about', sectionId: 's1' }, fake.impl)).toEqual({
      ok: false,
      message: NOT_ANSWERING,
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// AC-2: copied phrases and the refused accept
// ---------------------------------------------------------------------------------------------------

describe('copied phrases (REQ-030 AC-2)', () => {
  it('marks a flagged phrase without letter case or punctuation mattering', () => {
    const pieces = markCopiedPhrases(PROPOSAL, [FLAG]);
    expect(pieces).toEqual([
      { text: 'Each day we offer ', copied: false },
      { text: 'Fresh bread, every single morning in', copied: true },
      { text: ' town.', copied: false },
    ]);
    expect(pieces.map((p) => p.text).join('')).toBe(PROPOSAL);
  });

  it('marks every occurrence, merges touching phrases and leaves text without flags whole', () => {
    const text = 'one two three. One two three four';
    expect(
      markCopiedPhrases(text, [
        { words: 'one two three', wordCount: 3 },
        { words: 'three four', wordCount: 2 },
      ])
    ).toEqual([
      { text: 'one two three', copied: true },
      { text: '. ', copied: false },
      { text: 'One two three four', copied: true },
    ]);
    expect(markCopiedPhrases(text, [])).toEqual([{ text, copied: false }]);
    expect(markCopiedPhrases('', [FLAG])).toEqual([]);
  });

  it('matches words of other scripts and inner apostrophes like the runner', () => {
    const tamil = 'நாங்கள் தினமும் புதிய ரொட்டி சுடுகிறோம்';
    expect(markCopiedPhrases(tamil, [{ words: 'புதிய ரொட்டி', wordCount: 2 }]).find((p) => p.copied)?.text).toBe(
      'புதிய ரொட்டி'
    );
    expect(markCopiedPhrases("We're open daily", [{ words: 'were open', wordCount: 2 }])[0]).toEqual({
      text: "We're open",
      copied: true,
    });
  });

  it('highlights each flagged phrase in a mark element and lists it with its word count', () => {
    const html = renderView({ rewrites: { s1: proposed } });
    expect(html).toContain('<mark class="');
    expect(html).toMatch(
      /<mark[^>]*aria-label="Copied phrase: Fresh bread, every single morning in"[^>]*>Fresh bread, every single morning in<\/mark>/
    );
    expect(textOf(html)).toContain('Copied phrases (1)');
    expect(textOf(html)).toContain('fresh bread every single morning in : 6 words');
    expect(wordCountText(1)).toBe('1 word');
    // The textarea starts from the proposal and has a label.
    expect(html).toMatch(/<label for="rewrite-section-0"[^>]*>New copy for Section s1: Our bakery<\/label>/);
    expect(html).toMatch(
      /<textarea id="rewrite-section-0"[^>]*>Each day we offer Fresh bread, every single morning in town\.<\/textarea>/
    );
  });

  it('says so when the proposal copies no phrase', () => {
    const clean = state({ ...proposed, proposal: { ...proposed.proposal!, text: 'Warm loaves daily.', overlaps: [] } });
    const html = renderView({ rewrites: { s1: clean } });
    expect(textOf(html)).toContain('No phrases copied from the original.');
    expect(html).not.toContain('<mark');
  });

  it('returns the server ERR_OVERLAP message with the phrases still copied', async () => {
    const message = 'This copy still repeats phrases from the original. Reword the marked phrases.';
    const fake = fakeFetch({
      status: 422,
      body: { error: message, code: 'ERR_OVERLAP', overlaps: [FLAG, { bad: true }] },
    });
    const outcome = await acceptNewCopy(AUDIT_ID, { urlPath: '/about', sectionId: 's1', text: PROPOSAL }, fake.impl);
    expect(outcome).toEqual({ ok: false, message, code: 'ERR_OVERLAP', overlaps: [FLAG] });
    expect(fake.calls[0]!.url).toBe(`/api/audits/${AUDIT_ID}/rewrite/accept`);
    expect(JSON.parse(String(fake.calls[0]!.init?.body))).toEqual({
      urlPath: '/about',
      sectionId: 's1',
      text: PROPOSAL,
    });
  });

  it('shows the ERR_OVERLAP refusal and keeps the edited text', () => {
    const edited = 'We now offer fresh bread every single morning in the shop.';
    const html = renderView({
      rewrites: { s1: proposed },
      drafts: { s1: edited },
      messages: {
        s1: {
          tone: 'fail',
          text: 'This copy still repeats phrases from the original. Reword the marked phrases.',
          overlaps: [FLAG],
        },
      },
    });
    expect(html).toMatch(
      /role="alert"[^>]*>This copy still repeats phrases from the original\. Reword the marked phrases\.</
    );
    expect(html).toMatch(new RegExp(`<textarea id="rewrite-section-0"[^>]*>${edited}</textarea>`));
    expect(textOf(html)).toContain('Phrases still copied (1)');
    expect(html).toMatch(/<mark[^>]*aria-label="Copied phrase: fresh bread every single morning in"/);
  });

  it('disables Accept while working or when the copy is empty', () => {
    expect(
      button(renderView({ rewrites: { s1: proposed } }), 'Accept new copy for Section s1: Our bakery')
    ).not.toMatch(/disabled/);
    expect(
      button(
        renderView({ rewrites: { s1: proposed }, drafts: { s1: '  ' } }),
        'Accept new copy for Section s1: Our bakery'
      )
    ).toMatch(/disabled=""/);
    expect(
      button(
        renderView({ rewrites: { s1: proposed }, busy: { s1: 'accepting' } }),
        'Accept new copy for Section s1: Our bakery'
      )
    ).toMatch(/disabled=""/);
  });
});

// ---------------------------------------------------------------------------------------------------
// Markup and wording
// ---------------------------------------------------------------------------------------------------

/** Avoid words of CONTEXT.md for Website Audit, Audit Document and Section. */
const AVOID_WORDS =
  /\b(reports?|plans?|scan\w*|scrap\w*|blocks?|components?|regions?|teardown|site review|deliverables?|check-up|negative test|positive test|happy path|categor(y|ies))\b/i;

describe('accessible markup and wording', () => {
  const screens = {
    empty: renderView(),
    proposed: renderView({ rewrites: { s1: proposed } }),
    refused: renderView({
      rewrites: { s1: proposed },
      messages: { s1: { tone: 'fail', text: NO_AI_KEY, overlaps: [FLAG] } },
    }),
    accepted: renderView({
      rewrites: { s1: { ...proposed, acceptedAt: '2026-11-01T11:00:00.000Z' } },
      messages: { s1: { tone: 'pass', text: 'Accepted. The new copy is in the Audit Documents.' } },
    }),
  };

  it('says new copy goes into the Audit Documents only', () => {
    expect(AUDIT_DOCUMENTS_ONLY).toBe('New copy goes into the Audit Documents only, never onto the site.');
    for (const html of Object.values(screens)) expect(textOf(html)).toContain(AUDIT_DOCUMENTS_ONLY);
    expect(textOf(screens.accepted)).toContain('Accepted copy is in the Audit Documents.');
  });

  it('uses typed buttons with accessible names, reachable by keyboard', () => {
    for (const [name, html] of Object.entries(screens)) {
      for (const tag of html.match(/<button[^>]*>/g) ?? []) {
        expect(tag, name).toContain('type="button"');
        expect(tag, name).toMatch(/aria-label="[^"]+"/);
        expect(tag, name).not.toMatch(/tabindex="-1"/);
      }
    }
  });

  it('uses no Avoid word in UI text or labels', () => {
    for (const [name, html] of Object.entries(screens)) {
      expect(textOf(html), name).not.toMatch(AVOID_WORDS);
      expect(html.match(/aria-label="[^"]*"/g)?.join(' ') ?? '', name).not.toMatch(AVOID_WORDS);
    }
  });

  it('escapes page text and AI copy instead of rendering it as markup', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const page = {
      ...content,
      text: evil,
      sections: [{ id: 's1', kind: 'main' as const, start: 0, end: evil.length }],
    };
    const html = renderView({
      content: page,
      rewrites: { s1: { ...proposed, proposal: { ...proposed.proposal!, text: evil, overlaps: [] } } },
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('shows a Section without text without rewrite controls', () => {
    const page = { ...content, sections: [{ id: 's1', kind: 'page' as const, start: 0, end: 0 }] };
    const html = renderView({ content: page });
    expect(textOf(html)).toContain('This Section has no text to rewrite.');
    expect(html).not.toContain('<button');
  });

  it('shows a loading state before the saved rewrites arrive', () => {
    const html = renderToStaticMarkup(
      createElement(RewriteReview, { auditId: AUDIT_ID, content, fetchImpl: fakeFetch().impl })
    );
    expect(html).toContain('role="status"');
    expect(textOf(html)).toContain('Loading the saved rewrites');
  });
});

describe('imports (T-211)', () => {
  it('reaches @qa/types through browser.js only and imports no Node-only module', () => {
    const dir = new URL('../src/screens/audit/ai/', import.meta.url);
    const files = ['RewriteReview.tsx', 'rewrite-api.ts'];
    for (const url of [
      ...files.map((f) => new URL(f, dir)),
      new URL('./audit-rewrite-review.test.tsx', import.meta.url),
    ]) {
      const source = readFileSync(url, 'utf8');
      const specifiers = [...source.matchAll(/from '(@qa\/types[^']*)'/g)].map((m) => m[1]);
      expect(specifiers.length, url.pathname).toBeGreaterThan(0);
      for (const specifier of specifiers) expect(specifier, url.pathname).toBe('@qa/types/src/browser.js');
    }
    for (const file of files) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      const imports = [...source.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]);
      for (const specifier of imports) expect(specifier, file).toMatch(/^(react$|@qa\/types\/src\/browser\.js$|\.)/);
    }
  });
});
