import http from 'http';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';

export function isInside(dir: string, file: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Saved sign-in sessions (auth/<role>.json) hold live session cookies: no folder called "auth" is
 * served, at any depth. Any case: Windows and macOS read "AUTH" as "auth".
 */
export function isSavedSession(dir: string, file: string): boolean {
  return path
    .relative(dir, file)
    .split(path.sep)
    .some((part) => part.toLowerCase() === 'auth');
}

/** True when a decoded path has a ".." part, split on either kind of slash. */
export function hasDotDotSegment(rel: string): boolean {
  return rel.split(/[\\/]/).some((part) => part === '..');
}

/** Run ids are made here ("run-<time>"); anything else in an address is refused, so it can't leave the runs folder. */
export function isRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) && !value.includes('..');
}

export async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false
  );
}

/**
 * Sends a file in pieces instead of reading it whole. A Range request gets 206 with that part, so a video can
 * seek; any other request gets the whole file.
 */
export function sendFileRanged(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  stat: { size: number; mtime: Date },
  contentType: string,
  extra: Record<string, string> = {}
): void {
  const size = stat.size;
  let start = 0;
  let end = size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? '').trim());
  const partial = !!range && (!!range[1] || !!range[2]);
  if (range && partial) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(size - Number(range[2]), 0);
    }
  }
  const headers = {
    ...extra,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Last-Modified': stat.mtime.toUTCString(),
  };
  if (end < start) {
    // An empty file, or a range past its end.
    res.writeHead(partial ? 416 : 200, {
      ...headers,
      'Content-Length': 0,
      ...(partial ? { 'Content-Range': `bytes */${size}` } : {}),
    });
    res.end();
    return;
  }
  res.writeHead(partial ? 206 : 200, {
    ...headers,
    'Content-Length': end - start + 1,
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  });
  createReadStream(file, { start, end })
    .on('error', () => res.destroy())
    .pipe(res);
}

export const DOWNLOADABLE_REPORT_FILES: Record<string, string> = {
  'report.html': 'text/html; charset=utf-8',
  'report.md': 'text/markdown; charset=utf-8',
  'findings.json': 'application/json; charset=utf-8',
  'issues.md': 'text/markdown; charset=utf-8',
  'issues.html': 'text/html; charset=utf-8',
};
