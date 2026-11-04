import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { inflateRawSync, crc32 } from 'node:zlib';
import type { AuditDoc } from '../src/audit/documents/model.js';
import { sanitizeEntryName, writeZip } from '../src/audit/documents/zip.js';
import {
  renderDocx,
  imageSize,
  docxLanguageTag,
  DOCX_COMPLEX_SCRIPT_FONT,
  DOCX_COMPLEX_SCRIPT_FALLBACK,
} from '../src/audit/documents/render-docx.js';
import { checkZip } from '../src/discovery/docx-to-markdown.js';
import { labelsFor } from '../src/audit/documents/labels/index.js';

interface Mammoth {
  convertToHtml(input: { buffer: Buffer }): Promise<{ value: string; messages: Array<{ type: string; message: string }> }>;
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>;
}
const mammoth = createRequire(import.meta.url)('mammoth') as Mammoth;

// 1x1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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

const englishDoc = (): AuditDoc => ({
  kind: 'findings',
  title: 'DocTitleAlpha',
  language: 'en',
  blocks: [
    { type: 'heading', level: 1, text: 'HeadingOne' },
    { type: 'paragraph', text: 'ParagraphOne' },
    { type: 'list', items: ['ListItemOne', 'ListItemTwo'] },
    { type: 'list', ordered: true, items: ['OrderedOne', 'OrderedTwo'] },
    { type: 'heading', level: 2, text: 'HeadingTwo' },
    {
      type: 'table',
      columns: ['ColumnOne', 'ColumnTwo'],
      rows: [['CellOneOne', 'CellOneTwo'], ['CellTwoOne']],
    },
    { type: 'note', text: 'NoteOne' },
    { type: 'pagebreak' },
    { type: 'heading', level: 3, text: 'HeadingThree' },
    { type: 'image', src: PNG, alt: 'ImageAltOne', caption: 'CaptionOne' },
    { type: 'image', src: 'https://example.com/x.png', alt: 'RemoteAlt' },
    { type: 'paragraph', text: 'Tricky <w:p> & "quotes" \u0001 end' },
  ],
});

const TAMIL_TITLE = 'உங்கள் இணையதளத்தில் கண்டறியப்பட்ட முக்கிய சிக்கல்கள்';
const TAMIL_TEXTS = [
  'பக்க வேகம்',
  'இந்தப் பக்கத்தில் படங்களுக்கு மாற்று உரை இல்லை.',
  'தலைப்பு குறிச்சொல் காணப்படவில்லை',
  'பக்கம்',
  'கண்டறிந்தது',
  'முகப்பு',
];
const tamilDoc = (): AuditDoc => ({
  kind: 'pitch-glimpse',
  title: TAMIL_TITLE,
  language: 'ta',
  blocks: [
    { type: 'heading', level: 1, text: TAMIL_TEXTS[0]! },
    { type: 'paragraph', text: TAMIL_TEXTS[1]! },
    { type: 'list', items: [TAMIL_TEXTS[2]!] },
    { type: 'table', columns: [TAMIL_TEXTS[3]!, TAMIL_TEXTS[4]!], rows: [[TAMIL_TEXTS[5]!, '/']] },
  ],
});

