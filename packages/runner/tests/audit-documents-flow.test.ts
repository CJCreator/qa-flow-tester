/**
 * QA-500 (REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-025, REQ-026, REQ-027): Audit Documents and exports
 * end to end through a running RunnerServer (the real route table, the real Chromium PDF printer) over a temp
 * data folder. A finished Website Audit version (English and Tamil pages) is seeded through the audit store,
 * then everything else goes over HTTP: edits, the Proposal template and settings, every export format, the
 * bundle, the Pitch Glimpse and the Owner Audit, in English and Tamil. The runner is stopped and started again
 * on the same data folder before the exports, so the saved edits and settings must survive a restart.
 *
 * Launches Chromium and a runner: listed in BROWSER_TESTS.runner (vitest.workspace.ts).
 * Network: nothing leaves the machine. Node's fetch and http(s).request are spied (only this computer may be
 * called) and every request of every Chromium context the PDF printer opens is recorded (data: URIs only).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { inflateRawSync, crc32 } from 'zlib';
import { promises as fs } from 'fs';
import { AUDIT_DOCUMENT_KINDS, type AuditResult, type AuditRequest } from '@qa/types';
import { findClaimWords, labelsFor, pageContentName, type AuditStore } from '@qa/core';
import type { Request } from '../../core/node_modules/playwright';
import { RunnerServer } from '../src/server.js';
import { auditDocContents, auditDocResult, PATHS } from '../../core/tests/helpers/audit-doc-fixture.js';

const PORT = 3761;
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Playwright is a dependency of @qa/core, not of the runner: load the copy core's printer uses, so the spy
// below sees the very same `chromium` object.
const corePlaywright = createRequire(path.resolve(HERE, '../../core/package.json'))(
  'playwright'
) as typeof import('../../core/node_modules/playwright');
const { chromium } = corePlaywright;

// 1x1 PNG: the stored screenshot of each top finding.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const REQUEST = {
  url: 'https://shop.example.in/',
  limits: { maxPages: 50, maxDepth: 3, includePaths: [], excludePaths: [] },
  language: 'en',
} as unknown as AuditRequest;

// The edits (REQ-020): a finding shown in the Pitch Glimpse, a finding in the Tamil page, two Sections
// (English and Tamil) and a removed page.
const EDITED_TITLE_001 = 'EDITED-TITLE-001 Each page needs its own title';
const EDITED_DETAIL_002 = 'EDITED-DETAIL-002 The shop photo has no description.';
const EDITED_TITLE_005_TA = 'திருத்தப்பட்ட-தலைப்பு பக்கத்தில் குறைவான உள்ளடக்கம்';
const EDITED_SECTION_HOME = 'Fresh groceries delivered\nEDITED-SECTION-HOME same-day delivery before 5 pm.\n';
const EDITED_SECTION_TA = 'புதிய மளிகைப் பொருட்கள்\nதிருத்தப்பட்ட-பகுதி மாலை 5 மணிக்கு முன் ஆர்டர் செய்யுங்கள்.\n';
const REMOVED_PAGE = PATHS.team;
const PRICE = '₹45,000 + GST';
const PAYMENT_TERMS = '50% advance, 50% on delivery';

// The saved settings (REQ-027): an edited Proposal template and opt-out wording in both languages.
const TEMPLATE =
  '# Custom Proposal for {{site.url}}\n\n' +
  'Prepared by {{company.name}} on {{date}}.\n\n' +
  '## What we found\n\n{{findings_summary}}\n\n' +
  '## Pages in scope\n\n{{scope}}\n\n' +
  '## Investment\n\nPrice: {{price}}\n\nPayment: {{payment_terms}}\n';
const OPT_OUT_EN = 'OPTOUT-EN: reply STOP and we will not contact you again.';
const OPT_OUT_TA = 'OPTOUT-TA: தொடர்பைத் தவிர்க்க STOP என்று பதில் அனுப்புங்கள்.';
const COMPANY_NAME = 'Asha Web Studio';

// Owner-only marks that must never reach the Owner Audit (REQ-025 AC-2).
const NOTES = 'PRIVATE-NOTE-XYZ call back on Friday';
const OUTCOME_NOTE = 'PRIVATE-OUTCOME-NOTE-XYZ';

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
  json: any;
}

function call(method: string, pathname: string, body?: unknown): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        host: 'localhost',
        port: PORT,
        path: pathname,
        method,
        headers: {
          host: `localhost:${PORT}`,
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.byteLength) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          let json: any;
          if ((res.headers['content-type'] ?? '').startsWith('application/json')) json = JSON.parse(text);
          resolve({ status: res.statusCode || 0, headers: res.headers, body: buf, text, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Every entry of a ZIP, read from its central directory and inflated: an independent reader. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThanOrEqual(0);
  const count = bytes.readUInt16LE(eocd + 10);
  let pos = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(pos)).toBe(0x02014b50);
    const method = bytes.readUInt16LE(pos + 10);
    const crc = bytes.readUInt32LE(pos + 16);
    const compressed = bytes.readUInt32LE(pos + 20);
    const size = bytes.readUInt32LE(pos + 24);
    const nameLength = bytes.readUInt16LE(pos + 28);
    const local = bytes.readUInt32LE(pos + 42);
    const name = bytes.toString('utf8', pos + 46, pos + 46 + nameLength);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const body = bytes.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    expect(data.length).toBe(size);
    expect(crc32(data) >>> 0).toBe(crc);
    out.set(name, data);
    pos += 46 + nameLength + bytes.readUInt16LE(pos + 30) + bytes.readUInt16LE(pos + 32);
  }
  return out;
}

/** The visible text of a .docx: paragraph ends become line breaks, then the markup and its entities go. */
function docxText(docx: Buffer): string {
  const xml = unzip(docx).get('word/document.xml')!.toString('utf8');
  return xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const latin1 = (pdf: Buffer) => pdf.toString('latin1');
const pageCount = (pdf: Buffer) => latin1(pdf).match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0;
const mediaBoxes = (pdf: Buffer) =>
  [...latin1(pdf).matchAll(/\/MediaBox\s*\[\s*([\d.\s-]+)\]/g)].map((m) => m[1]!.trim().split(/\s+/).map(Number));

/** Text with no markup, for content checks of HTML. */
const visible = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');

let scratch: string;
let dataDir: string;
let server: RunnerServer;
let store: AuditStore;
let auditId: string;
let versionNo: number;
let settingsAfterPut: any;

// What went over the wire, other than to this computer.
const fetchSpy = vi.fn();
const outbound: string[] = [];
const chromiumRequests: string[] = [];
const printedHtml: string[] = [];

/** Every output the flow produced: label and text, scanned for claim words and verdicts. */
const outputs: Array<[label: string, text: string]> = [];
const keep = (label: string, text: string) => outputs.push([label, text]);

function hostOf(arg: unknown): string {
  if (typeof arg === 'string') return new URL(arg).hostname;
  if (arg instanceof URL) return arg.hostname;
  const o = (arg ?? {}) as { hostname?: string; host?: string };
  return (o.hostname ?? o.host ?? 'localhost').replace(/:\d+$/, '');
}

function watchOutbound(): void {
  vi.stubGlobal('fetch', fetchSpy);
  for (const mod of [http, https] as const) {
    const real = mod.request.bind(mod);
    vi.spyOn(mod, 'request').mockImplementation(((...args: unknown[]) => {
      const host = hostOf(args[0]);
      if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host))
        outbound.push(`${mod === https ? 'https' : 'http'}://${host}`);
      return (real as (...a: unknown[]) => http.ClientRequest)(...args);
    }) as typeof mod.request);
  }
  // Every Chromium the PDF printer starts: record each request and the HTML it is asked to print.
  const realLaunch = chromium.launch.bind(chromium);
  vi.spyOn(chromium, 'launch').mockImplementation((async (opts: Parameters<typeof chromium.launch>[0]) => {
    const browser = await realLaunch(opts);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = (async (o: Parameters<typeof browser.newContext>[0]) => {
      const context = await newContext(o);
      context.on('request', (r: Request) => chromiumRequests.push(r.url()));
      const newPage = context.newPage.bind(context);
      context.newPage = (async () => {
        const page = await newPage();
        const setContent = page.setContent.bind(page);
        page.setContent = (async (html: string, so: Parameters<typeof page.setContent>[1]) => {
          printedHtml.push(html);
          return setContent(html, so);
        }) as typeof page.setContent;
        return page;
      }) as typeof context.newPage;
      return context;
    }) as typeof browser.newContext;
    return browser;
  }) as typeof chromium.launch);
}

