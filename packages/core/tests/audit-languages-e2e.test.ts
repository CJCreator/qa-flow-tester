/**
 * QA-711: Tamil and Hindi through extraction, audit and documents (REQ-044, REQ-032 AC-1), against
 * fixtures/audit-site. The real audit crawl (BE-204) and pipeline (BE-192) run in Chromium; the browser reaches
 * the fixture as http://kaveri.test:<port> through a host-resolver rule and the production public-only guard
 * sees a fake DNS (the same seam audit-crawl.test.ts uses). No real network. Browser test (QA-713 lists it).
 *
 * Hindi documents follow DEC-005: until every document builder has Hindi wording, a Hindi Audit Document is
 * written entirely in English (lang="en", dir="ltr") with an English "Beta translation" note, while
 * `documentText('hi', ...)` still returns Hindi. Tamil documents are in Tamil, with no beta label.
 *
 * PDF glyph shaping is not asserted here (checked by hand, waiver).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import {
  AUDIT_DOCUMENT_KINDS,
  sectionText,
  type AuditPage,
  type AuditRequest,
  type AuditResult,
  type DocumentLanguage,
  type PageContent,
} from '@qa/types';
import { runAuditCrawl, type AuditCrawlDeps } from '../src/audit/crawl/index.js';
import type { PageSpeed } from '@qa/types';
import type { SampleSpeed } from '../src/audit/ai/pagespeed.js';
import { createPageRecorder, runAuditPipeline } from '../src/audit/pipeline/index.js';
import { readPage } from '../src/audit/analysis/read-page.js';
import { defaultNetDeps, type NetDeps } from '../src/safe-net.js';
import { emptyOverlay } from '../src/audit/documents/edits.js';
import {
  generateAuditDocuments,
  generateOwnerAudit,
  type AuditDocumentsInput,
} from '../src/audit/documents/generate.js';
import { buildSiteJson } from '../src/audit/documents/site-json.js';
import { editedViewOf } from '../src/audit/documents/generate.js';
import { exportAudit } from '../src/audit/documents/bundle.js';
import { renderHtml } from '../src/audit/documents/render-html.js';
import { renderMarkdown } from '../src/audit/documents/render-markdown.js';
import { documentBetaNote, documentText, labelsFor } from '../src/audit/documents/labels/index.js';
import { emptyAuditSettings, resolveAuditSettings } from '../src/audit/documents/settings.js';
import { AUDIT_SITE_ROOT, startAuditSite, type AuditSiteServer } from './helpers/audit-site-server.js';

const mammoth = createRequire(import.meta.url)('mammoth') as {
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
};

const FFFD = '�';
const ZWNJ = '‌';
const ZWJ = '‍';
const NOW = '2026-11-03T10:00:00.000Z';

let browser: Browser;
let site: AuditSiteServer;
let zwServer: http.Server;
let workDir: string;
let result: AuditResult;
const contents = new Map<string, PageContent>();
let allContents: PageContent[];
let zwContent: PageContent;

/** Code points as "U+0B95 U+0BCD ...": a failure names the exact character that differs. */
const cps = (s: string) =>
  Array.from(s, (c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(' ');
const sameCodePoints = (actual: string, expected: string) => expect(cps(actual)).toBe(cps(expected));

/** Text blocks of a fixture page, read from the HTML source itself (independent of the extractor). */
async function fixtureBlocks(file: string) {
  const html = await fs.readFile(path.join(AUDIT_SITE_ROOT, file), 'utf8');
  const body = html.slice(html.indexOf('<body>'));
  const clean = (s: string) =>
    s
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const all = (tag: string) =>
    [...body.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => clean(m[1]!));
  return {
    h1: all('h1'),
    h2: all('h2'),
    items: all('li'),
    paragraphs: all('p'),
    anchors: all('a').filter((t) => t !== ''),
  };
}

const ZW_TAMIL = `க்${ZWNJ}ஷேத்ரம்`;
const ZW_HINDI_ZWJ = `क्${ZWJ}ष`;
const ZW_HINDI_ZWNJ = `क्${ZWNJ}ष`;

beforeAll(async () => {
  site = await startAuditSite();
  zwServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><html lang="ta"><head><meta charset="utf-8"><title>${ZW_TAMIL}</title></head><body><main>` +
        `<h1>${ZW_TAMIL}</h1><p>${ZW_HINDI_ZWJ} ${ZW_HINDI_ZWNJ} ${ZW_TAMIL}</p></main></body></html>`
    );
  });
  await new Promise<void>((resolve) => zwServer.listen(0, '127.0.0.1', resolve));

  browser = await chromium.launch({ args: ['--host-resolver-rules=MAP kaveri.test 127.0.0.1'] });
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-lang-e2e-'));
  const netDeps: NetDeps = {
    async lookup(host) {
      if (host === 'kaveri.test') return ['93.184.216.34'];
      throw new Error('ENOTFOUND');
    },
    connect: (req) => defaultNetDeps.connect({ ...req, address: '127.0.0.1' }),
  };
  const browserManager: AuditCrawlDeps['browserManager'] = {
    async createContext(): Promise<BrowserContext> {
      return browser.newContext();
    },
  };
  const request: AuditRequest = {
    url: `http://kaveri.test:${site.port}/`,
    limits: { maxPages: 200, maxDepth: 8, includePaths: [], excludePaths: [] },
    language: 'en',
  };
  const recorder = createPageRecorder({ workDir });
  const crawl = await runAuditCrawl(request, {
    onRenderedPage: recorder.onRenderedPage,
    deps: { browserManager, netDeps },
  });
  const notMeasured: PageSpeed = {
    lab: { status: 'not-measured', source: 'pagespeed-insights', method: 'lab', reason: 'no-network' },
    field: { status: 'not-measured', source: 'pagespeed-insights', method: 'field', reason: 'no-field-data' },
  };
  const outcome = await runAuditPipeline(crawl, {
    auditId: 'audit_lang_0001',
    version: 1,
    request,
    startedAt: '2026-11-03T00:00:00.000Z',
    recorder,
    workDir,
    netDeps,
    // In-memory store: the pipeline returns the result too, so nothing needs to be read back.
    store: {
      saveResult: async () => {},
      writeVersionJson: async () => {},
      putVersionFile: async () => {},
      updateVersion: async () => ({}) as never,
    } as never,
    // PageSpeed is a network call to Google: not made here.
    stages: {
      measureSampleSpeeds: async (pages: readonly string[]): Promise<SampleSpeed[]> =>
        pages.map((url) => ({ url, speed: notMeasured })),
    },
  });
  result = outcome.result;
  for (const p of recorder.pages) if (p.read) contents.set(p.info.urlPath, p.read.content);

  // A page with ZWNJ and ZWJ in its text, read like any crawled page (the fixture has none).
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${(zwServer.address() as { port: number }).port}/zw`);
    zwContent = { ...(await readPage(page)).content, urlPath: '/zw' };
  } finally {
    await ctx.close();
  }
  const ta = result.pages.find((p) => p.urlPath === '/ta') as AuditPage;
  const zwPage: AuditPage = {
    ...ta,
    urlPath: '/zw',
    title: zwContent.title,
    sections: zwContent.sections.map((s) => ({
      id: s.id,
      kind: s.kind,
      ...(s.heading ? { heading: s.heading } : {}),
    })) as never,
  };
  result = { ...result, pages: [...result.pages, zwPage] };
  contents.set('/zw', zwContent);
  allContents = [...contents.values()];
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await site?.close();
  await new Promise<void>((resolve) => (zwServer ? zwServer.close(() => resolve()) : resolve()));
  if (workDir) await fs.rm(workDir, { recursive: true, force: true });
});

const settings = () => resolveAuditSettings(emptyAuditSettings(), false);
const input = (language: DocumentLanguage, documents?: AuditDocumentsInput['documents']): AuditDocumentsInput => ({
  result,
  contents: allContents,
  edits: emptyOverlay(),
  settings: settings(),
  language,
  ...(documents ? { documents } : {}),
  now: NOW,
});

const PAGES = [
  { name: 'Tamil', urlPath: '/ta', file: 'ta/index.html', language: 'ta' as const },
  { name: 'Hindi', urlPath: '/hi', file: 'hi/index.html', language: 'hi' as const },
];

describe('language detection (REQ-013, REQ-032 AC-1)', () => {
  it('the audit crawled the English, Tamil and Hindi pages', () => {
    for (const p of ['/', '/ta', '/hi'])
      expect(
        result.pages.some((x) => x.urlPath === p),
        p
      ).toBe(true);
  });

  it('identifies the English page as en and the Tamil page as ta', () => {
    expect(result.pages.find((p) => p.urlPath === '/')!.language).toMatchObject({ primary: 'en', declared: 'en' });
    expect(result.pages.find((p) => p.urlPath === '/ta')!.language).toMatchObject({ primary: 'ta', declared: 'ta' });
  });

  it('identifies the Hindi page as hi', () => {
    expect(result.pages.find((p) => p.urlPath === '/hi')!.language).toMatchObject({ primary: 'hi', declared: 'hi' });
  });
});

describe.each(PAGES)('$name page text, code point for code point (REQ-044 AC-1)', ({ urlPath, file, language }) => {
  it('headings, Section headings, links and text blocks equal the rendered page text', async () => {
    const expected = await fixtureBlocks(file);
    const content = contents.get(urlPath)!;
    expect(content).toBeDefined();

    expect(content.headings.map((h) => h.text).length).toBe(expected.h1.length + expected.h2.length);
    sameCodePoints(content.headings.map((h) => h.text).join('|'), [...expected.h1, ...expected.h2].join('|'));

    const sectionHeadings = content.sections.map((s) => s.heading).filter((h): h is string => !!h);
    sameCodePoints(sectionHeadings.join('|'), [...expected.h1, ...expected.h2].join('|'));

    const lines = content.text.split('\n');
    for (const block of [...expected.h1, ...expected.h2, ...expected.items, ...expected.paragraphs]) {
      expect(lines, `a text line equal to: ${block.slice(0, 20)}`).toContain(block);
    }
    const linkTexts = content.links.map((l) => l.text);
    for (const anchor of expected.anchors.filter((a) => /\p{L}/u.test(a) && a.length < 40)) {
      expect(linkTexts, `a link with text ${anchor}`).toContain(anchor);
    }
    expect(JSON.stringify(content)).not.toContain(FFFD);
    expect(content.language.declared).toBe(language);
  });

  it('keeps the same text in the Markdown and site.json exports', () => {
    const content = contents.get(urlPath)!;
    const view = editedViewOf(input(language));
    const site = JSON.stringify(buildSiteJson(view));
    expect(site).not.toContain(FFFD);
    const json = buildSiteJson(view);
    const page = json.pages.find((p) => p.urlPath === urlPath)!;
    for (const s of content.sections) {
      const own = page.sections.find((x) => x.id === s.id)!;
      expect(own.text).not.toBeNull();
      sameCodePoints(own.text!, sectionText(content, s));
      if (s.heading) sameCodePoints(own.heading!, s.heading);
    }
    // The JSON that is written and read back keeps the code points too.
    const reread = (JSON.parse(JSON.stringify(json)) as typeof json).pages.find((p) => p.urlPath === urlPath)!;
    sameCodePoints(reread.sections.map((s) => s.text).join('|'), page.sections.map((s) => s.text).join('|'));

    const md = renderMarkdown(generateAuditDocuments(input(language, ['content']))[0]!);
    expect(md).not.toContain(FFFD);
    for (const line of content.text.split('\n').filter((l) => /\p{L}/u.test(l))) {
      expect(md, `Markdown line: ${line.slice(0, 20)}`).toContain(line);
    }
  });

  it('keeps the same text in the Word export, read back with mammoth', async () => {
    const content = contents.get(urlPath)!;
    const file = await exportAudit('docx', input(language, ['content']));
    expect(file.body.subarray(0, 2).toString('latin1')).toBe('PK');
    const { value } = await mammoth.extractRawText({ buffer: file.body });
    expect(value).not.toContain(FFFD);
    for (const line of content.text.split('\n').filter((l) => /\p{L}/u.test(l))) {
      expect(value, `Word line: ${line.slice(0, 20)}`).toContain(line);
    }
  });
});

describe('ZWNJ and ZWJ survive extraction and every export (REQ-044 AC-1)', () => {
  const content = () => zwContent;

  it('extraction keeps the joiners exactly where the page has them', () => {
    expect(content().headings[0]!.text).toBe(ZW_TAMIL);
    sameCodePoints(content().text, `${ZW_TAMIL}\n${ZW_HINDI_ZWJ} ${ZW_HINDI_ZWNJ} ${ZW_TAMIL}`);
    expect(content().text).toContain(ZWNJ);
    expect(content().text).toContain(ZWJ);
    expect(content().text).not.toContain(FFFD);
  });

  it('Markdown, site.json and Word hold the same code points', async () => {
    const section = content()
      .sections.map((s) => sectionText(content(), s))
      .join('');
    expect(section).toContain(ZWJ);
    const json = buildSiteJson(editedViewOf(input('ta')));
    const page = json.pages.find((p) => p.urlPath === '/zw')!;
    sameCodePoints(page.sections.map((s) => s.text).join(''), section);

    const md = renderMarkdown(generateAuditDocuments(input('ta', ['content']))[0]!);
    const { value } = await mammoth.extractRawText({
      buffer: (await exportAudit('docx', input('ta', ['content']))).body,
    });
    for (const line of content().text.split('\n')) {
      expect(md).toContain(line);
      expect(value).toContain(line);
    }
  });
});

describe('findings for Tamil and Hindi pages, as for the English page (REQ-044 AC-2)', () => {
  const home = () => result.pages.find((p) => p.urlPath === '/')!;

  it.each(['/ta', '/hi'])('%s ran the same page checks as the English page', (urlPath) => {
    const page = result.pages.find((p) => p.urlPath === urlPath)!;
    expect(page.coverage).toBe(home().coverage);
    expect(page.accessibility).toMatchObject({
      standard: home().accessibility!.standard,
      method: home().accessibility!.method,
    });
    expect(page.phone).toBeDefined();
    expect(page.phone!.widthPx).toBe(home().phone!.widthPx);
    expect(page.seo).toBeDefined();
    expect(page.speed).toBeDefined();
    expect(page.areas?.map((a) => a.area)).toEqual(home().areas?.map((a) => a.area));
  });

  it.each(['/ta', '/hi'])('%s has findings where the fixture plants a problem (small tap targets)', (urlPath) => {
    const own = result.findings.filter((f) => f.urlPath === urlPath);
    expect(own.length).toBeGreaterThan(0);
    expect(own.some((f) => f.rule === 'tap-target' && f.area === 'usability')).toBe(true);
    // Findings cite pages and Sections that exist.
    const page = result.pages.find((p) => p.urlPath === urlPath)!;
    for (const f of own) if (f.sectionId) expect(page.sections.map((s) => s.id)).toContain(f.sectionId);
    // Their text is written in English: finding wording is fixed per rule, not copied from the page.
    for (const f of own) expect(f.title).not.toContain(FFFD);
  });

  it('the English page has findings by the same phone check, so the rules match', () => {
    const rules = (p: string) =>
      new Set(result.findings.filter((f) => f.urlPath === p && f.area === 'usability').map((f) => f.rule));
    for (const rule of rules('/ta')) expect(rules('/')).toContain(rule);
    for (const rule of rules('/hi')) expect(rules('/')).toContain(rule);
  });
});

describe('Audit Documents by language (REQ-044 AC-3, REQ-032 AC-1, Q-45, DEC-005)', () => {
  const TITLE_KINDS = AUDIT_DOCUMENT_KINDS;

  it('Tamil documents have the Tamil headings from the BE-709 tables and no beta label', () => {
    const docs = generateAuditDocuments(input('ta'));
    expect(docs.map((d) => d.kind)).toEqual([...TITLE_KINDS]);
    const labels = labelsFor('ta');
    expect(labels).toMatchObject({ language: 'ta', requested: 'ta', fallback: false });
    for (const doc of docs) {
      expect(doc.language).toBe('ta');
      // The Proposal's title comes from its template; the other four are in the BE-709 title table.
      if (doc.kind !== 'proposal') expect(doc.title).toBe(documentText('ta', `documentTitles.${doc.kind}` as never));
      expect(doc.title).toMatch(/[஀-௿]/);
      const headings = doc.blocks.filter((b) => b.type === 'heading');
      expect(headings.length, doc.kind).toBeGreaterThan(0);
      for (const h of headings) expect((h as { text: string }).text, `${doc.kind} heading`).not.toBe('');
    }
    expect(documentBetaNote('ta')).toBe('');
    for (const doc of docs) {
      const html = renderHtml(doc);
      expect(html).toContain('<html lang="ta" dir="ltr">');
      expect(html).not.toContain(documentText('ta', 'status.betaTranslation'));
      expect(html).not.toContain('Beta translation');
      expect(renderMarkdown(doc)).not.toContain(documentText('ta', 'status.betaTranslation'));
    }
    const structure = docs.find((d) => d.kind === 'structure')!;
    const structureHeadings = structure.blocks
      .filter((b) => b.type === 'heading')
      .map((b) => (b as { text: string }).text);
    expect(structureHeadings).toContain(labels.labels.headings.pageHierarchy);
    expect(labels.labels.headings.pageHierarchy).toMatch(/[஀-௿]/);
  });

  it('Tamil Owner Audit is in Tamil with no beta label', () => {
    const doc = generateOwnerAudit({ result, contents: allContents, edits: emptyOverlay(), language: 'ta' });
    expect(doc.title).toBe(documentText('ta', 'documentTitles.owner-audit'));
    expect(renderHtml(doc)).not.toContain('Beta translation');
  });

  it('Hindi documents render entirely in English with the English beta note (DEC-005)', () => {
    // DEC-005 replaces "Hindi documents are in Hindi": labelsFor('hi') falls back until every builder has Hindi.
    expect(labelsFor('hi')).toMatchObject({ requested: 'hi', language: 'en', fallback: true });
    expect(labelsFor('hi').labels).toBe(labelsFor('en').labels);
    const docs = generateAuditDocuments(input('hi'));
    expect(docs.map((d) => d.kind)).toEqual([...TITLE_KINDS]);
    expect(documentBetaNote('hi')).toBe('Beta translation');
    for (const doc of docs) {
      if (doc.kind !== 'proposal') expect(doc.title).toBe(documentText('en', `documentTitles.${doc.kind}` as never));
      const html = renderHtml(doc);
      expect(html).toContain('<html lang="en" dir="ltr">');
      expect(html).toContain('Beta translation');
      expect(renderMarkdown(doc)).toContain('Beta translation');
      // No fixed Devanagari wording in the headings or titles: only page text may be Devanagari.
      expect(doc.title).not.toMatch(/[ऀ-ॿ]/);
    }
    // Some headings quote page text (Section headings, finding titles): check the fixed ones from the table.
    const structure = docs.find((d) => d.kind === 'structure')!;
    const fixed = structure.blocks.filter((b) => b.type === 'heading').map((b) => (b as { text: string }).text);
    expect(fixed).toContain(labelsFor('en').labels.headings.pageHierarchy);
  });

  it('the Hindi Word export carries the English beta note and the Tamil one does not', async () => {
    const hi = await mammoth.extractRawText({ buffer: (await exportAudit('docx', input('hi', ['content']))).body });
    expect(hi.value).toContain('Beta translation');
    const ta = await mammoth.extractRawText({ buffer: (await exportAudit('docx', input('ta', ['content']))).body });
    expect(ta.value).not.toContain('Beta translation');
  });

  it('documentText("hi", ...) still returns Hindi, and differs from English (DEC-005)', () => {
    const hi = documentText('hi', 'documentTitles.content');
    expect(hi).toMatch(/[ऀ-ॿ]/);
    expect(hi).not.toBe(documentText('en', 'documentTitles.content'));
    expect(documentText('hi', 'status.betaTranslation')).toMatch(/[ऀ-ॿ]/);
  });

  it('English documents have English titles and no beta label', () => {
    const docs = generateAuditDocuments(input('en'));
    for (const doc of docs) {
      if (doc.kind !== 'proposal') expect(doc.title).toBe(documentText('en', `documentTitles.${doc.kind}` as never));
      expect(renderHtml(doc)).not.toContain('Beta translation');
    }
  });

  it('Hindi page text stays Hindi inside a Hindi-requested Content document (page text is never translated)', () => {
    const content = generateAuditDocuments(input('hi', ['content']))[0]!;
    const md = renderMarkdown(content);
    expect(md).toContain('कावेरी स्वीट्स में आपका स्वागत है');
    expect(md).toContain('Beta translation');
  });
});
