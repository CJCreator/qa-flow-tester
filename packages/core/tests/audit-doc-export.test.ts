import { describe, it, expect } from 'vitest';
import { inflateRawSync, crc32 } from 'node:zlib';
import {
  AUDIT_DOCUMENT_KINDS,
  EXPORT_CONTENT_TYPES,
  EXPORT_FORMATS,
  type EditOverlay,
  type ExportFormat,
} from '@qa/types';
import { emptyOverlay, mergeEditsPatch, validateAuditEditsPatch } from '../src/audit/documents/edits.js';
import {
  editedViewOf,
  generateAuditDocuments,
  generateOwnerAudit,
  generatePitchGlimpse,
  type AuditDocumentsInput,
} from '../src/audit/documents/generate.js';
import {
  BUNDLE_FILE_NAMES,
  exportAudit,
  exportBaseName,
  exportOwnerAudit,
  exportPitchGlimpse,
  type AuditExportFile,
} from '../src/audit/documents/bundle.js';
import { buildSiteJson, SITE_JSON_SCHEMA_VERSION, type SiteJson } from '../src/audit/documents/site-json.js';
import { escapeMarkdownInline, renderMarkdown } from '../src/audit/documents/render-markdown.js';
import { renderHtml } from '../src/audit/documents/render-html.js';
import { emptyAuditSettings, resolveAuditSettings } from '../src/audit/documents/settings.js';
import { findClaimWords } from '../src/audit/documents/wording.js';
import { en } from '../src/audit/documents/labels/en.js';
import { ta } from '../src/audit/documents/labels/ta.js';
import { PROPOSAL_FILL_IN_TA } from '../src/audit/documents/templates/proposal-ta.js';
import * as barrel from '../src/audit/documents/index.js';
import {
  auditDocContents,
  auditDocResult,
  fixtureSectionText,
  FIXTURE_URL,
  PATHS,
} from './helpers/audit-doc-fixture.js';

const NOW = '2026-11-03T10:00:00.000Z';
const FOLDER = 'shop.example.in-v1';
const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9.-]*\.(md|html|pdf|docx|zip)$/;

const EDITED_TITLE = 'Edited title for the export';
const EDITED_HOME_TEXT = 'Edited hero text for the export\nOrder by phone any time.\n';
const ORIGINAL_HOME_LINE = 'Order before 6 pm for same-day delivery.';
const EDITED_TAMIL_TEXT = 'புதிய காய்கறிகள் தினமும்\nஇன்றே அழைத்து ஆர்டர் செய்யுங்கள்.\n';

function overlayOf(patch: unknown): EditOverlay {
  const checked = validateAuditEditsPatch(patch);
  if (!checked.ok) throw new Error(`patch refused: ${JSON.stringify(checked.errors)}`);
  return mergeEditsPatch(emptyOverlay(), checked.value, NOW);
}

function input(over: Partial<AuditDocumentsInput> = {}): AuditDocumentsInput {
  return {
    result: auditDocResult(),
    contents: auditDocContents(),
    edits: emptyOverlay(),
    settings: resolveAuditSettings(emptyAuditSettings(), false),
    now: NOW,
    ...over,
  };
}

