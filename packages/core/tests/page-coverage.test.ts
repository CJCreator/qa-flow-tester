import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import path from 'path';
import { promises as fs } from 'fs';
import { chromium, type Browser } from 'playwright';
import { server } from '../../../fixtures/test-app/server.js';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';

const PORT = 3541;
const STUB_PORT = 3542;
const outputDir = path.join(process.cwd(), '.tmp-page-coverage');

describe('page coverage: found = reached + skipped', () => {
  let stub: http.Server;
  let browser: Browser;

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));
    stub = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://x');
      if (url.pathname === '/broken') {
        req.socket.destroy();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
      res.end(
        url.pathname === '/'
          ? '<html><head><title>Home</title></head><body><a href="/ok">Ok</a><a href="/broken?token=secret">Broken</a></body></html>'
          : '<html><head><title>Ok</title></head><body>ok</body></html>'
      );
    });
    await new Promise<void>((resolve) => stub.listen(STUB_PORT, resolve));
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('maxPages 3: skipped pages are page-limit and the numbers add up', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const draft = await new DiscoveryAgent().discover({
        targetUrl: `http://localhost:${PORT}`,
        productId: 'coverage',
        outputDir,
        maxPages: 3,
        profile: { name: 'Coverage', productId: 'coverage', roles: [] },
      } as never);
      const coverage = draft.exploration?.pageCoverage;
      expect(coverage).toBeTruthy();
      expect(coverage!.found).toBe(coverage!.reached + coverage!.skipped.length);
      expect(coverage!.reached).toBeLessThanOrEqual(3);
      expect(coverage!.skipped.length).toBeGreaterThan(0);
      expect(coverage!.skipped.some((s) => s.why === 'page-limit')).toBe(true);
      expect(JSON.stringify(coverage)).not.toContain('?');
    } finally {
      log.mockRestore();
    }
  }, 120000);

  it('a page that fails to load is skipped as did-not-load, path only', async () => {
    const context = await browser.newContext();
    const result = await new DeterministicSpider().crawl(context, `http://localhost:${STUB_PORT}`, {
      exploreClicks: false,
    });
    await context.close();
    expect(result.pages.map((p) => p.urlPath)).toContain('/ok');
    expect(result.skipped).toEqual([{ urlPath: '/broken', why: 'did-not-load' }]);
  }, 60000);
});
