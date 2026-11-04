/**
 * A minimal ZIP writer on `node:zlib` (deflate and CRC-32), used for the Word (.docx) export and the export
 * bundle. Node-only: never imported by the wizard. No dependency (REQ-022).
 *
 * Entry names are sanitized (forward slashes, no drive letter, no leading slash, no `.` or `..` segment, no
 * control or reserved characters) and sorted, so an archive can never write outside the folder it is unpacked
 * into, and the same files always give the same bytes (fixed timestamps).
 */

import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipFileEntry {
  /** A relative path with `/` separators, for example `word/document.xml`. */
  name: string;
  /** Text is written as UTF-8. */
  data: Uint8Array | string;
}

// 1980-01-01 00:00:00 in DOS format, so the same files always give the same bytes.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;
const MAX_NAME_BYTES = 0xffff;
const MAX_32 = 0xffffffff;

/**
 * The entry name made safe to unpack: backslashes become `/`, a drive letter and leading slashes are dropped,
 * `.`, `..` and empty segments are removed, and control or reserved characters become `_`.
 * Throws when nothing is left.
 */
export function sanitizeEntryName(name: string): string {
  const segments = name
    .replace(/\\/g, '/')
    .replace(/^[a-zA-Z]:/, '')
    .split('/')
    .map((segment) => segment.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim())
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  const clean = segments.join('/');
  if (!clean) throw new Error('A file in the archive has no usable name.');
  if (Buffer.byteLength(clean, 'utf8') > MAX_NAME_BYTES) throw new Error('A file name in the archive is too long.');
  return clean;
}

interface PreparedEntry {
  name: Buffer;
  crc: number;
  size: number;
  method: 0 | 8;
  body: Buffer;
}

function prepare(entry: ZipFileEntry, name: string): PreparedEntry {
  const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data);
  if (raw.length >= MAX_32) throw new Error('A file in the archive is too large.');
  const deflated = deflateRawSync(raw);
  // Keep whichever is smaller: images are often already compressed.
  const compress = deflated.length < raw.length;
  return {
    name: Buffer.from(name, 'utf8'),
    crc: crc32(raw) >>> 0,
    size: raw.length,
    method: compress ? 8 : 0,
    body: compress ? deflated : raw,
  };
}

/**
 * A ZIP archive of the entries, sorted by sanitized name. Throws when two entries end up with the same name
 * or the archive would need ZIP64 (more than 65,535 entries or 4 GB).
 */
export function writeZip(entries: ZipFileEntry[]): Buffer {
  if (entries.length >= 0xffff) throw new Error('The archive has too many files.');
  const named = entries.map((entry) => ({ entry, name: sanitizeEntryName(entry.name) }));
  named.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (let i = 1; i < named.length; i++) {
    if (named[i]!.name === named[i - 1]!.name) throw new Error(`The archive has two files named ${named[i]!.name}.`);
  }

  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const { entry, name } of named) {
    const file = prepare(entry, name);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0 (deflate)
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(file.method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(file.crc, 14);
    local.writeUInt32LE(file.body.length, 18);
    local.writeUInt32LE(file.size, 22);
    local.writeUInt16LE(file.name.length, 26);
    local.writeUInt16LE(0, 28); // extra
    parts.push(local, file.name, file.body);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(UTF8_NAMES, 8);
    record.writeUInt16LE(file.method, 10);
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(file.crc, 16);
    record.writeUInt32LE(file.body.length, 20);
    record.writeUInt32LE(file.size, 24);
    record.writeUInt16LE(file.name.length, 28);
    record.writeUInt16LE(0, 30); // extra
    record.writeUInt16LE(0, 32); // comment
    record.writeUInt16LE(0, 34); // disk
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE(0, 38); // external attributes
    record.writeUInt32LE(offset, 42);
    central.push(record, file.name);

    offset += local.length + file.name.length + file.body.length;
    if (offset >= MAX_32) throw new Error('The archive is too large.');
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with the directory
  end.writeUInt16LE(named.length, 8);
  end.writeUInt16LE(named.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment
  return Buffer.concat([...parts, directory, end]);
}