/** The edits used by the REQ-020 export tests: a finding title, two Section texts and a removed page. */
function editedInput(): AuditDocumentsInput {
  return input({
    edits: overlayOf({
      findings: [{ findingId: 'AF-001', title: EDITED_TITLE }],
      sections: [
        { urlPath: PATHS.home, sectionId: 's2', text: EDITED_HOME_TEXT },
        { urlPath: PATHS.tamil, sectionId: 's2', text: EDITED_TAMIL_TEXT },
      ],
      removePages: [PATHS.team],
    }),
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
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
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

/** A PDF printer stand-in: records the HTML it was given and returns fixed bytes (no browser in unit tests). */
function fakePdf() {
  const printed: string[] = [];
  return {
    printed,
    renderPdf: async (html: string) => {
      printed.push(html);
      return Buffer.from('%PDF-1.7 fake');
    },
  };
}

/** The text of every file an export produces, for content checks. */
async function exportTexts(
  format: ExportFormat,
  data: AuditDocumentsInput
): Promise<Array<[name: string, text: string]>> {
  const pdf = fakePdf();
  const file = await exportAudit(format, data, { renderPdf: pdf.renderPdf });
  if (format === 'pdf') return [[`${file.fileName} (printed HTML)`, pdf.printed.join('')]];
  if (format === 'bundle') return [...unzip(file.body)].map(([name, bytes]) => [name, bytes.toString('utf8')]);
  if (format === 'docx') {
    const xml = unzip(file.body).get('word/document.xml')!.toString('utf8');
    // Paragraph ends become line breaks, then the markup goes.
    return [[file.fileName, xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')]];
  }
  return [[file.fileName, file.body.toString('utf8')]];
}

async function bundleOf(data: AuditDocumentsInput): Promise<{ file: AuditExportFile; files: Map<string, string> }> {
  const file = await exportAudit('bundle', data);
  const files = new Map([...unzip(file.body)].map(([name, bytes]) => [name, bytes.toString('utf8')]));
  return { file, files };
}

describe('generateAuditDocuments (REQ-018 AC-1)', () => {
  it('produces exactly the five Audit Documents in the fixed order', () => {
    const docs = generateAuditDocuments(input());
    expect(docs.map((d) => d.kind)).toEqual(['structure', 'content', 'findings', 'roadmap', 'proposal']);
    expect(docs.map((d) => d.kind)).toEqual([...AUDIT_DOCUMENT_KINDS]);
    expect(docs.map((d) => d.title).slice(0, 4)).toEqual([
      en.documentTitles.structure,
      en.documentTitles.content,
      en.documentTitles.findings,
      en.documentTitles.roadmap,
    ]);
    for (const doc of docs) expect(doc.language).toBe('en');
  });

  it('and exactly one Pitch Glimpse, built from the same edited version', () => {
    const { doc, html } = generatePitchGlimpse({ ...editedInput(), settings: { optOutText: {} } });
    expect(doc.kind).toBe('pitch-glimpse');
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain(EDITED_TITLE);
    expect(html).not.toContain('Two pages share one title');
  });

  it('returns a requested subset in the fixed order, each once', () => {
    const docs = generateAuditDocuments(input({ documents: ['proposal', 'structure', 'proposal'] }));
    expect(docs.map((d) => d.kind)).toEqual(['structure', 'proposal']);
    expect(generateAuditDocuments(input({ documents: [] })).map((d) => d.kind)).toEqual([...AUDIT_DOCUMENT_KINDS]);
  });

  it('writes in the requested language; a Tamil Proposal uses the Tamil default template', () => {
    const docs = generateAuditDocuments(input({ language: 'ta' }));
    for (const doc of docs) expect(doc.language).toBe('ta');
    expect(docs[0]!.title).toBe(ta.documentTitles.structure);
    const proposal = renderMarkdown(docs[4]!);
    // No price was entered: the Tamil "to fill in" marker shows.
    expect(proposal).toContain(escapeMarkdownInline(PROPOSAL_FILL_IN_TA));
  });

  it('a Proposal requested in a fallback language keeps the requested language and shows the beta note (DEC-005)', () => {
    const [proposal] = generateAuditDocuments(input({ language: 'hi', documents: ['proposal'] }));
    expect(proposal!.language).toBe('hi');
    const html = renderHtml(proposal!);
    expect(html).toContain('Beta translation');
    expect(html).toContain('lang="en"');
  });

  it('a saved Proposal template is used as written', () => {
    const settings = resolveAuditSettings(
      { ...emptyAuditSettings(), proposalTemplate: '# Our offer\n\nPrice: {{price}}\n' },
      false
    );
    const [proposal] = generateAuditDocuments(input({ settings, documents: ['proposal'] }));
    expect(proposal!.title).toBe('Our offer');
  });

  it('never changes what it is given', () => {
    const data = editedInput();
    const before = structuredClone(data);
    generateAuditDocuments(data);
    expect(data).toEqual(before);
  });

  it('the Owner Audit carries the edits too', () => {
    const doc = generateOwnerAudit(editedInput());
    expect(doc.kind).toBe('owner-audit');
    const md = renderMarkdown(doc);
    expect(md).toContain(EDITED_TITLE);
    expect(md).not.toContain(PATHS.team);
  });
});

describe('export bundle (REQ-021 AC-1, Q-24)', () => {
  it('holds the five Markdown documents, site.json and README.md in one folder', async () => {
    const { file, files } = await bundleOf(input());
    expect(file.fileName).toBe(`${FOLDER}.zip`);
    expect(file.contentType).toBe(EXPORT_CONTENT_TYPES.bundle);
    expect([...files.keys()].sort()).toEqual(
      [
        `${FOLDER}/01-structure.md`,
        `${FOLDER}/02-content.md`,
        `${FOLDER}/03-findings.md`,
        `${FOLDER}/04-improvement-roadmap.md`,
        `${FOLDER}/05-proposal.md`,
        `${FOLDER}/README.md`,
        `${FOLDER}/site.json`,
      ].sort()
    );
    const docs = generateAuditDocuments(input());
    for (const doc of docs) {
      expect(files.get(`${FOLDER}/${BUNDLE_FILE_NAMES[doc.kind as keyof typeof BUNDLE_FILE_NAMES]}`)).toBe(
        renderMarkdown(doc)
      );
    }
  });

  it('holds all five documents even when only some were selected', async () => {
    const { files } = await bundleOf(input({ documents: ['findings'] }));
    expect([...files.keys()].filter((n) => n.endsWith('.md'))).toHaveLength(6);
  });

  it('site.json has the pages, their Sections with text, and the findings', async () => {
    const { files } = await bundleOf(input());
    const site = JSON.parse(files.get(`${FOLDER}/site.json`)!) as SiteJson;
    expect(site.schemaVersion).toBe(SITE_JSON_SCHEMA_VERSION);
    expect(site.site).toMatchObject({ url: FIXTURE_URL, version: 1, language: 'en' });
    expect(site.pages.map((p) => p.urlPath)).toEqual([
      PATHS.home,
      PATHS.about,
      PATHS.team,
      PATHS.services,
      PATHS.tamil,
    ]);
    const home = site.pages[0]!;
    expect(home).toMatchObject({ depth: 0, coverage: 'sample', title: 'Shop Example' });
    expect(home.recommendation).toMatchObject({ action: 'repair', decidedBy: 'ai', findingIds: ['AF-004'] });
    expect(home.sections.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(home.sections[1]).toEqual({
      id: 's2',
      kind: 'main',
      heading: 'Fresh groceries delivered',
      text: fixtureSectionText(PATHS.home, 's2'),
    });
    expect(site.pages[1]).toMatchObject({ coverage: 'covered', sampleUrlPath: PATHS.services, recommendation: null });
    expect(site.findings.map((f) => f.id)).toEqual(['AF-001', 'AF-002', 'AF-003', 'AF-004', 'AF-005', 'AF-006']);
    expect(site.findings[1]).toMatchObject({
      group: 'content',
      area: 'accessibility',
      urlPath: PATHS.about,
      sectionId: 's2',
      impact: 'medium',
      effort: 'low',
    });
    expect(site.findings[3]!.advisory).toBe(true);
    expect(site.roadmap.map((r) => r.id)).toEqual(['RM-1', 'RM-2', 'RM-3', 'RM-4']);
    expect(site.skippedPages).toEqual([{ urlPath: '/checkout', why: 'payment', status: null }]);
    // Internal details stay out.
    const raw = files.get(`${FOLDER}/site.json`)!;
    expect(raw).not.toContain('auditId');
    expect(raw).not.toContain('audit-doc-fixture-01');
    expect(raw).not.toContain('screenshotPath');
  });

  it('README.md describes every file for Claude Code, with no claim words', async () => {
    const { files } = await bundleOf(input());
    const readme = files.get(`${FOLDER}/README.md`)!;
    for (const name of [...Object.values(BUNDLE_FILE_NAMES), 'site.json', 'README.md'])
      expect(readme, name).toContain(`\`${name}\``);
    expect(readme).toContain('Claude Code');
    expect(findClaimWords(readme)).toEqual([]);
  });

  it('is the same bytes for the same input', async () => {
    const a = await exportAudit('bundle', input());
    const b = await exportAudit('bundle', input());
    expect(a.body.equals(b.body)).toBe(true);
  });
});

describe('site.json against the Markdown documents (REQ-021 AC-2)', () => {
  it('is valid JSON, and every finding id and title in the Markdown appears in it', async () => {
    for (const data of [input(), editedInput()]) {
      const { files } = await bundleOf(data);
      const raw = files.get(`${FOLDER}/site.json`)!;
      const site = JSON.parse(raw) as SiteJson;
      const markdown = [...files]
        .filter(([n]) => n.endsWith('.md') && !n.endsWith('README.md'))
        .map(([, t]) => t)
        .join('\n');
      const view = editedViewOf(data);
      const titles = new Set(site.findings.map((f) => f.title));
      const ids = new Set(site.findings.map((f) => f.id));

      // Every finding of the edited version: in site.json by id and title, and in the Findings document.
      const findingsMd = files.get(`${FOLDER}/03-findings.md`)!;
      // Finding headings sit under the group headings (level 3 in Markdown).
      const headings = [...findingsMd.matchAll(/^### (.+)$/gm)].map((m) => m[1]!);
      expect(headings).toHaveLength(view.result.findings.length);
      for (const f of view.result.findings) {
        expect(ids.has(f.id), f.id).toBe(true);
        expect(titles.has(f.title), f.title).toBe(true);
        expect(headings, f.title).toContain(escapeMarkdownInline(f.title));
      }
      // Every finding heading in the Findings document is a finding title in site.json.
      const escapedTitles = new Set([...titles].map(escapeMarkdownInline));
      for (const h of headings) expect(escapedTitles.has(h), `Markdown finding "${h}" is not in site.json`).toBe(true);
      // Finding ids the Markdown cites (AF-nnn) are all in site.json.
      for (const id of markdown.match(/\bAF-\d{3}\b/g) ?? []) expect(ids.has(id), id).toBe(true);
      // Roadmap items in the roadmap document are in site.json.
      const roadmapMd = files.get(`${FOLDER}/04-improvement-roadmap.md`)!;
      for (const item of site.roadmap) expect(roadmapMd, item.title).toContain(escapeMarkdownInline(item.title));
      expect(buildSiteJson(view)).toEqual(site);
    }
  });
});

describe('edits reach every export format (REQ-020 AC-1..AC-3)', () => {
  for (const format of EXPORT_FORMATS) {
    it(`${format}: carries the edited finding and Section text; the removed page is in no file`, async () => {
      const texts = await exportTexts(format, editedInput());
      const all = texts.map(([, t]) => t).join('\n');
      expect(all, format).toContain(EDITED_TITLE);
      expect(all, format).toContain('Edited hero text for the export');
      expect(all, format).toContain('Order by phone any time.');
      for (const [name, text] of texts) {
        expect(text, `${format} ${name}`).not.toContain('Two pages share one title');
        expect(text, `${format} ${name}`).not.toContain(ORIGINAL_HOME_LINE);
        expect(text, `${format} ${name}`).not.toContain(PATHS.team);
        // AF-006 was only on the removed page.
        expect(text, `${format} ${name}`).not.toContain('AF-006');
      }
    });
  }

  it('the unedited export still has the originals (the checks above are not vacuous)', async () => {
    for (const format of EXPORT_FORMATS) {
      const all = (await exportTexts(format, input())).map(([, t]) => t).join('\n');
      expect(all, format).toContain('Two pages share one title');
      expect(all, format).toContain(ORIGINAL_HOME_LINE);
      expect(all, format).toContain(PATHS.team);
    }
  });

  it('site.json drops the removed page and its only finding, and keeps the edited text', async () => {
    const { files } = await bundleOf(editedInput());
    const site = JSON.parse(files.get(`${FOLDER}/site.json`)!) as SiteJson;
    expect(site.pages.map((p) => p.urlPath)).not.toContain(PATHS.team);
    expect(site.findings.map((f) => f.id)).not.toContain('AF-006');
    expect(site.roadmap.find((r) => r.id === 'RM-3')!.pages).toEqual([PATHS.services]);
    expect(site.findings[0]!.title).toBe(EDITED_TITLE);
    expect(site.pages[0]!.sections[1]!.text).toBe(EDITED_HOME_TEXT);
  });
});

describe('Tamil text is exported character for character', () => {
  it('Markdown and site.json carry the Tamil Page Content exactly', async () => {
    const { files } = await bundleOf(input());
    const site = JSON.parse(files.get(`${FOLDER}/site.json`)!) as SiteJson;
    const tamil = site.pages.find((p) => p.urlPath === PATHS.tamil)!;
    const contents = auditDocContents().find((c) => c.urlPath === PATHS.tamil)!;
    for (const section of contents.sections) {
      const original = contents.text.slice(section.start, section.end);
      expect(tamil.sections.find((s) => s.id === section.id)!.text).toBe(original);
      // Markdown keeps each line of the Section as it is (lines end in a hard break).
      for (const line of original.split('\n').filter((l) => l !== '')) {
        expect(files.get(`${FOLDER}/02-content.md`), line).toContain(line);
      }
    }
    expect(tamil.title).toBe('கடை உதாரணம்');
    expect(tamil.language.primary).toBe('ta');
    const md = (await exportAudit('md', input({ documents: ['content'] }))).body.toString('utf8');
    expect(md).toContain('மாலை 6 மணிக்கு முன் ஆர்டர் செய்யுங்கள்.');
    expect(md).toContain('புதிய மளிகைப் பொருட்கள்');
  });

  it('an edited Tamil Section is exported exactly as written', async () => {
    const { files } = await bundleOf(editedInput());
    const site = JSON.parse(files.get(`${FOLDER}/site.json`)!) as SiteJson;
    expect(site.pages.find((p) => p.urlPath === PATHS.tamil)!.sections[1]!.text).toBe(EDITED_TAMIL_TEXT);
    for (const line of EDITED_TAMIL_TEXT.split('\n').filter((l) => l !== '')) {
      expect(files.get(`${FOLDER}/02-content.md`), line).toContain(line);
    }
  });
});

describe('content types and file names', () => {
  it('every format takes its content type from EXPORT_CONTENT_TYPES and a safe file name', async () => {
    const names = new Set<string>();
    for (const format of EXPORT_FORMATS) {
      const pdf = fakePdf();
      const file = await exportAudit(format, input(), { renderPdf: pdf.renderPdf });
      expect(file.contentType, format).toBe(EXPORT_CONTENT_TYPES[format]);
      expect(file.fileName, format).toMatch(SAFE_FILE_NAME);
      expect(file.body.length, format).toBeGreaterThan(0);
      names.add(file.fileName);
    }
    expect([...names]).toEqual([
      `${FOLDER}-audit.md`,
      `${FOLDER}-audit.html`,
      `${FOLDER}-audit.pdf`,
      `${FOLDER}-audit.docx`,
      `${FOLDER}.zip`,
    ]);
  });

  it('a single document is named after it', async () => {
    const file = await exportAudit('md', input({ documents: ['roadmap'] }));
    expect(file.fileName).toBe(`${FOLDER}-improvement-roadmap.md`);
  });

  it('a hostile or odd address still gives a safe name', async () => {
    expect(exportBaseName('https://www.Shop.Example.in:8080/a?b=../../x', 3)).toBe('shop.example.in-v3');
    expect(exportBaseName('not an address', 1)).toBe('website-v1');
    expect(exportBaseName('https://கடை.example/', 2)).toMatch(/^[a-z0-9.-]+-v2$/);
    expect(exportBaseName('https://example.com/', Number.NaN)).toBe('example.com-v0');
    const result = auditDocResult();
    result.url = 'https://evil..\\..\\/"name<>|?.example/';
    const file = await exportAudit('md', input({ result }));
    expect(file.fileName).toMatch(SAFE_FILE_NAME);
    expect(file.fileName).not.toContain('..');
  });

  it('the Pitch Glimpse and Owner Audit files too', async () => {
    const pdf = fakePdf();
    const pitchInput = { ...input(), settings: { optOutText: {} } };
    for (const format of ['html', 'pdf'] as const) {
      const file = await exportPitchGlimpse(format, pitchInput, { renderPdf: pdf.renderPdf });
      expect(file.contentType).toBe(EXPORT_CONTENT_TYPES[format]);
      expect(file.fileName).toBe(`${FOLDER}-pitch-glimpse.${format}`);
    }
    // The PDF is printed from the one-page Pitch Glimpse HTML.
    expect(pdf.printed[0]).toBe(generatePitchGlimpse(pitchInput).html);
    for (const format of ['md', 'html', 'pdf', 'docx'] as const) {
      const file = await exportOwnerAudit(format, input(), { renderPdf: pdf.renderPdf });
      expect(file.contentType).toBe(EXPORT_CONTENT_TYPES[format]);
      expect(file.fileName).toBe(`${FOLDER}-owner-audit.${format}`);
    }
  });

  it('refuses an unknown format and an empty selection with a plain sentence', async () => {
    await expect(exportAudit('txt' as ExportFormat, input())).rejects.toThrow('This export format is not available.');
    await expect(exportAudit('md', input({ documents: ['nope' as never] }))).rejects.toThrow(
      'There is no document to export.'
    );
  });
});

describe('several documents in one file', () => {
  it('HTML has one top heading and every selected document under it, each on a new page', async () => {
    const html = (await exportAudit('html', input())).body.toString('utf8');
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html.match(/<div class="pagebreak">/g)).toHaveLength(4);
    for (const doc of generateAuditDocuments(input())) expect(html).toContain(`<h2>${doc.title}</h2>`);
  });

  it('Markdown and PDF hold the same documents; Word holds them all', async () => {
    const md = (await exportAudit('md', input({ documents: ['structure', 'findings'] }))).body.toString('utf8');
    expect(md.startsWith(`# ${en.documentTitles.structure} · ${en.documentTitles.findings}\n`)).toBe(true);
    const topHeadings = md.split('\n').filter((l) => /^## /.test(l));
    expect(topHeadings).toEqual([`## ${en.documentTitles.structure}`, `## ${en.documentTitles.findings}`]);
    const pdf = fakePdf();
    const file = await exportAudit('pdf', input({ documents: ['structure', 'findings'] }), {
      renderPdf: pdf.renderPdf,
    });
    expect(file.body.toString()).toBe('%PDF-1.7 fake');
    expect(pdf.printed).toHaveLength(1);
    expect(pdf.printed[0]).toContain(`<h2>${en.documentTitles.findings}</h2>`);
    const docx = await exportAudit('docx', input());
    const xml = unzip(docx.body).get('word/document.xml')!.toString('utf8');
    for (const doc of generateAuditDocuments(input())) expect(xml).toContain(doc.title);
  });
});

describe('documents barrel', () => {
  it('exports the public API', () => {
    for (const name of [
      'generateAuditDocuments',
      'generatePitchGlimpse',
      'generateOwnerAudit',
      'exportAudit',
      'exportPitchGlimpse',
      'exportOwnerAudit',
      'buildSiteJson',
      'buildEditedView',
      'validateAuditEditsPatch',
      'buildRoadmap',
      'buildPitchGlimpse',
      'buildOwnerAudit',
      'resolveAuditSettings',
      'renderMarkdown',
      'renderHtml',
      'renderDocx',
      'renderPdf',
      'writeZip',
      'labelsFor',
    ]) {
      expect(typeof (barrel as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});
