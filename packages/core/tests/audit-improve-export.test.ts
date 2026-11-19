/**
 * T-415: the Improved version in the downloads. The zip of passing variants, the "Improved version" section in
 * every export format and the bundle, and the Pitch Glimpse thumbnail. Unit tier: the PDF printer is a stub
 * that keeps the HTML it was given.
 */
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ImproveVariant } from '@qa/types';
import { emptyOverlay } from '../src/audit/documents/edits.js';
import { editedViewOf, type AuditDocumentsInput } from '../src/audit/documents/generate.js';
import {
  exportAudit,
  exportImprovedZip,
  exportPitchGlimpse,
  improvedFileName,
  improvedVersionDoc,
  type ImprovedExport,
} from '../src/audit/documents/bundle.js';
import { pitchGlimpseDoc } from '../src/audit/documents/pitch.js';
import { emptyAuditSettings, resolveAuditSettings } from '../src/audit/documents/settings.js';
import { improvePages } from '../src/audit/improve/index.js';
import { auditDocContents, auditDocResult } from './helpers/audit-doc-fixture.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
// 1x1 JPEG.
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const result = auditDocResult();
const pages = improvePages(result);

function variant(page: string, n: number, cites: string[]): ImproveVariant {
  return {
    page,
    variant: n,
    style: n === 1 ? 'clean' : 'bold',
    status: 'made',
    createdAt: '2026-11-19T10:00:00Z',
    cites,
    gate: { passed: true, failed: [], reasons: [] },
  };
}

const improved: ImprovedExport = {
  variants: [
    {
      page: pages[0]!,
      variant: variant('home', 1, ['AF-004', 's2']),
      html: '<!DOCTYPE html><html><body>HomeVariantOne</body></html>',
      after: JPEG,
      before: PNG,
    },
    {
      page: pages[1]!,
      variant: variant(pages[1]!.key, 2, ['AF-003']),
      html: '<!DOCTYPE html><html><body>ServicesVariantTwo</body></html>',
    },
  ],
  findings: result.findings.map((f) => ({ id: f.id, title: f.title })),
};

const input = (): AuditDocumentsInput => ({
  result,
  contents: auditDocContents(),
  edits: emptyOverlay(),
  settings: resolveAuditSettings(emptyAuditSettings(), false),
});

function unzip(bytes: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = bytes.readUInt16LE(eocd + 10);
  let pos = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(pos + 10);
    const compressed = bytes.readUInt32LE(pos + 20);
    const nameLength = bytes.readUInt16LE(pos + 28);
    const local = bytes.readUInt32LE(pos + 42);
    const name = bytes.toString('utf8', pos + 46, pos + 46 + nameLength);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const body = bytes.subarray(start, start + compressed);
    out.set(name, (method === 8 ? inflateRawSync(body) : body).toString('utf8'));
    pos += 46 + nameLength + bytes.readUInt16LE(pos + 30) + bytes.readUInt16LE(pos + 32);
  }
  return out;
}

describe('the HTML download (T-415)', () => {
  it('the zip holds every passing variant and a README naming the source findings', () => {
    const file = exportImprovedZip(improved, result.url, result.version);
    const files = unzip(file.body);
    const names = [...files.keys()];
    expect(names.filter((n) => n.endsWith('.html'))).toHaveLength(2);
    for (const v of improved.variants) {
      const name = names.find((n) => n.endsWith(`/${improvedFileName(v)}`))!;
      expect(files.get(name)).toBe(v.html);
    }
    const readme = files.get(names.find((n) => n.endsWith('/README.md'))!)!;
    expect(readme).toContain('AF-004');
    expect(readme).toContain('AF-003');
    expect(readme).toMatch(/Suggestions, not the live site/);
    expect(() => exportImprovedZip({ ...improved, variants: [] }, result.url, 1)).toThrow(/passed the checks/);
  });
});

describe('the Improved version in every export (T-415)', () => {
  it('md, html, pdf and docx gain the section with before/after images and the cited finding ids', async () => {
    const md = (await exportAudit('md', input(), { improved })).body.toString('utf8');
    expect(md).toContain('Improved version');
    expect(md).toContain('Suggestion, not the live site');
    expect(md).toMatch(/AF-004: /);

    const html = (await exportAudit('html', input(), { improved })).body.toString('utf8');
    expect(html).toContain('Improved version');
    expect(html).toContain(JPEG);
    expect(html).toContain(PNG);
    expect(html).toContain('AF-003');

    let printed = '';
    await exportAudit('pdf', input(), {
      improved,
      renderPdf: async (h) => ((printed = h), Buffer.from('%PDF-stub')),
    });
    expect(printed).toContain('Improved version');
    expect(printed).toContain(JPEG);

    const docx = unzip((await exportAudit('docx', input(), { improved })).body);
    const body = docx.get('word/document.xml')!;
    expect(body).toContain('Improved version');
    expect(body).toContain('AF-004');
    expect([...docx.keys()].some((n) => n.startsWith('word/media/'))).toBe(true);
  });

  it('without a passing variant the exports are unchanged', async () => {
    const plain = (await exportAudit('md', input())).body.toString('utf8');
    const empty = (await exportAudit('md', input(), { improved: { ...improved, variants: [] } })).body.toString('utf8');
    expect(empty).toBe(plain);
    expect(plain).not.toContain('Suggestion, not the live site');
  });

  it('the bundle includes the HTML files and says so in its README', async () => {
    const files = unzip((await exportAudit('bundle', input(), { improved })).body);
    const names = [...files.keys()];
    expect(names.filter((n) => /\/improved\/.+\.html$/.test(n))).toHaveLength(2);
    expect(names.some((n) => n.endsWith('/improved/README.md'))).toBe(true);
    expect(files.get(names.find((n) => /-v\d+\/README\.md$/.test(n))!)).toContain('`improved/`');
  });

  it('the section says it is a suggestion and makes no whole-site claim', () => {
    const doc = improvedVersionDoc(improved, 'en');
    const text = JSON.stringify(doc.blocks);
    expect(text).toContain('Suggestion, not the live site');
    expect(text).not.toMatch(/score|guarantee|compliant|whole site/i);
    expect(improvedVersionDoc(improved, 'ta').title).toBe('மேம்படுத்தப்பட்ட பதிப்பு');
  });
});

describe('the Pitch Glimpse thumbnail (T-415)', () => {
  it('shows the best variant before/after, labelled, with the ids it answers', async () => {
    const best = { urlPath: '/', after: JPEG, pair: PNG, cites: ['AF-004'] };
    const doc = pitchGlimpseDoc(editedViewOf(input()), { optOutText: {}, improved: best });
    const images = doc.blocks.filter((b) => b.type === 'image');
    expect(images.map((b) => (b as { src: string }).src)).toEqual([PNG]);
    expect(JSON.stringify(doc.blocks)).toContain('Suggestion, not the live site: / · Answers: AF-004');

    const file = await exportPitchGlimpse('html', { ...input(), settings: { optOutText: {} } }, {}, best);
    expect(file.body.toString('utf8')).toContain(PNG);
    const without = await exportPitchGlimpse('html', { ...input(), settings: { optOutText: {} } });
    expect(without.body.toString('utf8')).not.toContain('Improved version');
  });
});
