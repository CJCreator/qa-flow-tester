import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AUDIT_DOCUMENT_KINDS } from '@qa/types/src/browser.js';
import {
  defaultExportChoice,
  defaultOwnerAuditChoice,
  defaultPitchChoice,
  exportBlockedReason,
  exportUrl,
  fallbackFileName,
  fetchDownload,
  fileNameFrom,
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

/** Every button of the markup: its text and attributes. */
function buttons(html: string): Array<{ text: string; attrs: string }> {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({
    text: textOf(m[2]).trim(),
    attrs: m[1],
  }));
}

/** The download button whose text starts with `text`. Downloads are fetched and saved, not plain links. */
function downloadButton(html: string, text: string) {
  const found = buttons(html).find((b) => b.text.startsWith(text));
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
    const button = downloadButton(view(), 'Download the Audit Documents');
    expect(button.attrs).toContain('type="button"');
    expect(button.attrs).not.toContain('disabled');
    expect(queryOf(exportUrl(AUDIT_ID, defaultExportChoice())!)).toEqual({
      path: `/api/audits/${AUDIT_ID}/export`,
      query: { format: 'md', documents: AUDIT_DOCUMENT_KINDS.join(','), language: 'en' },
    });
    expect(AUDIT_DOCUMENT_KINDS).toHaveLength(5);
  });

  it('carries exactly the picked format, documents, language and version', () => {
    let choice: ExportChoice = { ...defaultExportChoice(), format: 'pdf', language: 'ta' };
    for (const kind of ['structure', 'content', 'proposal'] as const) choice = setDocument(choice, kind, false);
    const button = downloadButton(view({ choice, version: 3 }), 'Download the Audit Documents');
    expect(queryOf(exportUrl(AUDIT_ID, choice, 3)!)).toEqual({
      path: `/api/audits/${AUDIT_ID}/export`,
      query: { format: 'pdf', documents: 'findings,roadmap', language: 'ta', version: '3' },
    });
    expect(button.text).toBe('Download the Audit Documents (PDF, Tamil)');
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
    expect(buttons(html).some((b) => b.text.startsWith('Download the Audit Documents'))).toBe(false);
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
  it('offers Markdown, HTML, PDF, Word and the bundle for AI coding tools for the Audit Documents', () => {
    const html = view();
    for (const [format, label] of [
      ['md', 'Markdown'],
      ['html', 'HTML'],
      ['pdf', 'PDF'],
      ['docx', 'Word'],
      ['bundle', 'A bundle for AI coding tools'],
    ]) {
      expect(html).toMatch(new RegExp(`<label for="export-format-${format}"[^>]*>${label}</label>`));
    }
    for (const kind of AUDIT_DOCUMENT_KINDS) expect(html).toContain(`id="export-document-${kind}"`);
    for (const name of ['Structure', 'Content', 'Findings', 'Improvement Roadmap', 'Proposal'])
      expect(textOf(html)).toContain(name);
  });

  it('offers a Pitch Glimpse download in English or Tamil, as HTML or PDF', () => {
    const html = view();
    expect(html).toMatch(/<label for="pitch-language-en"[^>]*>English<\/label>/);
    expect(html).toMatch(/<label for="pitch-language-ta"[^>]*>Tamil<\/label>/);
    expect(html).toMatch(/<label for="pitch-format-html"[^>]*>HTML<\/label>/);
    expect(html).toMatch(/<label for="pitch-format-pdf"[^>]*>PDF<\/label>/);
    expect(downloadButton(html, 'Download the Pitch Glimpse').text).toBe('Download the Pitch Glimpse (PDF, English)');
    expect(queryOf(pitchUrl(AUDIT_ID, defaultPitchChoice()))).toEqual({
      path: `/api/audits/${AUDIT_ID}/pitch`,
      query: { format: 'pdf', language: 'en' },
    });
    const tamil = view({ pitch: { format: 'html', language: 'ta' }, version: 2 });
    expect(downloadButton(tamil, 'Download the Pitch Glimpse').text).toBe('Download the Pitch Glimpse (HTML, Tamil)');
    expect(queryOf(pitchUrl(AUDIT_ID, { format: 'html', language: 'ta' }, 2))).toEqual({
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
    expect(downloadButton(html, 'Download the Owner Audit').text).toBe('Download the Owner Audit (Word, Tamil)');
    expect(queryOf(ownerAuditUrl(AUDIT_ID, { format: 'docx', language: 'ta' }))).toEqual({
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
      expect(links(html)).toEqual([]);
      for (const m of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) expect(textOf(m[1])).not.toMatch(SENDING);
      for (const m of html.matchAll(/aria-label="([^"]*)"/g)) expect(m[1]).not.toMatch(SENDING);
    }
    for (const url of [
      exportUrl(AUDIT_ID, defaultExportChoice())!,
      pitchUrl(AUDIT_ID, defaultPitchChoice()),
      ownerAuditUrl(AUDIT_ID, defaultOwnerAuditChoice()),
    ]) {
      expect(url).toMatch(new RegExp(`^/api/audits/${AUDIT_ID}/(export|pitch|owner)\\?`));
    }
    expect(buttons(view()).map((b) => b.text.replace(/ \(.*$/, ''))).toEqual([
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
    for (const term of [
      'Audit Documents',
      'Improvement Roadmap',
      'Pitch Glimpse',
      'Owner Audit',
      'Proposal',
      'Website Audit',
    ]) {
      expect(text).toContain(term);
    }
    expect((views.screen.match(/<h1/g) ?? []).length).toBe(1);
    expect(text).toContain('Version 2');
    expect(queryOf(exportUrl(AUDIT_ID, defaultExportChoice(), 2)!).query.version).toBe('2');
  });
});

// ---------------------------------------------------------------------------------------------------
// T-70: fetch and save, refusals inline, running version
// ---------------------------------------------------------------------------------------------------

describe('saving a download (T-70)', () => {
  function reply(status: number, body: BodyInit, headers: Record<string, string>) {
    const calls: string[] = [];
    const impl = async (url: string): Promise<Response> => {
      calls.push(url);
      return new Response(body, { status, headers });
    };
    return { impl, calls };
  }

  it('returns the blob and the name from Content-Disposition', async () => {
    const { impl, calls } = reply(200, 'hello', {
      'Content-Type': 'text/markdown',
      'Content-Disposition': 'attachment; filename="site-audit.md"',
    });
    const outcome = await fetchDownload('/api/audits/abcd1234/export?format=md', 'audit-documents.md', impl);
    expect(calls).toEqual(['/api/audits/abcd1234/export?format=md']);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.fileName).toBe('site-audit.md');
      expect(await outcome.blob.text()).toBe('hello');
    }
  });

  it('uses a default name when the reply names none, and strips any folder part', () => {
    expect(fileNameFrom(null, 'audit-documents.md')).toBe('audit-documents.md');
    expect(fileNameFrom('attachment', 'audit-documents.md')).toBe('audit-documents.md');
    expect(fileNameFrom('attachment; filename="../../evil.md"', 'x.md')).toBe('evil.md');
    expect(fileNameFrom("attachment; filename*=UTF-8''site%20audit.pdf", 'x.pdf')).toBe('site audit.pdf');
    expect(fallbackFileName('documents', 'bundle')).toBe('audit-documents.zip');
    expect(fallbackFileName('pitch', 'pdf')).toBe('pitch-glimpse.pdf');
    expect(fallbackFileName('owner', 'docx')).toBe('owner-audit.docx');
  });

  it('shows the runner message of a 4xx JSON reply and saves no file', async () => {
    const message = 'This version of the Website Audit is still running. Download it when it has finished.';
    const { impl } = reply(409, JSON.stringify({ error: message, code: 'ERR_AUDIT_RUNNING' }), {
      'Content-Type': 'application/json',
    });
    const outcome = await fetchDownload('/api/audits/abcd1234/export', 'audit-documents.md', impl);
    expect(outcome).toEqual({ ok: false, message });
    // The screen saves a file only on ok: the refusal carries no blob.
    expect('blob' in outcome).toBe(false);
    const html = view({ error: message });
    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain(message);
  });

  it('falls back to one fixed sentence for a non-JSON refusal, and says when the tool does not answer', async () => {
    const { impl } = reply(500, 'oops', { 'Content-Type': 'text/plain' });
    expect(await fetchDownload('/x', 'a.md', impl)).toEqual({
      ok: false,
      message: 'The file could not be made. Try again.',
    });
    const down = async (): Promise<Response> => {
      throw new Error('offline');
    };
    const outcome = await fetchDownload('/x', 'a.md', down);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain('The tool is not answering');
  });

  it('turns export off with a short reason while the version runs or failed', () => {
    expect(exportBlockedReason('done')).toBeNull();
    expect(exportBlockedReason(undefined)).toBeNull();
    const running = exportBlockedReason('running');
    expect(running).toMatch(/still running/);
    expect(exportBlockedReason('failed')).toMatch(/did not finish/);
    const html = view({ blockedReason: running });
    expect(textOf(html)).toContain(running!);
    for (const text of ['Download the Audit Documents', 'Download the Pitch Glimpse', 'Download the Owner Audit']) {
      expect(downloadButton(html, text).attrs).toContain('disabled=""');
    }
    expect(downloadButton(view(), 'Download the Pitch Glimpse').attrs).not.toContain('disabled');
  });

  it('keeps every download off until the version read has answered', () => {
    const screen = renderToStaticMarkup(createElement(ExportDocumentsScreen, { auditId: AUDIT_ID, version: 2 }));
    expect(textOf(screen)).toContain('Checking this version…');
    for (const text of ['Download the Audit Documents', 'Download the Pitch Glimpse', 'Download the Owner Audit']) {
      expect(downloadButton(screen, text).attrs).toContain('disabled=""');
    }
  });

  it('shows the read failure with a Try again and keeps every download off', () => {
    const html = view({ loadError: 'The tool is not answering.', onRetry: noop });
    expect(textOf(html)).toContain('The tool is not answering.');
    expect(buttons(html).some((b) => b.text === 'Try again')).toBe(true);
    for (const text of ['Download the Audit Documents', 'Download the Pitch Glimpse', 'Download the Owner Audit']) {
      expect(downloadButton(html, text).attrs).toContain('disabled=""');
    }
    expect(textOf(view())).not.toContain('Checking this version…');
  });

  it('shows a Back link to all Website Audits, the audit tabs and a link to Audit settings', () => {
    const screen = renderToStaticMarkup(createElement(ExportDocumentsScreen, { auditId: AUDIT_ID, version: 2 }));
    expect(links(screen).find((l) => l.text.endsWith('All Website Audits'))?.href).toBe('/audits');
    expect(links(screen).find((l) => l.text === 'Documents')?.href).toBe(`/audits/${AUDIT_ID}/versions/2/review`);
    expect(links(screen).find((l) => l.text === 'Audit settings')?.href).toBe('/audit-settings');
    expect(screen).toMatch(/<h1[^>]*>Download documents<\/h1>/);
  });

  it('shows the result beside the button that was pressed, and names the bundle plainly', () => {
    const done = view({ done: { kind: 'pitch', fileName: 'pitch-glimpse.pdf' } });
    expect(textOf(done)).toContain('Downloaded: pitch-glimpse.pdf');
    expect(done.match(/role="status"/g)?.length).toBe(1);
    const failed = view({ error: 'The file could not be made. Try again.', errorKind: 'owner' });
    expect(failed.match(/role="alert"/g)?.length).toBe(1);
    expect(textOf(view())).toContain('Details for developers');
    expect(textOf(view())).not.toMatch(/Claude Code bundle/);
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
