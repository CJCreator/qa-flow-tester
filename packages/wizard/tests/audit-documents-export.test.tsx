import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AUDIT_DOCUMENT_KINDS } from '@qa/types/src/browser.js';
import {
  defaultExportChoice,
  defaultOwnerAuditChoice,
  defaultPitchChoice,
  exportUrl,
  ownerAuditUrl,
  pitchUrl,
  setDocument,
  type ExportChoice,
} from '../src/screens/audit/documents/export-api';
import {
  ExportDocumentsScreen,
  ExportDocumentsView,
  type ExportDocumentsViewProps,
} from '../src/screens/audit/documents/ExportDocumentsScreen';

const AUDIT_ID = 'abcd1234';
const noop = () => {};

function view(props: Partial<ExportDocumentsViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(ExportDocumentsView, {
      auditId: AUDIT_ID,
      choice: defaultExportChoice(),
      pitch: defaultPitchChoice(),
      owner: defaultOwnerAuditChoice(),
      onChoice: noop,
      onPitch: noop,
      onOwner: noop,
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

/** Every link of the markup: its href (decoded) and its text. */
function links(html: string): Array<{ href: string; text: string; attrs: string }> {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: decode(m[1].match(/\shref="([^"]*)"/)?.[1] ?? ''),
    text: textOf(m[2]).trim(),
    attrs: m[1],
  }));
}

function linkStarting(html: string, text: string) {
  const found = links(html).find((l) => l.text.startsWith(text));
  expect(found, text).toBeDefined();
  return found!;
}

function queryOf(href: string): { path: string; query: Record<string, string> } {
  const url = new URL(href, 'http://localhost');
  return { path: url.pathname, query: Object.fromEntries(url.searchParams) };
}

// ---------------------------------------------------------------------------------------------------
// AC-1: the download link carries exactly the picked values
// ---------------------------------------------------------------------------------------------------

