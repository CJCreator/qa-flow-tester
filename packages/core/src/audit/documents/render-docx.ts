/**
 * Renders `AuditDoc`s to one Word (.docx) file: WordprocessingML written by hand and zipped by zip.ts, no
 * dependency (REQ-022). Each document starts on a new page with its title as Heading1; block headings follow
 * as Heading2.. (the HTML renderer's h2..), then paragraphs, lists, tables, embedded PNG/JPEG images, notes
 * and page breaks, on A4.
 *
 * Every run carries the document's language (`w:lang`, `ta-IN` for Tamil) and a complex-script font that
 * covers Tamil ('Nirmala UI', with 'Latha' as the font table's fallback). All text is XML-escaped and
 * characters XML cannot hold are dropped, so page text cannot add markup.
 *
 * Node-only module: never imported by the wizard.
 */

import { DOCUMENT_LANGUAGE_INFO, type DocumentLanguage } from '@qa/types';
import { isEmbeddableImage, normalizedRows, type AuditDoc, type DocBlock } from './model.js';
import { documentBetaNote, labelsFor } from './labels/index.js';
import { writeZip, type ZipFileEntry } from './zip.js';

/** The font for Latin text. */
export const DOCX_LATIN_FONT = 'Calibri';
/** The complex-script font: Tamil and the other Indic scripts on Windows 8+. */
export const DOCX_COMPLEX_SCRIPT_FONT = 'Nirmala UI';
/** The fallback complex-script font for Tamil on older Windows. */
export const DOCX_COMPLEX_SCRIPT_FALLBACK = 'Latha';

const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// A4 in twentieths of a point, with the HTML print margins (18 mm top and bottom, 16 mm sides).
const PAGE = { width: 11906, height: 16838, top: 1021, bottom: 1021, side: 907 };
// Widest image: the text width (A4 less both margins) in EMU (1 twip = 635 EMU).
const MAX_IMAGE_EMU = (PAGE.width - 2 * PAGE.side) * 635;
const EMU_PER_PX = 9525; // at 96 dpi

/** The `w:lang` value for a document language, for example `ta-IN`. */
export function docxLanguageTag(language: DocumentLanguage): string {
  return `${language}-IN`;
}

/** Text safe inside an XML element or attribute: escaped, with characters XML 1.0 cannot hold removed. */
function xml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Image {
  rel: string;
  file: string;
  bytes: Buffer;
}

interface Context {
  doc: AuditDoc;
  rtl: boolean;
  lang: string;
  images: Image[];
  lists: Array<{ ordered: boolean }>;
}

function runProps(ctx: Context, extra = ''): string {
  return (
    `<w:rPr><w:rFonts w:ascii="${DOCX_LATIN_FONT}" w:hAnsi="${DOCX_LATIN_FONT}" w:cs="${DOCX_COMPLEX_SCRIPT_FONT}"/>` +
    `${extra}${ctx.rtl ? '<w:rtl/>' : ''}<w:lang w:val="${ctx.lang}" w:bidi="${ctx.lang}"/></w:rPr>`
  );
}

/** One run of text; newlines become line breaks and tabs become tabs. */
function run(ctx: Context, text: string, extra = ''): string {
  const parts = text
    .replace(/\r\n?/g, '\n')
    .split(/(\n|\t)/)
    .map((part) =>
      part === '\n'
        ? '<w:br/>'
        : part === '\t'
          ? '<w:tab/>'
          : part
            ? `<w:t xml:space="preserve">${xml(part)}</w:t>`
            : ''
    )
    .join('');
  return `<w:r>${runProps(ctx, extra)}${parts}</w:r>`;
}

