import { describe, it, expect, afterAll } from 'vitest';
import { BrowserManager } from '../src/browser.js';
import { EvidenceCollector } from '../src/evidence.js';
import path from 'path';
import os from 'os';

describe('Multi-Browser Support & Network Intelligence (FR-1.4, FR-6.3.1)', () => {
  const browserManager = new BrowserManager();

  afterAll(async () => {
    await browserManager.close();
  });

  it('launches requested browser engine and opens page', async () => {
    const { context, page } = await browserManager.openPage({
      engine: 'chromium',
      headless: true,
    });
    try {
      expect(page).toBeDefined();
      await page.setContent('<html><body><h1>Hello Multi-Browser</h1></body></html>');
      const text = await page.textContent('h1');
      expect(text).toBe('Hello Multi-Browser');
    } finally {
      await context.close();
    }
  });

  it('EvidenceCollector measures network request durationMs (FR-6.3.1)', async () => {
    const tmpEvidenceDir = path.join(os.tmpdir(), `qa-evidence-${Date.now()}`);
    const collector = new EvidenceCollector(tmpEvidenceDir);
    const { context, page } = await browserManager.openPage({
      engine: 'chromium',
      headless: true,
    });

    try {
      collector.attach(page);
      await page.route('**/api/test-endpoint', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true }),
        });
      });

      await page.setContent('<html><body><h1>Test</h1></body></html>');
      await page.evaluate(async () => {
        await fetch('http://localhost:3000/api/test-endpoint');
      });
      await page.waitForTimeout(100);

      const networkLogs = collector.getNetworkLogs();
      const testReq = networkLogs.find((n) => n.url.includes('/api/test-endpoint'));
      expect(testReq).toBeDefined();
      expect(testReq?.status).toBe(200);
      expect(testReq?.durationMs).toBeDefined();
      expect(testReq?.durationMs).toBeGreaterThanOrEqual(20);
    } finally {
      await context.close();
    }
  });
});
