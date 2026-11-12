import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';

/**
 * Word (.docx) to Markdown for Product Context. Server side only (Node).
 * mammoth turns the document into HTML; a small pure step turns that into Markdown.
 * Input is untrusted: the ZIP is checked by hand, declared and inflated sizes, before mammoth sees it.
 */

export const DOCX_MAX_BYTES = 2 * 1024 * 1024;
export const DOCX_MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
export const DOCX_MAX_ENTRIES = 500;
export const DOCX_TIMEOUT_MS = 10_000;
const MAX_WARNINGS = 20;

const BAD_FILE = 'This Word file could not be read. Save it again as .docx and try once more.';

/** Reads the ZIP end record and central directory by hand. Throws a plain-sentence Error. */
export function checkZip(bytes: Uint8Array): void {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error('This file is not a Word (.docx) document. Save it as .docx, .md or .txt.');
  }
  if (bytes.length > DOCX_MAX_BYTES) {
    throw new Error('This Word file is larger than 2 MB. Remove images or split it into smaller files.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(BAD_FILE);
  const entries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('This Word file uses a ZIP format that is not supported. Save it again as .docx.');
  }
  if (entries > DOCX_MAX_ENTRIES) {
    throw new Error(`This Word file holds more than ${DOCX_MAX_ENTRIES} parts. Save it again as a plain .docx.`);
  }
  let pos = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) throw new Error(BAD_FILE);
    const size = view.getUint32(pos + 24, true);
    if (size === 0xffffffff) {
      throw new Error('This Word file expands to more than 20 MB. Split it into smaller files.');
    }
    total += size;
    if (total > DOCX_MAX_UNCOMPRESSED_BYTES) {
      throw new Error('This Word file expands to more than 20 MB. Split it into smaller files.');
    }
    pos += 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  }
}

/**
 * Inflates every entry once, with a hard output cap, before mammoth (JSZip) sees the file: a ZIP can declare
 * small sizes and inflate to gigabytes, and JSZip only notices after inflating. Throws a plain-sentence Error.
 * Call after checkZip, which has already checked the central directory's shape and the declared total.
 */
export function checkInflatedSizes(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(BAD_FILE);
  const entries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff) {
    throw new Error('This Word file uses a ZIP format that is not supported. Save it again as .docx.');
  }
  let pos = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) throw new Error(BAD_FILE);
    const flags = view.getUint16(pos + 8, true);
    if ((flags & 1) !== 0) throw new Error(BAD_FILE);
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const declared = view.getUint32(pos + 24, true);
    const localOffset = view.getUint32(pos + 42, true);

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(BAD_FILE);
    }
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
    if (dataOffset + compressedSize > bytes.length) {
      throw new Error(BAD_FILE);
    }

    if (method === 0) {
      if (compressedSize !== declared) throw new Error(BAD_FILE);
    } else if (method === 8) {
      const slice = bytes.subarray(dataOffset, dataOffset + compressedSize);
      let inflated: Uint8Array;
      try {
        inflated = inflateRawSync(slice, { maxOutputLength: declared + 1 });
      } catch {
        throw new Error(BAD_FILE);
      }
      if (inflated.length !== declared) {
        throw new Error(BAD_FILE);
      }
    } else {
      throw new Error('This Word file uses a ZIP format that is not supported. Save it again as .docx.');
    }

    pos += 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

interface ListState {
  ordered: boolean;
  count: number;
}

