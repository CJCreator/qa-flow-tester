import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { chromium, type Browser, type Page } from 'playwright';
import { recordPhoneLayout, phoneScreenshotFile } from '../src/audit/phone-layout.js';
import { findClaimWords } from '../src/audit/documents/wording.js';

// Wider than 375px, with a 20x20 px button (below the WCAG 2.5.8 minimum).
const OVERFLOWING = `<!doctype html><html lang="en"><head><title>Wide</title></head><body style="margin:0">
<nav><a href="/">Home</a></nav>
<div style="width:900px;height:40px;background:#ccc">wide banner</div>
<button data-testid="tiny" style="width:20px;height:20px;padding:0;border:0">x</button>
</body></html>`;

// Fits the phone width; its only control is large.
const FITTING = `<!doctype html><html lang="en"><head><title>Fits</title></head><body style="margin:0">
<nav><a href="/" style="display:inline-block;width:120px;height:48px">Home</a></nav>
<p style="max-width:100%">Short text that wraps inside the screen.</p>
</body></html>`;

/** Width and height from a PNG's IHDR chunk. */
function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('recordPhoneLayout (REQ-037)', () => {
  let browser: Browser;
  let versionDir: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    versionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-phone-layout-'));
  });

  afterAll(async () => {
    await browser?.close();
    if (versionDir) await fs.rm(versionDir, { recursive: true, force: true });
  });

  async function openPage(html: string): Promise<{ page: Page; requests: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.setContent(html);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    return { page, requests };
  }

  it('records overflow, a 375px PNG and the overflow and tap-target findings (AC-1)', async () => {
    const { page, requests } = await openPage(OVERFLOWING);
    const { phone, findings } = await recordPhoneLayout(page, { versionDir, urlPath: '/wide' });

    expect(phone.widthPx).toBe(375);
    expect(phone.overflow).toBe(true);
    expect(phone.screenshotPath).toBe(phoneScreenshotFile('/wide'));
    expect(path.isAbsolute(phone.screenshotPath!)).toBe(false);
    const png = await fs.readFile(path.join(versionDir, phone.screenshotPath!));
    expect(pngSize(png).width).toBe(375);

    const overflowFinding = findings.find((f) => f.id.startsWith('F-UX-OVERFLOW-'));
    const targetFinding = findings.find((f) => f.id.startsWith('F-UX-TARGET-') && f.where.dataTestId === 'tiny');
    expect(overflowFinding).toBeDefined();
    expect(targetFinding).toBeDefined();
    expect(targetFinding!.title).toContain('20x20px');
    expect(phone.findingIds).toEqual(findings.map((f) => f.id));
    expect(phone.findingIds).toContain(overflowFinding!.id);
    expect(phone.findingIds).toContain(targetFinding!.id);
    // Only the phone rules: no dead-end or accessibility-scan findings.
    expect(findings.every((f) => /^F-UX-(TARGET|OVERFLOW)-/.test(f.id))).toBe(true);
    expect(findings.every((f) => f.where.breakpoint === '375px' && f.where.urlPath === '/wide')).toBe(true);

    // The previous viewport is back, and nothing was requested.
    expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
    expect(requests).toEqual([]);
    await page.context().close();
  });

  it('a page that fits has no overflow and no overflow finding', async () => {
    const { page, requests } = await openPage(FITTING);
    const { phone, findings } = await recordPhoneLayout(page, { versionDir, urlPath: '/fits' });

    expect(phone.overflow).toBe(false);
    expect(findings.some((f) => f.id.startsWith('F-UX-OVERFLOW-'))).toBe(false);
    expect(phone.findingIds.some((id) => id.startsWith('F-UX-OVERFLOW-'))).toBe(false);
    expect(phone.screenshotPath).not.toBeNull();
    expect(pngSize(await fs.readFile(path.join(versionDir, phone.screenshotPath!))).width).toBe(375);
    expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
    expect(requests).toEqual([]);
    await page.context().close();
  });

  it('a closed page gives a null screenshot and does not throw', async () => {
    const { page } = await openPage(OVERFLOWING);
    await page.context().close();
    const { phone, findings } = await recordPhoneLayout(page, { versionDir, urlPath: '/closed' });
    expect(phone).toEqual({ widthPx: 375, screenshotPath: null, overflow: null, findingIds: [] });
    expect(findings).toEqual([]);
  });

  it('an unwritable folder gives a null screenshot and does not throw', async () => {
    // A file where the version folder should be: nothing can be written under it.
    const blocker = path.join(versionDir, 'not-a-folder');
    await fs.writeFile(blocker, 'x');
    const { page } = await openPage(OVERFLOWING);
    const { phone } = await recordPhoneLayout(page, { versionDir: blocker, urlPath: '/wide' });
    expect(phone.screenshotPath).toBeNull();
    expect(phone.overflow).toBe(true);
    expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
    await page.context().close();
  });

  it('a screenshot path leaving the version folder is refused', async () => {
    const { page } = await openPage(FITTING);
    const { phone } = await recordPhoneLayout(page, {
      versionDir,
      urlPath: '/fits',
      screenshotFile: '../escape.png',
    });
    expect(phone.screenshotPath).toBeNull();
    await expect(fs.access(path.join(versionDir, '..', 'escape.png'))).rejects.toThrow();
    await page.context().close();
  });

  it('finding wording says what was found, never a claim (ADR 0018)', async () => {
    const { page } = await openPage(OVERFLOWING);
    const { findings } = await recordPhoneLayout(page, { versionDir, urlPath: '/wide' });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      const text = [f.title, f.expectedVsActual.expected, f.expectedVsActual.actual, f.resolution].join(' ');
      expect(findClaimWords(text)).toEqual([]);
      expect(text).not.toMatch(/\b(passes|compliant|accessible)\b/i);
    }
    expect(findings.find((f) => f.id.startsWith('F-UX-OVERFLOW-'))!.title).toMatch(/\bfound\b/);
    await page.context().close();
  });

  it('screenshot names are stable, safe and distinct per path', () => {
    expect(phoneScreenshotFile('/')).toMatch(/^phone\/home-[0-9a-f]{8}\.png$/);
    expect(phoneScreenshotFile('/a/b')).not.toBe(phoneScreenshotFile('/a-b'));
    expect(phoneScreenshotFile('/../../x')).toMatch(/^phone\/x-[0-9a-f]{8}\.png$/);
  });
});
