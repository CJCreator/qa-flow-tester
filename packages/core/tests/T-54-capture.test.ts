import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import type { AddressInfo } from 'net';
import { chromium, type Browser, type Page } from 'playwright';
import { navigate, looksLikeLogin } from '../src/navigate.js';
import { EvidenceCollector } from '../src/evidence.js';

describe('T-54 settle and failure-only evidence', () => {
  describe('navigate settle', () => {
    let server: http.Server;
    let base: string;
    let browser: Browser;

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname === '/poll') {
          // A page that never goes network-idle: it fetches every 200 ms.
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<!doctype html><html><body><p>Polling</p>
            <script>setInterval(() => fetch('/tick?' + Date.now()), 200);</script>
          </body></html>`);
          return;
        }
        if (url.pathname === '/tick') {
          res.writeHead(204);
          res.end();
          return;
        }
        if (url.pathname === '/login') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<!doctype html><html><body><form><input type="password" name="p"></form></body></html>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><body><a href="/x">Link</a></body></html>');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      browser = await chromium.launch({ headless: true });
    });

    afterAll(async () => {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('does not wait the old 3 s when network-idle never fires', async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const res = await navigate(page, `${base}/poll`);
        expect(res.ok).toBe(true);
        // Old default was 3000 ms of settle; the new default cap is 1000 ms.
        expect(res.durationMs).toBeLessThan(2500);
      } finally {
        await context.close();
      }
    });

    it('looksLikeLogin still finds a visible password field without a fixed wait', async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await navigate(page, `${base}/login`);
        const started = Date.now();
        expect(await looksLikeLogin(page)).toBe(true);
        expect(Date.now() - started).toBeLessThan(300);
      } finally {
        await context.close();
      }
    });
  });

  describe('EvidenceCollector failure-only capture', () => {
    let dir: string;

    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 't54-evidence-'));
    });

    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    /** A stand-in page: records whether a screenshot or a DOM dump was taken. */
    function fakePage() {
      const screenshot = vi.fn(async (opts: { path: string }) => {
        await fs.writeFile(opts.path, 'png');
      });
      const content = vi.fn(async () => '<html><body>page</body></html>');
      const page = {
        screenshot,
        content,
        url: () => 'http://app.test/checkout',
        locator: () => ({}),
      } as unknown as Page;
      return { page, screenshot, content };
    }

    it('writes no screenshot and no DOM dump for a passing step', async () => {
      const evidenceDir = path.join(dir, 'pass');
      const collector = new EvidenceCollector(evidenceDir);
      const { page, screenshot, content } = fakePage();

      const ev = await collector.recordStep(page, 1, 'Open cart', 'navigate', 'http://app.test/', true);

      expect(screenshot).not.toHaveBeenCalled();
      expect(content).not.toHaveBeenCalled();
      expect(ev.screenshotPath).toBeUndefined();
      expect(ev.domSnapshotPath).toBeUndefined();
      expect(ev.passed).toBe(true);
      const files = await fs.readdir(evidenceDir).catch(() => [] as string[]);
      expect(files.filter((f) => f.endsWith('.png') || f.endsWith('.html'))).toEqual([]);
    });

    it('writes a screenshot and a DOM dump for a failing step', async () => {
      const evidenceDir = path.join(dir, 'fail');
      const collector = new EvidenceCollector(evidenceDir);
      const { page, screenshot, content } = fakePage();

      const ev = await collector.recordStep(page, 2, 'Pay', 'click', 'http://app.test/', false, 'Element not found');

      expect(screenshot).toHaveBeenCalledTimes(1);
      expect(content).toHaveBeenCalledTimes(1);
      expect(ev.screenshotPath).toBe(path.join(evidenceDir, 'step-2-Pay.png'));
      expect(ev.domSnapshotPath).toBe(path.join(evidenceDir, 'step-2-Pay.html'));
      expect(ev.error).toBe('Element not found');
      await expect(fs.access(ev.screenshotPath!)).resolves.toBeUndefined();
      await expect(fs.access(ev.domSnapshotPath!)).resolves.toBeUndefined();
    });

    it('still reports console and network noise for a passing step', async () => {
      const collector = new EvidenceCollector(path.join(dir, 'noise'));
      const { page } = fakePage();
      const ev = await collector.recordStep(page, 3, 'Load', 'navigate', 'http://app.test/', true);
      expect(ev.consoleErrors).toEqual([]);
      expect(ev.failedRequests).toEqual([]);
      expect(ev.urlAfter).toBe('http://app.test/checkout');
    });
  });
});