function newServer(): RunnerServer {
  return new RunnerServer({
    port: PORT,
    host: 'localhost',
    outputDir: path.join(scratch, 'report'),
    dataDir,
    beta: false,
  });
}

/** A finished version: result, Page Content, the three top findings' screenshots, status done. */
async function seedFinishedAudit(): Promise<void> {
  const created = await store.createAudit(REQUEST);
  auditId = created.auditId;
  versionNo = created.version;
  const result: AuditResult = { ...auditDocResult(), auditId, version: versionNo };
  // The Pitch Glimpse shows the top 3 findings with a screenshot each.
  result.findings.slice(0, 3).forEach((f, i) => {
    f.screenshotPath = `screenshots/top-${i + 1}.png`;
  });
  await store.saveResult(auditId, versionNo, result);
  for (const content of auditDocContents()) {
    await store.writeVersionJson(auditId, versionNo, pageContentName(content.urlPath), content);
  }
  for (let i = 1; i <= 3; i++) await store.putVersionFile(auditId, versionNo, `screenshots/top-${i}.png`, PNG_BYTES);
  await store.updateVersion(auditId, versionNo, { status: 'done', finishedAt: result.finishedAt });
}

const exportUrl = (query: string) => `/api/audits/${auditId}/export?${query}`;
const pitchUrl = (query: string) => `/api/audits/${auditId}/pitch?${query}`;
const ownerUrl = (query: string) => `/api/audits/${auditId}/owner?${query}`;