describe('sanitizeEntryName', () => {
  it('keeps a plain relative path', () => {
    expect(sanitizeEntryName('word/document.xml')).toBe('word/document.xml');
    expect(sanitizeEntryName('[Content_Types].xml')).toBe('[Content_Types].xml');
  });

  it('removes traversal, absolute paths, drive letters and backslashes', () => {
    expect(sanitizeEntryName('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeEntryName('/abs/file.txt')).toBe('abs/file.txt');
    expect(sanitizeEntryName('C:\\Windows\\..\\evil.txt')).toBe('Windows/evil.txt');
    expect(sanitizeEntryName('a/./b//c/../d.txt')).toBe('a/b/c/d.txt');
    expect(sanitizeEntryName('\\\\server\\share\\x.md')).toBe('server/share/x.md');
  });

  it('replaces control and reserved characters', () => {
    expect(sanitizeEntryName('re\u0000port:<1>?.md')).toBe('re_port__1__.md');
  });

  it('keeps Unicode names', () => {
    expect(sanitizeEntryName('அறிக்கை/பக்கம்.md')).toBe('அறிக்கை/பக்கம்.md');
  });

  it('rejects a name with nothing usable left', () => {
    expect(() => sanitizeEntryName('../..')).toThrow(/no usable name/);
    expect(() => sanitizeEntryName('')).toThrow(/no usable name/);
  });
});

describe('writeZip', () => {
  it('writes sorted, sanitized entries that read back byte for byte', () => {
    const big = 'repeat '.repeat(2000);
    const binary = new Uint8Array([0, 1, 2, 250, 251, 252]);
    const zip = writeZip([
      { name: 'z/last.txt', data: big },
      { name: '../a/first.md', data: 'அறிக்கை' },
      { name: 'm/bin.dat', data: binary },
    ]);
    const files = unzip(zip);
    expect([...files.keys()]).toEqual(['a/first.md', 'm/bin.dat', 'z/last.txt']);
    expect(files.get('a/first.md')!.toString('utf8')).toBe('அறிக்கை');
    expect([...files.get('m/bin.dat')!]).toEqual([...binary]);
    expect(files.get('z/last.txt')!.toString('utf8')).toBe(big);
    // The repeated text was deflated.
    expect(zip.length).toBeLessThan(big.length);
  });

  it('is deterministic', () => {
    const entries = [
      { name: 'b.txt', data: 'two' },
      { name: 'a.txt', data: 'one' },
    ];
    expect(writeZip(entries).equals(writeZip([...entries].reverse()))).toBe(true);
  });

  it('rejects two entries that sanitize to the same name', () => {
    expect(() =>
      writeZip([
        { name: 'a/b.txt', data: '1' },
        { name: '../a/b.txt', data: '2' },
      ])
    ).toThrow(/two files named a\/b\.txt/);
  });

  it('writes a valid empty archive', () => {
    const zip = writeZip([]);
    expect(zip.length).toBe(22);
    expect(unzip(zip).size).toBe(0);
  });
});

describe('imageSize', () => {
  it('reads PNG and JPEG dimensions', () => {
    expect(imageSize(Buffer.from(PNG.split(',')[1]!, 'base64'), 'png')).toEqual({ width: 1, height: 1 });
    // SOI, an APP0 segment, then SOF0 with height 300 and width 640.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x80, 0x03,
      0x01, 0x22, 0x00,
    ]);
    expect(imageSize(jpeg, 'jpeg')).toEqual({ width: 640, height: 300 });
    expect(imageSize(Buffer.from('not an image'), 'png')).toBeNull();
    expect(imageSize(Buffer.from('not an image'), 'jpeg')).toBeNull();
  });
});

