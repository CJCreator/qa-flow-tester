/**
 * LAT-5/LAT-6: evidence files are streamed with ETag, Cache-Control and 304 Not Modified.
 * Unit tier: a loopback http server on a temp folder; no browser, no runner.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  evidenceContentType,
  evidenceEtag,
  evidenceSafetyHeaders,
  isNotModified,
  sendEvidenceFile,
} from '../src/evidence-file.js';

let dir: string;
let server: http.Server;
let base: string;
const file = () => path.join(dir, 'shot.png');

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-file-'));
  await fs.writeFile(file(), Buffer.from('PNGDATA'));
  server = http.createServer(async (req, res) => {
    const stat = await fs.stat(file());
    sendEvidenceFile(req, res, file(), stat, evidenceContentType('.png'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  base = `http://127.0.0.1:${addr.port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

describe('evidence file responses (LAT-5, LAT-6)', () => {
  it('maps extensions to content types, unknown ones to octet-stream', () => {
    expect(evidenceContentType('.PNG')).toBe('image/png');
    expect(evidenceContentType('.webm')).toBe('video/webm');
    expect(evidenceContentType('.html')).toBe('text/html; charset=utf-8');
    expect(evidenceContentType('.bin')).toBe('application/octet-stream');
  });

  it('serves 200 with ETag, no-cache, length and the streamed body', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('etag')).toBe(evidenceEtag(await fs.stat(file())));
    expect(res.headers.get('content-length')).toBe('7');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('PNGDATA');
  });

  it('answers 304 with no body when If-None-Match carries the current ETag', async () => {
    const first = await fetch(base);
    const etag = first.headers.get('etag') as string;
    await first.arrayBuffer();
    const res = await fetch(base, { headers: { 'If-None-Match': etag } });
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(etag);
    expect(await res.text()).toBe('');
  });

  it('answers 200 again once the file is rewritten (new ETag)', async () => {
    const first = await fetch(base);
    const etag = first.headers.get('etag') as string;
    await first.arrayBuffer();
    await fs.writeFile(file(), Buffer.from('PNGDATA-2-LONGER'));
    const res = await fetch(base, { headers: { 'If-None-Match': etag } });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).not.toBe(etag);
    expect(await res.text()).toBe('PNGDATA-2-LONGER');
  });
});

describe('isNotModified', () => {
  const req = (h?: string) =>
    ({ headers: h === undefined ? {} : { 'if-none-match': h } }) as unknown as http.IncomingMessage;
  const tag = 'W/"7-1a"';

  it('matches weakly, in lists, and with *', () => {
    expect(isNotModified(req(tag), tag)).toBe(true);
    expect(isNotModified(req('"7-1a"'), tag)).toBe(true);
    expect(isNotModified(req('"x", W/"7-1a"'), tag)).toBe(true);
    expect(isNotModified(req('*'), tag)).toBe(true);
  });

  it('does not match another tag or a missing header', () => {
    expect(isNotModified(req('W/"8-1a"'), tag)).toBe(false);
    expect(isNotModified(req(), tag)).toBe(false);
  });
});

describe('evidenceSafetyHeaders', () => {
  it('sandboxes a snapshot of the scanned site', () => {
    expect(evidenceSafetyHeaders('/out/runs/r1/step-3-after.html')).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    });
  });
  it("leaves the tool's own report pages unsandboxed", () => {
    expect(evidenceSafetyHeaders('/out/runs/r1/report.html')).toEqual({ 'X-Content-Type-Options': 'nosniff' });
    expect(evidenceSafetyHeaders('/out/runs/r1/issues.html')).toEqual({ 'X-Content-Type-Options': 'nosniff' });
  });
  it('adds nosniff to images', () => {
    expect(evidenceSafetyHeaders('/out/runs/r1/shot.png')).toEqual({ 'X-Content-Type-Options': 'nosniff' });
  });
});