beforeAll(async () => {
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-documents-flow-'));
  dataDir = path.join(scratch, 'data');
  watchOutbound();

  // First runner: seed, then edit and save settings over HTTP.
  server = newServer();
  store = server.auditWiring.store;
  await server.start();
  await seedFinishedAudit();

  const patch = await call('PATCH', `/api/audits/${auditId}/edits`, {
    findings: [
      { findingId: 'AF-001', title: EDITED_TITLE_001 },
      { findingId: 'AF-002', detail: EDITED_DETAIL_002 },
      { findingId: 'AF-005', title: EDITED_TITLE_005_TA },
    ],
    sections: [
      { urlPath: PATHS.home, sectionId: 's2', text: EDITED_SECTION_HOME },
      { urlPath: PATHS.tamil, sectionId: 's2', text: EDITED_SECTION_TA },
    ],
    removePages: [REMOVED_PAGE],
    proposal: { price: PRICE, paymentTerms: PAYMENT_TERMS },
  });
  expect(patch.status, patch.text).toBe(200);

  const put = await call('PUT', '/api/audit-settings', {
    proposalTemplate: TEMPLATE,
    optOutText: { en: OPT_OUT_EN, ta: OPT_OUT_TA },
    company: { name: COMPANY_NAME, email: 'hello@asha.example' },
  });
  expect(put.status, put.text).toBe(200);
  settingsAfterPut = put.json.settings;

  // Owner-only Shortlist data: must stay out of every document.
  const shortlist = await call('PUT', `/api/audits/${auditId}/shortlist`, {
    mark: 'pitch',
    notes: NOTES,
    outcome: 'Interested',
    outcomeNote: OUTCOME_NOTE,
  });
  expect(shortlist.status, shortlist.text).toBe(200);

  // Restart the runner on the same data folder.
  await server.stop();
  server = newServer();
  store = server.auditWiring.store;
  await server.start();
}, 120_000);

