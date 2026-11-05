import { createReadStream, type Stats } from 'fs';
import type http from 'http';

/**
 * Evidence file responses (LAT-5, LAT-6): streamed from disk, with a weak ETag from size and mtime and
 * 304 Not Modified when the client already has it. Cache-Control is `no-cache`: the browser keeps the
 * file but asks again each time, so a file rewritten in place is never served stale.
 */

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.webm': 'video/webm',
};

/** Content-Type for an evidence file by its extension (lower-cased by the caller or here). */
export function evidenceContentType(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** Weak ETag from size and modification time: changes whenever the file is rewritten. */
export function evidenceEtag(stat: Pick<Stats, 'size' | 'mtimeMs'>): string {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

/** True when If-None-Match lists the tag (weak comparison) or is `*`. */
export function isNotModified(req: http.IncomingMessage, etag: string): boolean {
  const header = req.headers['if-none-match'];
  if (!header) return false;
  const strip = (tag: string) => tag.trim().replace(/^W\//, '');
  const want = strip(etag);
  return header
    .split(',')
    .map((t) => t.trim())
    .some((t) => t === '*' || strip(t) === want);
}

/** Sends a file already stat'ed by the caller: 304 when the client's copy is current, else the stream. */
export function sendEvidenceFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
  stat: Pick<Stats, 'size' | 'mtimeMs'>,
  contentType: string
): void {
  const etag = evidenceEtag(stat);
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
  if (isNotModified(req, etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Type': contentType, 'Content-Length': stat.size });
  const stream = createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
