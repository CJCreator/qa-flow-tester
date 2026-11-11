import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { checkInflatedSizes, checkZip, docxToMarkdown, htmlToMarkdown } from '../src/discovery/docx-to-markdown.js';

// --- tiny stored (uncompressed) ZIP writer, test only ---
const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: string;
  deflate?: boolean;
  declaredSize?: number;
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = enc.encode(e.data);
    const crc = crc32(data);
    const method = e.deflate ? 8 : 0;
    const payload = e.deflate ? deflateRawSync(data) : data;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, payload);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, e.declaredSize ?? data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += local.length + payload.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text: string, style?: string, bold = false) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${para(text)}</w:tc>`;
const tableXml = (rows: string[][]) =>
  `<w:tbl>${rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`;

function makeDocx(bodyXml: string, extra: ZipEntry[] = [], options?: { deflate?: boolean }): Uint8Array {
  const deflate = options?.deflate;
  return buildZip([
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      deflate,
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      deflate,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      deflate,
    },
    {
      name: 'word/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
      deflate,
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${bodyXml}</w:body></w:document>`,
      deflate,
    },
    ...extra.map((e) => ({ deflate, ...e })),
  ]);
}

// The first call loads mammoth (about 5 s cold on a slow disk).
describe('docxToMarkdown', { timeout: 30_000 }, () => {
  it('converts headings, bold text and tables to Markdown', async () => {
    const bytes = makeDocx(
      para('Site Map', 'Heading1') +
        para('Who can see what', undefined, true) +
        tableXml([
          ['Route', 'Roles'],
          ['/report', 'lead / manager | HR'],
        ])
    );
    const { text, warnings } = await docxToMarkdown(bytes);
    expect(text).toContain('# Site Map');
    expect(text).toContain('**Who can see what**');
    expect(text).toContain('| Route | Roles |');
    expect(text).toContain('| --- | --- |');
    expect(text).toContain('| /report | lead / manager \\| HR |');
    expect(Array.isArray(warnings)).toBe(true);
  });

  it('escapes a line that looks like a stored-document header', async () => {
    const { text } = await docxToMarkdown(makeDocx(para('Document: fake', 'Heading1')));
    expect(text).not.toMatch(/^# Document:/m);
    expect(text).toContain('\\# Document: fake');
  });

  it('hides password values typed into the document', async () => {
    const { text } = await docxToMarkdown(makeDocx(para('Login with password: hunter2 today')));
    expect(text).not.toContain('hunter2');
    expect(text).toContain('[hidden]');
  });

  it('refuses bytes that are not a ZIP', async () => {
    await expect(docxToMarkdown(new TextEncoder().encode('# just markdown named .docx'))).rejects.toThrow(/not a Word/);
  });

  it('refuses a ZIP that is not a Word document with a plain message', async () => {
    const zip = buildZip([{ name: 'hello.txt', data: 'hi' }]);
    await expect(docxToMarkdown(zip)).rejects.toThrow(/could not be read/);
  });

  it('refuses raw bytes above 2 MB', async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    await expect(docxToMarkdown(big)).rejects.toThrow(/larger than 2 MB/);
  });

  it('refuses a declared uncompressed total above 20 MB (zip bomb)', async () => {
    const bomb = buildZip([{ name: 'word/document.xml', data: 'x', declaredSize: 30 * 1024 * 1024 }]);
    expect(() => checkZip(bomb)).toThrow(/more than 20 MB/);
    await expect(docxToMarkdown(bomb)).rejects.toThrow(/more than 20 MB/);
  });

  it('refuses more than 500 entries', () => {
    const many = buildZip(Array.from({ length: 501 }, (_, i) => ({ name: `f${i}.txt`, data: 'a' })));
    expect(() => checkZip(many)).toThrow(/more than 500 parts/);
  });

  it('accepts a normal small ZIP in checkZip', () => {
    expect(() => checkZip(buildZip([{ name: 'a.txt', data: 'a' }]))).not.toThrow();
  });
});

describe('checkInflatedSizes', () => {
  it('refuses an entry that declares 1 KB and inflates to 30 MB', async () => {
    const bomb = buildZip([
      { name: 'word/document.xml', data: 'x'.repeat(30 * 1024 * 1024), deflate: true, declaredSize: 1024 },
    ]);
    expect(() => checkZip(bomb)).not.toThrow();
    expect(() => checkInflatedSizes(bomb)).toThrow(/could not be read/);
    await expect(docxToMarkdown(bomb)).rejects.toThrow(/could not be read/);
  });

  it('refuses an entry whose inflated size differs from the declared size', () => {
    const mismatch = buildZip([
      { name: 'word/document.xml', data: 'a'.repeat(5000), deflate: true, declaredSize: 4000 },
    ]);
    expect(() => checkInflatedSizes(mismatch)).toThrow(/could not be read/);
  });

  it('refuses a stored entry whose sizes disagree', () => {
    const mismatch = buildZip([{ name: 'word/document.xml', data: 'abc', declaredSize: 10 }]);
    expect(() => checkInflatedSizes(mismatch)).toThrow(/could not be read/);
  });

  it('accepts an honest deflated .docx', async () => {
    const { text } = await docxToMarkdown(makeDocx(para('Hello', 'Heading1'), [], { deflate: true }));
    expect(text).toContain('# Hello');
  });
});

describe('htmlToMarkdown', () => {
  it('handles headings, lists, links and entities', () => {
    const md = htmlToMarkdown(
      '<h2>Flows</h2><p>Go to <a href="https://example.com/x">site</a> &amp; <em>look</em></p>' +
        '<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul><ol><li>first</li><li>second</li></ol>'
    );
    expect(md).toBe(
      [
        '## Flows',
        '',
        'Go to [site](https://example.com/x) & *look*',
        '',
        '- one',
        '- two',
        '  - nested',
        '1. first',
        '2. second',
      ].join('\n')
    );
  });

  it('drops javascript links and empty bold markers', () => {
    const md = htmlToMarkdown('<p><a href="javascript:alert(1)">x</a><strong> </strong>y</p>');
    expect(md).not.toContain('javascript');
    expect(md).not.toContain('****');
  });

  it('is deterministic', () => {
    const html = '<h1>A</h1><table><tr><td>a</td><td>b</td></tr></table>';
    expect(htmlToMarkdown(html)).toBe(htmlToMarkdown(html));
  });
});
