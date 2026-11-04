import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import type { AuditDoc } from '../src/audit/documents/model.js';
import { renderHtml } from '../src/audit/documents/render-html.js';
import { renderPdf } from '../src/audit/documents/render-pdf.js';

// Launches Chromium: listed in BROWSER_TESTS.core (vitest.workspace.ts).

// 1x1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const englishDoc: AuditDoc = {
  kind: 'findings',
  title: 'DocTitleAlpha',
  language: 'en',
  blocks: [
    { type: 'heading', level: 1, text: 'HeadingOne' },
    { type: 'paragraph', text: 'ParagraphOne' },
    { type: 'table', columns: ['ColumnOne'], rows: [['CellOne']] },
    { type: 'image', src: PNG, alt: 'ImageAltOne' },
    { type: 'pagebreak' },
    { type: 'heading', level: 1, text: 'HeadingTwo' },
    { type: 'paragraph', text: 'ParagraphTwo' },
  ],
};

const tamilDoc: AuditDoc = {
  kind: 'pitch-glimpse',
  title: 'உங்கள் இணையதளத்தில் கண்டறியப்பட்ட முக்கிய சிக்கல்கள்',
  language: 'ta',
  blocks: [
    { type: 'heading', level: 1, text: 'பக்க வேகம்' },
    { type: 'paragraph', text: 'இந்தப் பக்கத்தில் படங்களுக்கு மாற்று உரை இல்லை.' },
  ],
};

const latin1 = (pdf: Buffer) => pdf.toString('latin1');

/** Page boxes of every page, in points. */
function mediaBoxes(pdf: Buffer): number[][] {
  return [...latin1(pdf).matchAll(/\/MediaBox\s*\[\s*([\d.\s-]+)\]/g)].map((m) => m[1]!.trim().split(/\s+/).map(Number));
}

const pageCount = (pdf: Buffer) => latin1(pdf).match(/\/Type\s*\/Page\b(?!s)/g)?.length ?? 0;

/** The PDF Info title as text: a literal string or UTF-16BE hex. */
function pdfTitle(pdf: Buffer): string {
  const text = latin1(pdf);
  const hex = /\/Title\s*<FEFF([0-9A-Fa-f]*)>/.exec(text);
  if (hex) return Buffer.from(hex[1]!, 'hex').swap16().toString('utf16le');
  return /\/Title\s*\(([^)]*)\)/.exec(text)?.[1] ?? '';
}

describe('renderPdf', { timeout: 90_000 }, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints rendered HTML to an A4 PDF with the same document (REQ-022 AC-1)', async () => {
    const pdf = await renderPdf(renderHtml(englishDoc), { format: 'A4' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const boxes = mediaBoxes(pdf);
    expect(boxes.length).toBeGreaterThan(0);
    for (const [x0, y0, x1, y1] of boxes) {
      // A4: 210 x 297 mm = 595.28 x 841.89 pt.
      expect(Math.abs(x1! - x0! - 595.28)).toBeLessThan(1);
      expect(Math.abs(y1! - y0! - 841.89)).toBeLessThan(1);
    }
    // The pagebreak block starts a second page.
    expect(pageCount(pdf)).toBe(2);
    expect(pdfTitle(pdf)).toBe('DocTitleAlpha');
  });

  it('embeds a font that covers Tamil for a Tamil document (REQ-022 AC-3)', async () => {
    const pdf = await renderPdf(renderHtml(tamilDoc));
    const text = latin1(pdf);
    expect(pdfTitle(pdf)).toBe(tamilDoc.title);
    // A font program is embedded, and its name is one of the Tamil font stack's fonts (subset prefix first).
    expect(text).toMatch(/\/FontFile[23]?\s/);
    const names = [...text.matchAll(/\/FontName\s*\/(?:[A-Z]{6}\+)?([A-Za-z0-9-]+)/g)].map((m) => m[1]!);
    expect(names.some((name) => /^(NotoSansTamil|NirmalaUI|Latha|FreeSerif)/.test(name))).toBe(true);
  });

  describe('with a local server that must never be reached', () => {
    let server: http.Server;
    let base = '';
    let hits = 0;

    beforeAll(async () => {
      server = http.createServer((_req, res) => {
        hits++;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('aborts every request that is not a data: URI, so nothing leaves the process', async () => {
      const blocked: string[] = [];
      const html = `<!DOCTYPE html><html><head>
        <link rel="stylesheet" href="${base}/style.css">
        <style>@import url("${base}/import.css"); body { background: url("${base}/bg.png"); }
          @font-face { font-family: Remote; src: url("${base}/font.woff2"); } p { font-family: Remote; }</style>
        <script src="${base}/script.js"></script>
        </head><body><p>Hello</p><img src="${base}/image.png"><img src="${PNG}">
        <iframe src="${base}/frame.html"></iframe></body></html>`;
      const pdf = await renderPdf(html, { onBlockedRequest: (url) => blocked.push(url) });
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(hits).toBe(0);
      expect(blocked.length).toBeGreaterThan(0);
      expect(blocked.every((url) => url.startsWith(base))).toBe(true);
      expect(blocked).toContain(`${base}/image.png`);
      expect(blocked).toContain(`${base}/style.css`);
    });
  });

  /** Wraps chromium.launch so the test holds the launched browser and can break its contexts. */
  function spyLaunch(breakContext: (browser: Browser) => void): Browser[] {
    const launched: Browser[] = [];
    const realLaunch = chromium.launch.bind(chromium);
    vi.spyOn(chromium, 'launch').mockImplementation(async (opts) => {
      const browser = await realLaunch(opts);
      launched.push(browser);
      breakContext(browser);
      return browser;
    });
    return launched;
  }

  it('closes the browser when printing fails', async () => {
    const launched = spyLaunch((browser) => {
      vi.spyOn(browser, 'newContext').mockRejectedValue(new Error('internal detail /secret/path'));
    });
    const error = await renderPdf(renderHtml(englishDoc)).catch((err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('The document could not be printed to PDF.');
    expect((error as Error).message).not.toContain('/secret/path');
    expect(launched).toHaveLength(1);
    expect(launched[0]!.isConnected()).toBe(false);
  });

  it('closes the browser when printing takes too long', async () => {
    const launched = spyLaunch((browser) => {
      vi.spyOn(browser, 'newContext').mockReturnValue(new Promise(() => {}));
    });
    const started = Date.now();
    await expect(renderPdf(renderHtml(englishDoc), { timeoutMs: 5_000 })).rejects.toThrow(/took too long/);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(launched).toHaveLength(1);
    expect(launched[0]!.isConnected()).toBe(false);
  });
});