// The first call loads mammoth (a few seconds cold on a slow disk).
describe('renderDocx', { timeout: 30_000 }, () => {
  it('produces a .docx whose headings, paragraphs, list items and table cells mammoth reads back (REQ-022 AC-2)', async () => {
    const docx = renderDocx([englishDoc(), tamilDoc()]);
    expect(() => checkZip(docx)).not.toThrow();
    const { value: html } = await mammoth.convertToHtml({ buffer: docx });

    expect(html).toContain('<h1>DocTitleAlpha</h1>');
    expect(html).toContain('<h2>HeadingOne</h2>');
    expect(html).toContain('<h3>HeadingTwo</h3>');
    expect(html).toContain('<h4>HeadingThree</h4>');
    expect(html).toContain('<p>ParagraphOne</p>');
    expect(html).toMatch(/<ul><li>ListItemOne<\/li><li>ListItemTwo<\/li><\/ul>/);
    expect(html).toMatch(/<ol><li>OrderedOne<\/li><li>OrderedTwo<\/li><\/ol>/);
    // A header row (bold, repeated on each page), then the body rows; the short row was padded to two cells.
    expect(html).toContain(
      '<table><thead><tr><th><p><strong>ColumnOne</strong></p></th><th><p><strong>ColumnTwo</strong></p></th></tr></thead>' +
        '<tbody><tr><td><p>CellOneOne</p></td><td><p>CellOneTwo</p></td></tr><tr><td><p>CellTwoOne</p></td><td></td></tr></tbody></table>'
    );
    expect(html).toContain('NoteOne');
    expect(html).toContain(`<img alt="ImageAltOne" src="${PNG}" />`);
    expect(html).toContain('<p>CaptionOne</p>');
    expect(html).toContain(`<p>${labelsFor('en').labels.status.imageNotIncluded}: RemoteAlt</p>`);
    // Markup in text stays text; a control character is dropped.
    expect(html).toContain('<p>Tricky &lt;w:p&gt; &amp; "quotes"  end</p>');
    expect(html).toContain(`<h1>${TAMIL_TITLE}</h1>`);
  });

  it('puts each document on a new page, page breaks in place and A4 page size', () => {
    const files = unzip(renderDocx([englishDoc(), tamilDoc()]));
    const xml = files.get('word/document.xml')!.toString('utf8');
    // One pagebreak block plus one between the two documents.
    expect(xml.match(/<w:br w:type="page"\/>/g)?.length).toBe(2);
    expect(xml).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
    expect(files.has('word/media/image1.png')).toBe(true);
    expect([...files.keys()]).toEqual([...files.keys()].sort());
  });

  it('reads Tamil back character for character, with w:lang ta-IN and a Tamil complex-script font', async () => {
    const docx = renderDocx([tamilDoc()]);
    const { value: raw } = await mammoth.extractRawText({ buffer: docx });
    const paragraphs = raw.split('\n').filter((line) => line.length > 0);
    expect(paragraphs).toEqual([TAMIL_TITLE, ...TAMIL_TEXTS.slice(0, 5), TAMIL_TEXTS[5], '/']);

    const files = unzip(docx);
    const xml = files.get('word/document.xml')!.toString('utf8');
    const runs = xml.match(/<w:r>.*?<\/w:r>/g) ?? [];
    const tamilRuns = runs.filter((r) => /[\u0B80-\u0BFF]/.test(r));
    expect(tamilRuns.length).toBe(TAMIL_TEXTS.length + 1);
    for (const r of tamilRuns) {
      expect(r).toContain('<w:lang w:val="ta-IN" w:bidi="ta-IN"/>');
      expect(r).toContain(`w:cs="${DOCX_COMPLEX_SCRIPT_FONT}"`);
    }
    expect(DOCX_COMPLEX_SCRIPT_FONT).toBe('Nirmala UI');
    const fonts = files.get('word/fontTable.xml')!.toString('utf8');
    expect(fonts).toContain(`<w:font w:name="Nirmala UI"><w:altName w:val="${DOCX_COMPLEX_SCRIPT_FALLBACK}"/>`);
    expect(DOCX_COMPLEX_SCRIPT_FALLBACK).toBe('Latha');
    expect(docxLanguageTag('ta')).toBe('ta-IN');
  });

  it('renders an Urdu request in English, left-to-right, as the HTML renderer does (DEC-005)', () => {
    const xml = unzip(renderDocx([{ kind: 'findings', title: 'عنوان', language: 'ur', blocks: [] }]))
      .get('word/document.xml')!
      .toString('utf8');
    expect(xml).not.toContain('<w:bidi/>');
    expect(xml).not.toContain('<w:rtl/>');
    expect(xml).toContain('w:val="en-IN"');
    expect(xml).not.toContain('w:val="ur-IN"');
  });

  it('carries the beta note for a beta language and not for Tamil (DEC-005)', async () => {
    const hi: AuditDoc = { kind: 'findings', title: 'HindiTitle', language: 'hi', blocks: [] };
    const hiText = (await mammoth.extractRawText({ buffer: renderDocx([hi]) })).value;
    expect(hiText).toContain('Beta translation');
    const taText = (await mammoth.extractRawText({ buffer: renderDocx([tamilDoc()]) })).value;
    expect(taText).not.toContain('Beta translation');
  });

  it('starts every ordered list at 1', () => {
    const doc: AuditDoc = {
      kind: 'findings',
      title: 'T',
      language: 'en',
      blocks: [
        { type: 'list', ordered: true, items: ['A1', 'A2'] },
        { type: 'paragraph', text: 'Between' },
        { type: 'list', ordered: true, items: ['B1'] },
      ],
    };
    const numbering = unzip(renderDocx([doc])).get('word/numbering.xml')!.toString('utf8');
    expect(numbering.match(/<w:num w:numId=/g)?.length).toBe(2);
    expect(numbering.match(/<w:startOverride w:val="1"\/>/g)?.length).toBe(2);
  });

  it('refuses an empty export', () => {
    expect(() => renderDocx([])).toThrow(/no document/);
  });
});