describe('Audit Documents download link (REQ-021, REQ-022)', () => {
  it('asks for all five Audit Documents in English Markdown when nothing is changed', () => {
    const link = linkStarting(view(), 'Download the Audit Documents');
    expect(link.attrs).toMatch(/\sdownload(=""|\s|$)/);
    expect(queryOf(link.href)).toEqual({
      path: `/api/audits/${AUDIT_ID}/export`,
      query: { format: 'md', documents: AUDIT_DOCUMENT_KINDS.join(','), language: 'en' },
    });
    expect(AUDIT_DOCUMENT_KINDS).toHaveLength(5);
  });

  it('carries exactly the picked format, documents, language and version', () => {
    let choice: ExportChoice = { ...defaultExportChoice(), format: 'pdf', language: 'ta' };
    for (const kind of ['structure', 'content', 'proposal'] as const) choice = setDocument(choice, kind, false);
    const link = linkStarting(view({ choice, version: 3 }), 'Download the Audit Documents');
    expect(queryOf(link.href)).toEqual({
      path: `/api/audits/${AUDIT_ID}/export`,
      query: { format: 'pdf', documents: 'findings,roadmap', language: 'ta', version: '3' },
    });
    expect(link.text).toBe('Download the Audit Documents (PDF, Tamil)');
  });

  it('keeps the documents in their fixed order whatever order they are ticked in', () => {
    let choice: ExportChoice = { ...defaultExportChoice(), documents: [] };
    choice = setDocument(choice, 'proposal', true);
    choice = setDocument(choice, 'structure', true);
    choice = setDocument(choice, 'structure', true);
    expect(choice.documents).toEqual(['structure', 'proposal']);
    expect(queryOf(exportUrl(AUDIT_ID, { ...choice, format: 'bundle' })!).query).toEqual({
      format: 'bundle',
      documents: 'structure,proposal',
      language: 'en',
    });
  });

  it('shows the ticks and picks of the choice', () => {
    const choice: ExportChoice = { format: 'docx', documents: ['findings'], language: 'ta' };
    const html = view({ choice });
    expect(html).toMatch(/<input id="export-document-findings" type="checkbox"[^>]*checked=""/);
    expect(html).not.toMatch(/<input id="export-document-structure" type="checkbox"[^>]*checked=""/);
    expect(html).toMatch(/<input id="export-format-docx"[^>]*checked=""/);
    expect(html).toMatch(/<input id="export-language-ta"[^>]*checked=""/);
  });

  it('offers no download and says why when no Audit Document is ticked', () => {
    const html = view({ choice: { ...defaultExportChoice(), documents: [] } });
    expect(links(html).some((l) => l.text.startsWith('Download the Audit Documents'))).toBe(false);
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain('Tick at least one Audit Document to download.');
    expect(exportUrl(AUDIT_ID, { ...defaultExportChoice(), documents: [] })).toBeNull();
  });

  it('builds every path through auditPath, so an empty id is refused', () => {
    expect(() => exportUrl('', defaultExportChoice())).toThrow();
    expect(() => pitchUrl('', defaultPitchChoice())).toThrow();
    expect(() => ownerAuditUrl('', defaultOwnerAuditChoice())).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------
// AC-2: formats, Pitch Glimpse, Owner Audit, and nothing that sends
// ---------------------------------------------------------------------------------------------------

describe('what the export panel offers (REQ-019, REQ-025)', () => {
  it('offers Markdown, HTML, PDF, Word and the Claude Code bundle for the Audit Documents', () => {
    const html = view();
    for (const [format, label] of [
      ['md', 'Markdown'],
      ['html', 'HTML'],
      ['pdf', 'PDF'],
      ['docx', 'Word'],
      ['bundle', 'Claude Code bundle'],
    ]) {
      expect(html).toContain(`<label for="export-format-${format}">${label}</label>`);
    }
    for (const kind of AUDIT_DOCUMENT_KINDS) expect(html).toContain(`id="export-document-${kind}"`);
    for (const name of ['Structure', 'Content', 'Findings', 'Improvement Roadmap', 'Proposal']) expect(textOf(html)).toContain(name);
  });

  it('offers a Pitch Glimpse download in English or Tamil, as HTML or PDF', () => {
    const html = view();
    expect(html).toContain('<label for="pitch-language-en">English</label>');
    expect(html).toContain('<label for="pitch-language-ta">Tamil</label>');
    expect(html).toContain('<label for="pitch-format-html">HTML</label>');
    expect(html).toContain('<label for="pitch-format-pdf">PDF</label>');
    expect(queryOf(linkStarting(html, 'Download the Pitch Glimpse').href)).toEqual({
      path: `/api/audits/${AUDIT_ID}/pitch`,
      query: { format: 'pdf', language: 'en' },
    });
    const tamil = view({ pitch: { format: 'html', language: 'ta' }, version: 2 });
    expect(queryOf(linkStarting(tamil, 'Download the Pitch Glimpse').href)).toEqual({
      path: `/api/audits/${AUDIT_ID}/pitch`,
      query: { format: 'html', language: 'ta', version: '2' },
    });
  });

  it('offers an Owner Audit download with its format and language', () => {
    const html = view({ owner: { format: 'docx', language: 'ta' } });
    for (const format of ['md', 'html', 'pdf', 'docx']) expect(html).toContain(`id="owner-format-${format}"`);
    expect(html).not.toContain('id="owner-format-bundle"');
    expect(html).toContain('id="owner-language-en"');
    expect(html).toContain('id="owner-language-ta"');
    expect(queryOf(linkStarting(html, 'Download the Owner Audit').href)).toEqual({
      path: `/api/audits/${AUDIT_ID}/owner`,
      query: { format: 'docx', language: 'ta' },
    });
  });

  it('has no send, email, share-by-message or form control: every link is a GET download of the tool', () => {
    const SENDING = /\b(send\w*|e-?mail\w*|share\w*|message\w*|whatsapp|sms|mailto|post)\b/i;
    for (const html of [view(), view({ choice: { ...defaultExportChoice(), documents: [] } })]) {
      expect(html).not.toMatch(/<form\b/);
      expect(html).not.toMatch(/\saction="/);
      expect(html).not.toMatch(/mailto:|tel:|sms:|wa\.me|whatsapp/i);
      for (const link of links(html)) {
        expect(link.href, link.text).toMatch(new RegExp(`^/api/audits/${AUDIT_ID}/(export|pitch|owner)\\?`));
        expect(link.attrs).toMatch(/\sdownload/);
        expect(link.text).not.toMatch(SENDING);
      }
      for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) expect(textOf(m[1])).not.toMatch(SENDING);
      for (const m of html.matchAll(/aria-label="([^"]*)"/g)) expect(m[1]).not.toMatch(SENDING);
    }
    expect(links(view()).map((l) => l.text.replace(/ \(.*$/, ''))).toEqual([
      'Download the Audit Documents',
      'Download the Pitch Glimpse',
      'Download the Owner Audit',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------
// AC-5: markup and wording
// ---------------------------------------------------------------------------------------------------

/** Avoid words of CONTEXT.md for Website Audit, Audit Document, Improvement Roadmap, Pitch Glimpse and Owner Audit. */
const AVOID_WORDS =
  /\b(reports?|plans?|the three audit documents|enhancement plan|action plan|pitch deck|owner reports?|owner version|client copy|free audit|sales sheet|teaser|cold email|deliverables?|scan\w*|site review|teardown)\b/i;

describe('accessible markup and wording', () => {
  const views = {
    view: view(),
    empty: view({ choice: { ...defaultExportChoice(), documents: [] } }),
    screen: renderToStaticMarkup(createElement(ExportDocumentsScreen, { auditId: AUDIT_ID, version: 2 })),
  };

  it('gives every input a label and groups the choices in fieldsets with a legend', () => {
    for (const [name, html] of Object.entries(views)) {
      const fields = [...html.matchAll(/<(input|textarea|select)\b[^>]*>/g)].map((m) => m[0]);
      expect(fields.length, name).toBe(5 + 2 + 5 + 2 + 2 + 2 + 4);
      for (const field of fields) {
        const id = field.match(/\sid="([^"]+)"/)?.[1];
        expect(id && html.includes(`<label for="${id}"`), field).toBe(true);
      }
      expect((html.match(/<fieldset/g) ?? []).length, name).toBe((html.match(/<legend/g) ?? []).length);
    }
    for (const [group, size] of [
      ['export-language', 2],
      ['export-format', 5],
      ['pitch-language', 2],
      ['pitch-format', 2],
      ['owner-language', 2],
      ['owner-format', 4],
    ] as const) {
      expect((views.view.match(new RegExp(`type="radio" name="${group}"`, 'g')) ?? []).length, group).toBe(size);
    }
    expect(views.view).not.toMatch(/tabindex="-?[1-9]/);
  });

  it('uses no Avoid word in UI text', () => {
    for (const [name, html] of Object.entries(views)) {
      expect(textOf(html), name).not.toMatch(AVOID_WORDS);
      expect(html.match(/aria-label="[^"]*"/g)?.join(' ') ?? '', name).not.toMatch(AVOID_WORDS);
    }
  });

  it('uses the CONTEXT.md terms and has one h1', () => {
    const text = textOf(views.screen);
    for (const term of ['Audit Documents', 'Improvement Roadmap', 'Pitch Glimpse', 'Owner Audit', 'Proposal', 'Website Audit']) {
      expect(text).toContain(term);
    }
    expect((views.screen.match(/<h1/g) ?? []).length).toBe(1);
    expect(text).toContain('Version 2');
    expect(queryOf(linkStarting(views.screen, 'Download the Audit Documents').href).query.version).toBe('2');
  });
});

// ---------------------------------------------------------------------------------------------------
// Imports (T-211)
// ---------------------------------------------------------------------------------------------------

describe('imports (T-211)', () => {
  it('reaches @qa/types through browser.js only, and imports no Node-only module', () => {
    const dir = new URL('../src/screens/audit/documents/', import.meta.url);
    for (const file of ['ExportDocumentsScreen.tsx', 'export-api.ts']) {
      const source = readFileSync(new URL(file, dir), 'utf8');
      const types = [...source.matchAll(/from '(@qa\/types[^']*)'/g)].map((m) => m[1]);
      expect(types.length, file).toBeGreaterThan(0);
      for (const specifier of types) expect(specifier, file).toBe('@qa/types/src/browser.js');
      for (const m of source.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
        expect(m[1], file).toMatch(/^(react$|@qa\/types\/src\/browser\.js$|\.)/);
      }
    }
    const test = readFileSync(new URL('./audit-documents-export.test.tsx', import.meta.url), 'utf8');
    for (const m of test.matchAll(/from '(@qa\/types[^']*)'/g)) expect(m[1]).toBe('@qa/types/src/browser.js');
  });
});
