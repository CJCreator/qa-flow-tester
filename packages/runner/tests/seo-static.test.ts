import { describe, it, expect, afterEach } from 'vitest';
import type http from 'http';
import httpServer from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { publicOrigin, serveUi } from '../src/ui-static.js';

const req = (headers: Record<string, string>) => ({ headers }) as unknown as http.IncomingMessage;

describe('publicOrigin', () => {
  afterEach(() => {
    delete process.env.PUBLIC_URL;
  });

  it('uses the host the visitor used', () => {
    expect(publicOrigin(req({ host: 'localhost:3001' }))).toBe('http://localhost:3001');
  });

  it('honours https from a proxy or tunnel', () => {
    expect(publicOrigin(req({ host: 'qa.example.com', 'x-forwarded-proto': 'https' }))).toBe('https://qa.example.com');
  });

  it('prefers PUBLIC_URL when it is valid', () => {
    process.env.PUBLIC_URL = 'https://checkup.example.com/';
    expect(publicOrigin(req({ host: 'localhost:3001' }))).toBe('https://checkup.example.com');
  });

  it('never reflects a malformed host into the page', () => {
    expect(publicOrigin(req({ host: 'evil.com"><script>' }))).toBe('http://localhost');
  });
});

describe('serveUi share image', () => {
  it('sends a .png untouched and fills %ORIGIN% only in html', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-og-'));
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('%ORIGIN%'), Buffer.from([0, 1, 2])]);
    fs.writeFileSync(path.join(dir, 'index.html'), '<meta content="%ORIGIN%/og-image.png">');
    fs.writeFileSync(path.join(dir, 'og-image.png'), png);
    const server = httpServer.createServer((rq, rs) => {
      const pathname = new URL(rq.url ?? '/', 'http://x').pathname;
      void serveUi([{ base: '/', dir, name: 't' }], rq, rs, pathname).then((ok) => {
        if (!ok) {
          rs.writeHead(404);
          rs.end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const html = await (await fetch(`${base}/`)).text();
      expect(html).toContain(`${base}/og-image.png`);
      const res = await fetch(`${base}/og-image.png`);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
    } finally {
      await new Promise((r) => server.close(r));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