function paragraph(ctx: Context, body: string, props = ''): string {
  const bidi = ctx.rtl ? '<w:bidi/>' : '';
  const pPr = props || bidi ? `<w:pPr>${props}${bidi}</w:pPr>` : '';
  return `<w:p>${pPr}${body}</w:p>`;
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** Pixel size of a PNG or JPEG, or null when the header cannot be read. */
export function imageSize(bytes: Buffer, mime: 'png' | 'jpeg'): { width: number; height: number } | null {
  if (mime === 'png') {
    if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('latin1', 12, 16) !== 'IHDR') {
      return null;
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 9 < bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1]!;
    if (marker === 0xff) {
      pos++;
      continue;
    }
    const length = bytes.readUInt16BE(pos + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = bytes.readUInt16BE(pos + 5);
      const width = bytes.readUInt16BE(pos + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length < 2) return null;
    pos += 2 + length;
  }
  return null;
}

function imageXml(ctx: Context, block: Extract<DocBlock, { type: 'image' }>): string | null {
  if (!isEmbeddableImage(block.src)) return null;
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(block.src);
  if (!match) return null; // GIF and WebP are not embedded in Word
  const mime = match[1] as 'png' | 'jpeg';
  const bytes = Buffer.from(match[2]!, 'base64');
  const size = imageSize(bytes, mime);
  if (!size) return null;

  const n = ctx.images.length + 1;
  const image: Image = { rel: `rIdImage${n}`, file: `image${n}.${mime === 'png' ? 'png' : 'jpeg'}`, bytes };
  ctx.images.push(image);
  let cx = size.width * EMU_PER_PX;
  let cy = size.height * EMU_PER_PX;
  if (cx > MAX_IMAGE_EMU) {
    cy = Math.round((cy * MAX_IMAGE_EMU) / cx);
    cx = MAX_IMAGE_EMU;
  }
  const alt = xml(block.alt);
  return (
    `<w:r>${runProps(ctx)}<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${alt}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${n}" name="${image.file}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${image.rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

const CELL_BORDERS =
  '<w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>`)
    .join('') +
  '</w:tblBorders>';

function tableXml(ctx: Context, block: Extract<DocBlock, { type: 'table' }>): string {
  if (block.columns.length === 0) return '';
  const width = Math.floor((PAGE.width - 2 * PAGE.side) / block.columns.length);
  const cell = (text: string, header: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : ''}</w:tcPr>` +
    `${paragraph(ctx, run(ctx, text, header ? '<w:b/><w:bCs/>' : ''))}</w:tc>`;
  const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.columns.map((c) => cell(c, true)).join('')}</w:tr>`;
  const body = normalizedRows(block)
    .map((row) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${row.map((c) => cell(c, false)).join('')}</w:tr>`)
    .join('');
  const grid = block.columns.map(() => `<w:gridCol w:w="${width}"/>`).join('');
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${ctx.rtl ? '<w:bidiVisual/>' : ''}${CELL_BORDERS}</w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>${head}${body}</w:tbl>` +
    // Word needs a paragraph between two tables and after the last one.
    paragraph(ctx, '')
  );
}

function blockXml(ctx: Context, block: DocBlock): string {
  switch (block.type) {
    case 'heading':
      return paragraph(ctx, run(ctx, block.text), `<w:pStyle w:val="Heading${Math.min(5, block.level + 1)}"/>`);
    case 'paragraph':
      return block.text.trim() ? paragraph(ctx, run(ctx, block.text)) : '';
    case 'list': {
      if (block.items.length === 0) return '';
      ctx.lists.push({ ordered: Boolean(block.ordered) });
      const numId = ctx.lists.length;
      return block.items
        .map((item) =>
          paragraph(
            ctx,
            run(ctx, item),
            `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`
          )
        )
        .join('');
    }
    case 'table':
      return tableXml(ctx, block);
    case 'image': {
      const caption = block.caption ? paragraph(ctx, run(ctx, block.caption), '<w:pStyle w:val="Caption"/>') : '';
      const drawing = imageXml(ctx, block);
      if (drawing) return paragraph(ctx, drawing, '<w:keepNext/>') + caption;
      const missing = labelsFor(ctx.doc.language).labels.status.imageNotIncluded;
      return paragraph(ctx, run(ctx, `${missing}: ${block.alt}`), '<w:pStyle w:val="Note"/>') + caption;
    }
    case 'note':
      return paragraph(ctx, run(ctx, block.text), '<w:pStyle w:val="Note"/>');
    case 'pagebreak':
      return PAGE_BREAK;
  }
}

function documentXml(body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}">` +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/>` +
    `<w:pgMar w:top="${PAGE.top}" w:right="${PAGE.side}" w:bottom="${PAGE.bottom}" w:left="${PAGE.side}" w:header="567" w:footer="567" w:gutter="0"/>` +
    `</w:sectPr></w:body></w:document>`
  );
}

function headingStyle(level: number, size: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
    `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="${level === 1 ? 0 : 360}" w:after="160"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:bCs/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`
  );
}