afterAll(async () => {
  await server?.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await fs.rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('REQ-020: edits are kept and reach every format', () => {
  it('the saved edits and settings survive the restart (REQ-027 AC-1)', async () => {
    const edits = await call('GET', `/api/audits/${auditId}/edits`);
    expect(edits.status).toBe(200);
    expect(edits.json.edits.removedPages).toEqual([REMOVED_PAGE]);
    expect(edits.json.edits.findings.map((f: { findingId: string }) => f.findingId).sort()).toEqual([
      'AF-001',
      'AF-002',
      'AF-005',
    ]);
    expect(edits.json.edits.proposal).toMatchObject({ price: PRICE, paymentTerms: PAYMENT_TERMS });

    const settings = await call('GET', '/api/audit-settings');
    expect(settings.status).toBe(200);
    expect(settings.json.settings.proposalTemplate).toBe(TEMPLATE);
    expect(settings.json.settings.optOutText.en).toBe(OPT_OUT_EN);
    expect(settings.json.settings.optOutText.ta).toBe(OPT_OUT_TA);
    expect(settings.json.settings.company.name).toBe(COMPANY_NAME);
    // The same values the PUT answered with before the restart.
    expect(settings.json.settings.proposalTemplate).toBe(settingsAfterPut.proposalTemplate);
    expect(settings.json.settings.optOutText).toEqual(settingsAfterPut.optOutText);
    expect(settings.json.settings.company).toEqual(settingsAfterPut.company);
  });

  it.each(['md', 'html', 'pdf', 'docx', 'bundle'] as const)(
    '%s export (English): edited finding, Section and price; the removed page is not listed (REQ-020 AC-1..AC-3)',
    async (format) => {
      const res = await call('GET', exportUrl(`format=${format}&language=en`));
      expect(res.status, res.text.slice(0, 200)).toBe(200);
      const texts: Array<[string, string]> = [];
      if (format === 'md' || format === 'html') texts.push([format, res.text]);
      if (format === 'docx') texts.push([format, docxText(res.body)]);
      if (format === 'bundle') for (const [name, data] of unzip(res.body)) texts.push([name, data.toString('utf8')]);
      if (format === 'pdf') {
        expect(res.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        texts.push([format, printedHtml[printedHtml.length - 1]!]);
      }
      const all = texts.map(([, t]) => t).join('\n');
      expect(all).toContain(EDITED_TITLE_001);
      expect(all).toContain(EDITED_DETAIL_002);
      expect(all).toContain('EDITED-SECTION-HOME same-day delivery before 5 pm.');
      expect(all).not.toContain('Order before 6 pm for same-day delivery.');
      // The removed page is listed in no file, as a path, a title row or a finding.
      for (const [name, text] of texts) {
        expect(text, `${format}: ${name}`).not.toContain(REMOVED_PAGE);
      }
      for (const [name, text] of texts) keep(`export ${format} en ${name}`, text);
    }
  );

  it('the Roadmap title follows the edited finding (BE-500)', async () => {
    const res = await call('GET', exportUrl('format=md&language=en&documents=roadmap'));
    expect(res.status).toBe(200);
    expect(res.text).toContain(EDITED_TITLE_001);
    expect(res.text).not.toContain('Give every page its own title');
  });
});

describe('REQ-018 and REQ-021: five Audit Documents, one Pitch Glimpse, the bundle', () => {
  it('md export holds exactly the five Audit Documents in the fixed order', async () => {
    const res = await call('GET', exportUrl('format=md&language=en'));
    expect(res.status).toBe(200);
    expect([...AUDIT_DOCUMENT_KINDS]).toEqual(['structure', 'content', 'findings', 'roadmap', 'proposal']);
    const titles = labelsFor('en').labels.documentTitles;
    // The Proposal's title is the saved template's own first heading.
    const heading = (kind: (typeof AUDIT_DOCUMENT_KINDS)[number]) =>
      kind === 'proposal' ? 'Custom Proposal for ' : titles[kind];
    const at = AUDIT_DOCUMENT_KINDS.map((kind) => res.text.indexOf(`# ${heading(kind)}`));
    expect(
      at.every((i) => i >= 0),
      JSON.stringify(at)
    ).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The Pitch Glimpse and the Owner Audit are separate downloads, not part of the five.
    expect(res.text).not.toContain(titles['pitch-glimpse']);
  });

  it('one Pitch Glimpse (html) and one Owner Audit per language are produced', async () => {
    for (const language of ['en', 'ta'] as const) {
      const pitch = await call('GET', pitchUrl(`format=html&language=${language}`));
      expect(pitch.status).toBe(200);
      expect(pitch.headers['content-type']).toContain('text/html');
      expect(pitch.text).toContain(labelsFor(language).labels.documentTitles['pitch-glimpse']);
      const owner = await call('GET', ownerUrl(`format=md&language=${language}`));
      expect(owner.status).toBe(200);
    }
  });

  it('the bundle unpacks to the five Markdown documents, a valid site.json and README.md (REQ-021 AC-1, AC-2)', async () => {
    const res = await call('GET', exportUrl('format=bundle&language=en'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('zip');
    const files = unzip(res.body);
    const names = [...files.keys()];
    const folder = names[0]!.split('/')[0]!;
    expect(names.sort()).toEqual(
      [
        '01-structure.md',
        '02-content.md',
        '03-findings.md',
        '04-improvement-roadmap.md',
        '05-proposal.md',
        'README.md',
        'site.json',
      ].map((n) => `${folder}/${n}`)
    );

    const site = JSON.parse(files.get(`${folder}/site.json`)!.toString('utf8'));
    expect(site.schemaVersion).toBe(1);
    expect(site.site.url).toBe(REQUEST.url);
    expect(site.pages.map((p: { urlPath: string }) => p.urlPath)).not.toContain(REMOVED_PAGE);
    expect(Array.isArray(site.findings)).toBe(true);
    expect(site.findings.length).toBeGreaterThan(0);

    // Every finding of the Markdown appears in site.json, and every finding in site.json is in the Markdown.
    const findingsMd = files.get(`${folder}/03-findings.md`)!.toString('utf8');
    for (const f of site.findings as Array<{ id: string; title: string }>) {
      expect(findingsMd, f.id).toContain(f.title);
    }
    const mdIds = new Set(findingsMd.match(/AF-\d{3}/g) ?? []);
    const jsonIds = new Set((site.findings as Array<{ id: string }>).map((f) => f.id));
    for (const id of mdIds) expect(jsonIds.has(id), `${id} is in the Markdown but not in site.json`).toBe(true);
    expect(jsonIds.size).toBeGreaterThan(0);

    // Edits are in site.json too, character for character.
    const home = site.pages.find((p: { urlPath: string }) => p.urlPath === PATHS.home);
    expect(home.sections.find((s: { id: string }) => s.id === 's2').text).toBe(EDITED_SECTION_HOME);
    const readme = files.get(`${folder}/README.md`)!.toString('utf8');
    expect(readme).toContain('site.json');
    expect(readme).toContain('05-proposal.md');
  });
});

describe('REQ-026: the Improvement Roadmap shows a priority, a phase and an effort for every item', () => {
  it.each(['en', 'ta'] as const)('%s', async (language) => {
    const res = await call('GET', exportUrl(`format=md&language=${language}&documents=roadmap`));
    expect(res.status).toBe(200);
    const { columns, scale } = labelsFor(language).labels;
    const items = auditDocResult().roadmap;
    const count = (needle: string) => res.text.split(needle).length - 1;
    for (const item of items) {
      expect(res.text, `${item.id} priority`).toContain(`${columns.priority}: ${scale[item.priority]}`);
      expect(res.text, `${item.id} effort`).toContain(`${columns.effort}: ${scale[item.effort]}`);
    }
    expect(count(`${columns.priority}: `)).toBeGreaterThanOrEqual(items.length);
    expect(count(`${columns.phase}: `)).toBeGreaterThanOrEqual(items.length);
    expect(count(`${columns.effort}: `)).toBeGreaterThanOrEqual(items.length);
  });
});

describe('REQ-027: the Proposal follows the saved template, filled with the audit data', () => {
  it('uses the edited template after the restart (AC-1, AC-2)', async () => {
    const res = await call('GET', exportUrl('format=md&language=en&documents=proposal'));
    expect(res.status).toBe(200);
    // Markdown escapes the colon in the address ("https\://"): compare without the backslashes.
    expect(res.text.replace(/\\/g, '')).toContain(`Custom Proposal for ${REQUEST.url}`);
    expect(res.text).toContain(`Prepared by ${COMPANY_NAME} on `);
    expect(res.text).toMatch(/on \d{4}-\d{2}-\d{2}\./);
    expect(res.text).toContain(PRICE);
    expect(res.text).toContain(PAYMENT_TERMS);
    // The audit's own data: the top finding (edited) and the pages in scope.
    expect(res.text).toContain(EDITED_TITLE_001);
    expect(res.text).toContain(PATHS.services);
    expect(res.text).not.toContain(REMOVED_PAGE);
    // Not the default template's headings.
    expect(res.text).not.toContain('{{');
    keep('proposal md', res.text);
  });
});

describe('REQ-022: PDF and Word hold the same documents as the Markdown', () => {
  it.each(['en', 'ta'] as const)(
    '%s: the PDF is printed from the same document as the HTML export',
    async (language) => {
      const html = await call('GET', exportUrl(`format=html&language=${language}`));
      const pdf = await call('GET', exportUrl(`format=pdf&language=${language}`));
      expect(html.status).toBe(200);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      // The printer received exactly the HTML the export route serves.
      expect(printedHtml[printedHtml.length - 1]).toBe(html.text);
      for (const [x0, y0, x1, y1] of mediaBoxes(pdf.body)) {
        expect(Math.abs(x1! - x0! - 595.28)).toBeLessThan(1);
        expect(Math.abs(y1! - y0! - 841.89)).toBeLessThan(1);
      }
      expect(pageCount(pdf.body)).toBeGreaterThanOrEqual(1);
    }
  );

  it('Tamil text survives into the .docx character for character (AC-2)', async () => {
    const docx = await call('GET', exportUrl('format=docx&language=ta'));
    expect(docx.status).toBe(200);
    expect(docx.headers['content-type']).toContain('wordprocessingml');
    const text = docxText(docx.body);
    expect(text).toContain(EDITED_TITLE_005_TA);
    expect(text).toContain('திருத்தப்பட்ட-பகுதி மாலை 5 மணிக்கு முன் ஆர்டர் செய்யுங்கள்.');
    expect(text).toContain('புதிய மளிகைப் பொருட்கள்');
    expect(text).not.toContain(REMOVED_PAGE);
    keep('export docx ta', text);
  });

  it('the Word file holds the same documents as the Markdown (headings of all five)', async () => {
    const [md, docx] = await Promise.all([
      call('GET', exportUrl('format=md&language=en')),
      call('GET', exportUrl('format=docx&language=en')),
    ]);
    const text = docxText(docx.body);
    const titles = labelsFor('en').labels.documentTitles;
    for (const kind of AUDIT_DOCUMENT_KINDS) {
      // The Proposal's title is the saved template's own first heading.
      const title = kind === 'proposal' ? 'Custom Proposal for ' : titles[kind];
      expect(md.text, kind).toContain(`# ${title}`);
      expect(text, kind).toContain(title);
    }
    const mdPlain = md.text.replace(/\\/g, '');
    for (const needle of [EDITED_TITLE_001, EDITED_DETAIL_002, PRICE, `Custom Proposal for ${REQUEST.url}`]) {
      expect(mdPlain).toContain(needle);
      expect(text).toContain(needle);
    }
  });
});

describe('REQ-019: the Pitch Glimpse', () => {
  it.each(['en', 'ta'] as const)(
    '%s: one A4 page with the top 3 issues, their screenshots and the opt-out wording',
    async (language) => {
      const html = await call('GET', pitchUrl(`format=html&language=${language}`));
      const pdf = await call('GET', pitchUrl(`format=pdf&language=${language}`));
      expect(html.status).toBe(200);
      expect(pdf.status, pdf.text.slice(0, 200)).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['content-disposition']).toContain('pitch-glimpse.pdf');

      // Printed from exactly this HTML.
      expect(printedHtml[printedHtml.length - 1]).toBe(html.text);
      expect(pageCount(pdf.body)).toBe(1);
      const boxes = mediaBoxes(pdf.body);
      expect(boxes.length).toBe(1);
      const [x0, y0, x1, y1] = boxes[0]!;
      expect(Math.abs(x1! - x0! - 595.28)).toBeLessThan(1);
      expect(Math.abs(y1! - y0! - 841.89)).toBeLessThan(1);

      // The language chosen, the top 3 findings (ranking order, edited text), a screenshot each, the opt-out text.
      expect(html.text).toContain(`<html lang="${language}"`);
      const text = visible(html.text);
      const top3 = auditDocResult().findings.slice(0, 3);
      const edited: Record<string, string> = { 'AF-001': EDITED_TITLE_001 };
      for (const f of top3) expect(text, f.id).toContain(edited[f.id] ?? f.title);
      expect(text).not.toContain(auditDocResult().findings[3]!.title);
      expect(html.text.match(/data:image\/png;base64,/g)?.length).toBe(3);
      expect(text).toContain(language === 'en' ? OPT_OUT_EN : OPT_OUT_TA);
      expect(text).not.toContain(REMOVED_PAGE);
      // No send action: no form, no mailto: or tel: link, no script.
      expect(html.text).not.toMatch(/<form\b|mailto:|tel:|<script\b/i);
      keep(`pitch html ${language}`, html.text);
    }
  );
});

describe('REQ-025: the Owner Audit', () => {
  it.each(['en', 'ta'] as const)(
    '%s: in that language, with no pitch/skip mark, notes, outcome, effort or price',
    async (language) => {
      const { labels } = labelsFor(language);
      const downloads: Array<[string, string]> = [];
      for (const format of ['md', 'html', 'docx'] as const) {
        const res = await call('GET', ownerUrl(`format=${format}&language=${language}`));
        expect(res.status, format).toBe(200);
        downloads.push([format, format === 'docx' ? docxText(res.body) : res.text]);
      }
      const pdf = await call('GET', ownerUrl(`format=pdf&language=${language}`));
      expect(pdf.status).toBe(200);
      expect(pdf.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      downloads.push(['pdf (printed html)', printedHtml[printedHtml.length - 1]!]);

      for (const [format, text] of downloads) {
        expect(text, format).toContain(labels.documentTitles['owner-audit']);
        expect(text, format).not.toContain(NOTES);
        expect(text, format).not.toContain(OUTCOME_NOTE);
        expect(text, format).not.toContain('Interested');
        expect(text, format).not.toContain(PRICE);
        expect(text, format).not.toContain(PAYMENT_TERMS);
        expect(text, format).not.toContain(COMPANY_NAME);
        expect(text, format).not.toContain(`${labels.columns.effort}:`);
        expect(text, format).not.toContain(labels.documentTitles.proposal);
        expect(text, format).not.toMatch(/\b(pitch|skip)\b/i);
        // The edits still apply: it follows the edited view.
        expect(text, format).not.toContain(REMOVED_PAGE);
        keep(`owner ${format} ${language}`, text);
      }
      expect(downloads[0]![1]).toContain('EDITED-TITLE-001');
      expect(downloads[0]![1]).not.toContain('Order before 6 pm for same-day delivery.');
    }
  );
});

describe('PDF concurrency (BE-510) does not get in the way of the flow', () => {
  it('two PDFs at once both succeed', async () => {
    const [a, b] = await Promise.all([
      call('GET', pitchUrl('format=pdf&language=en')),
      call('GET', ownerUrl('format=pdf&language=en')),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });
});

describe('ADR 0018 and ADR 0033: no claim word, no release verdict in any output', () => {
  it('scans every output of the flow, in both languages', () => {
    // Make sure the scan really has the formats and both languages in it.
    const labels = outputs.map(([label]) => label);
    expect(labels.some((l) => l.startsWith('export md en'))).toBe(true);
    expect(labels.some((l) => l.startsWith('export html en'))).toBe(true);
    expect(labels.some((l) => l.startsWith('export docx en'))).toBe(true);
    expect(labels.some((l) => l.startsWith('export docx ta'))).toBe(true);
    expect(labels.some((l) => l.startsWith('export bundle en'))).toBe(true);
    expect(labels.some((l) => l.startsWith('export pdf en'))).toBe(true);
    expect(labels.some((l) => l.startsWith('pitch html ta'))).toBe(true);
    expect(labels.some((l) => l.startsWith('owner md ta'))).toBe(true);
    expect(labels.some((l) => l.startsWith('owner docx en'))).toBe(true);
    expect(labels.some((l) => l.startsWith('proposal'))).toBe(true);
    for (const [label, text] of outputs) {
      expect(findClaimWords(text), label).toEqual([]);
      expect(text, label).not.toContain('Ready to release');
      expect(text, label).not.toMatch(/verdict/i);
      expect(text, label).not.toMatch(/\bnot ready yet\b/i);
    }
  });
});

describe('REQ-019 AC-4: the runner made no outbound request and sent nothing', () => {
  it('no fetch, no call to a host other than this computer, and Chromium loaded only data: URIs', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outbound).toEqual([]);
    expect(printedHtml.length).toBeGreaterThan(0);
    // Every request any PDF context made is an inline document (no network address at all).
    for (const url of chromiumRequests) expect(url.startsWith('data:') || url.startsWith('about:'), url).toBe(true);
  });
});