/** Pure: the small HTML subset mammoth emits to Markdown. */
export function htmlToMarkdown(html: string): string {
  const blocks: string[] = [];
  const lists: ListState[] = [];
  let inline = '';
  let heading = 0;
  let liPrefix: string | null = null;
  let anchorHref: string[] = [];
  let rows: string[][] | null = null;
  let row: string[] = [];
  let inCell = false;

  const clean = (s: string) =>
    s
      .replace(/\*\*\s*\*\*/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim();
  const flushInline = () => {
    const text = clean(inline);
    inline = '';
    return text;
  };
  const flushBlock = () => {
    if (inCell) return;
    const text = flushInline();
    if (!text) {
      heading = 0;
      liPrefix = null;
      return;
    }
    if (heading > 0) blocks.push(`${'#'.repeat(heading)} ${text}`);
    else if (liPrefix !== null) blocks.push(`${liPrefix}${text}`);
    else blocks.push(text);
    if (liPrefix !== null) blocks[blocks.length - 1] = `\u0000${blocks[blocks.length - 1]}`; // list line marker
    heading = 0;
    liPrefix = null;
  };

  const tokens = html.match(/<[^>]*>|[^<]+/g) ?? [];
  for (const tok of tokens) {
    if (tok[0] !== '<') {
      inline += decodeEntities(tok.replace(/\s+/g, ' '));
      continue;
    }
    const m = /^<(\/?)([a-z0-9]+)([^>]*)>/i.exec(tok);
    if (!m) continue;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    switch (tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        if (closing) flushBlock();
        else {
          flushBlock();
          heading = Number(tag[1]);
        }
        break;
      case 'p':
        if (closing) {
          if (liPrefix === null && !inCell) flushBlock();
          else inline += ' ';
        } else if (liPrefix === null && !inCell) flushBlock();
        break;
      case 'ul':
      case 'ol':
        if (!closing) {
          if (lists.length === 0) flushBlock();
          lists.push({ ordered: tag === 'ol', count: 0 });
        } else {
          flushBlock();
          lists.pop();
        }
        break;
      case 'li':
        if (closing) flushBlock();
        else {
          flushBlock();
          const cur = lists[lists.length - 1];
          if (cur) cur.count++;
          const indent = '  '.repeat(Math.max(0, lists.length - 1));
          liPrefix = `${indent}${cur?.ordered ? `${cur.count}. ` : '- '}`;
        }
        break;
      case 'strong':
      case 'b':
        inline += '**';
        break;
      case 'em':
      case 'i':
        inline += '*';
        break;
      case 'a':
        if (!closing) {
          const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
          anchorHref.push(href && /^https?:/i.test(href) ? decodeEntities(href) : '');
          if (anchorHref[anchorHref.length - 1]) inline += '[';
        } else {
          const href = anchorHref.pop();
          if (href) inline += `](${href})`;
        }
        break;
      case 'br':
        inline += inCell ? ' ' : '\n';
        break;
      case 'table':
        if (!closing) {
          flushBlock();
          rows = [];
        } else {
          if (rows && rows.length > 0) {
            const width = Math.max(...rows.map((r) => r.length));
            const lines = rows.map((r) => {
              const cells = [...r];
              while (cells.length < width) cells.push('');
              return `| ${cells.join(' | ')} |`;
            });
            lines.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`);
            blocks.push(`\u0001${lines.join('\n')}`);
          }
          rows = null;
        }
        break;
      case 'tr':
        if (!closing) row = [];
        else if (rows) rows.push(row);
        break;
      case 'td':
      case 'th':
        if (!closing) {
          inCell = true;
          inline = '';
        } else {
          row.push(clean(inline).replace(/\n/g, ' ').replace(/\|/g, '\\|'));
          inline = '';
          inCell = false;
        }
        break;
      default:
        break; // img, span, sup, etc.: text kept, tag dropped
    }
  }
  inCell = false;
  flushBlock();
  anchorHref = [];

  // Join: list lines stay together, tables are their own block, other blocks get a blank line.
  let out = '';
  let prev: 'none' | 'list' | 'other' = 'none';
  for (const b of blocks) {
    const isList = b.startsWith('\u0000');
    const text = b.replace(/^[\u0000\u0001]/, '');
    if (prev === 'none') out = text;
    else out += (isList && prev === 'list' ? '\n' : '\n\n') + text;
    prev = isList ? 'list' : 'other';
  }
  return out.trim();
}

function escapeStoredHeader(text: string): string {
  return text.replace(/^(\s*)# Document:/gm, '$1\\# Document:');
}

function hideSecrets(text: string): string {
  return text.replace(/password\s*[:=]\s*\S+/gi, '[hidden]');
}

interface MammothLike {
  convertToHtml(
    input: { buffer: Buffer },
    options?: Record<string, unknown>
  ): Promise<{ value: string; messages: Array<{ type?: string; message?: string }> }>;
  images: { imgElement(fn: () => Promise<{ src: string }>): unknown };
}

let mammothCache: MammothLike | undefined;
function loadMammoth(): MammothLike {
  mammothCache ??= createRequire(import.meta.url)('mammoth') as MammothLike;
  return mammothCache;
}

/**
 * Converts .docx bytes to Markdown text. Throws an Error with a plain-sentence message on
 * invalid or oversized input. Never logs or stores the content.
 */
export async function docxToMarkdown(bytes: Uint8Array): Promise<{ text: string; warnings: string[] }> {
  checkZip(bytes);
  checkInflatedSizes(bytes);
  const mammoth = loadMammoth();
  let timer: NodeJS.Timeout | undefined;
  try {
    const converted = mammoth.convertToHtml(
      { buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) },
      { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) }
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Reading this Word file took too long. Split it into smaller files.')),
        DOCX_TIMEOUT_MS
      );
    });
    const result = await Promise.race([converted, timeout]);
    const warnings: string[] = [];
    for (const msg of result.messages ?? []) {
      const text = typeof msg.message === 'string' ? msg.message.trim() : '';
      if (text && !warnings.includes(text) && warnings.length < MAX_WARNINGS) warnings.push(text);
    }
    const text = hideSecrets(escapeStoredHeader(htmlToMarkdown(result.value ?? '')));
    return { text, warnings };
  } catch (err) {
    if (err instanceof Error && /too long/.test(err.message)) throw err;
    throw new Error(BAD_FILE);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