function stylesXml(lang: string): string {
  const headings = [36, 28, 24, 22, 20].map((size, i) => headingStyle(i + 1, size)).join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS_W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${DOCX_LATIN_FONT}" w:hAnsi="${DOCX_LATIN_FONT}" w:eastAsia="${DOCX_LATIN_FONT}" w:cs="${DOCX_COMPLEX_SCRIPT_FONT}"/>` +
    `<w:color w:val="0F172A"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${lang}" w:bidi="${lang}"/>` +
    `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
    headings +
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/></w:pPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/>` +
    `<w:rPr><w:color w:val="475569"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="64748B"/></w:pBdr>` +
    `<w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/><w:ind w:left="200"/></w:pPr></w:style>` +
    `</w:styles>`
  );
}

function numberingXml(lists: Array<{ ordered: boolean }>): string {
  const level = (ordered: boolean) =>
    `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${ordered ? 'decimal' : 'bullet'}"/>` +
    `<w:lvlText w:val="${ordered ? '%1.' : '•'}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
  // One numbering instance per list, so every ordered list counts from 1.
  const nums = lists
    .map(
      (list, i) =>
        `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${list.ordered ? 1 : 0}"/>` +
        `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${NS_W}">` +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level(false)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level(true)}</w:abstractNum>` +
    `${nums}</w:numbering>`
  );
}

function fontTableXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:fonts xmlns:w="${NS_W}">` +
    `<w:font w:name="${DOCX_LATIN_FONT}"><w:family w:val="swiss"/></w:font>` +
    `<w:font w:name="${DOCX_COMPLEX_SCRIPT_FONT}"><w:altName w:val="${DOCX_COMPLEX_SCRIPT_FALLBACK}"/><w:family w:val="swiss"/></w:font>` +
    `<w:font w:name="${DOCX_COMPLEX_SCRIPT_FALLBACK}"><w:family w:val="swiss"/></w:font>` +
    `</w:fonts>`
  );
}

/** The documents as one .docx file, each starting on a new page. */
export function renderDocx(docs: AuditDoc[]): Buffer {
  if (docs.length === 0) throw new Error('There is no document to export.');
  const images: Image[] = [];
  const lists: Array<{ ordered: boolean }> = [];
  const body = docs
    .map((doc, i) => {
      // The language actually rendered: English when the request fell back (DEC-005), as in render-html.
      const rendered = labelsFor(doc.language).language;
      const ctx: Context = {
        doc,
        rtl: DOCUMENT_LANGUAGE_INFO[rendered]?.dir === 'rtl',
        lang: docxLanguageTag(rendered),
        images,
        lists,
      };
      const title = paragraph(ctx, run(ctx, doc.title), '<w:pStyle w:val="Heading1"/>');
      const beta = documentBetaNote(doc.language);
      const betaNote = beta ? paragraph(ctx, run(ctx, beta), '<w:pStyle w:val="Note"/>') : '';
      const blocks = doc.blocks.map((block) => blockXml(ctx, block)).join('');
      return (i > 0 ? PAGE_BREAK : '') + title + betaNote + blocks;
    })
    .join('');

  const imageRels = images
    .map((image) => `<Relationship Id="${image.rel}" Type="${REL}/image" Target="media/${image.file}"/>`)
    .join('');
  const entries: ZipFileEntry[] = [
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Default Extension="png" ContentType="image/png"/>` +
        `<Default Extension="jpeg" ContentType="image/jpeg"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
        `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
        `<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>` +
        `</Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: 'word/_rels/document.xml.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>` +
        `<Relationship Id="rIdNumbering" Type="${REL}/numbering" Target="numbering.xml"/>` +
        `<Relationship Id="rIdFonts" Type="${REL}/fontTable" Target="fontTable.xml"/>` +
        `${imageRels}</Relationships>`,
    },
    { name: 'word/document.xml', data: documentXml(body) },
    { name: 'word/styles.xml', data: stylesXml(docxLanguageTag(labelsFor(docs[0]!.language).language)) },
    { name: 'word/numbering.xml', data: numberingXml(lists) },
    { name: 'word/fontTable.xml', data: fontTableXml() },
    ...images.map((image) => ({ name: `word/media/${image.file}`, data: image.bytes })),
  ];
  return writeZip(entries);
}
