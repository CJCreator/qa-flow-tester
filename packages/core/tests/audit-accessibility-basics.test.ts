import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { UXQualityChecker } from '@qa/checkers';
import type { Finding } from '@qa/types';
import { accessibilityBasics } from '../src/audit/analysis/accessibility-basics.js';
import { createFindingIdAllocator } from '../src/audit/analysis/finding-ids.js';
import { findClaimWords } from '../src/audit/documents/wording.js';
import { AUDIT_SITE_PAGES as P, startAuditSite, type AuditSiteServer } from './helpers/audit-site-server.js';

// Browser test (REQ-038): launches Chromium. Listed in vitest.workspace.ts BROWSER_TESTS (core).

let browser: Browser;
let site: AuditSiteServer;

beforeAll(async () => {
  browser = await chromium.launch();
  site = await startAuditSite();
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

/** Opens a fixture page and records what happens to it afterwards. */
async function openFixture(urlPath: string): Promise<{ page: Page; requests: string[]; navigations: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(site.url(urlPath), { waitUntil: 'load' });
  const requests: string[] = [];
  const navigations: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('framenavigated', (f) => navigations.push(f.url()));
  return { page, requests, navigations };
}

describe('accessibilityBasics (REQ-038)', () => {
  it('records WCAG 2.2 AA automatic-check basics on the gallery page with the image-alt finding (AC-1)', async () => {
    const { page, requests, navigations } = await openFixture(P.gallery);
    const urlBefore = page.url();
    const ids = createFindingIdAllocator(7);

    const out = await accessibilityBasics(page, { urlPath: P.gallery, ids });

    expect(out.note).toBeUndefined();
    expect(out.basics).not.toBeNull();
    const basics = out.basics!;
    expect(basics.standard).toBe('WCAG 2.2');
    expect(basics.level).toBe('AA');
    expect(basics.method).toBe('automatic checks only');
    expect(basics.violations).toBe(out.findings.length);
    expect(basics.violations).toBeGreaterThanOrEqual(1);
    expect(basics.findingIds).toEqual(out.findings.map((f) => f.id));

    // AuditFinding ids continue the version's series.
    expect(out.findings[0].id).toBe('AF-007');
    expect(ids.nextNumber).toBe(7 + out.findings.length);

    const alt = out.findings.find((f) => f.rule === 'image-alt');
    expect(alt).toBeDefined();
    expect(alt!).toMatchObject({
      source: 'checker',
      area: 'accessibility',
      group: 'technical',
      sectionId: null,
      urlPath: P.gallery,
    });
    expect(alt!.findingId).toMatch(/^F-A11Y-/);
    expect(['Blocker', 'Major', 'Minor', 'Suggestion']).toContain(alt!.severity);
    expect(alt!.detail).toContain(P.gallery);
    // Both images without alt are named.
    expect(alt!.detail).toMatch(/2 elements/);
    expect(basics.findingIds).toContain(alt!.id);

    // Only axe violations: no needs-review, scan-failed, tap-target, overflow, dead-end or alt-quality items.
    for (const f of out.findings) {
      expect(f.findingId).toMatch(/^F-A11Y-(?!REVIEW-|SCAN-FAILED-)/);
      expect(f.source).toBe('checker');
      expect(f.area).toBe('accessibility');
    }

    // Read-only: no navigation and no request after the page loaded.
    expect(page.url()).toBe(urlBefore);
    expect(navigations).toEqual([]);
    expect(requests).toEqual([]);

    // ADR 0018: nothing calls the page accessible or compliant.
    expect(findClaimWords(JSON.stringify(out))).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/\baccessible\b|\bcompliant\b|\bcompliance\b/i);
    await page.context().close();
  });

  it('when axe cannot run (closed page), basics is null with a note, never zero violations', async () => {
    const { page } = await openFixture(P.gallery);
    await page.context().close();
    const ids = createFindingIdAllocator();

    const out = await accessibilityBasics(page, { urlPath: P.gallery, ids });

    expect(out.basics).toBeNull();
    expect(out.findings).toEqual([]);
    expect(out.note).toMatch(/accessibility checks did not run/i);
    expect(out.note).toContain(P.gallery);
    expect(ids.nextNumber).toBe(1);
    expect(findClaimWords(JSON.stringify(out))).toEqual([]);
  });

  it('when the checker itself throws, basics is null with a note', async () => {
    const { page } = await openFixture(P.about);
    const spy = vi.spyOn(UXQualityChecker.prototype, 'check').mockRejectedValueOnce(new Error('boom'));
    try {
      const out = await accessibilityBasics(page, { urlPath: P.about, ids: createFindingIdAllocator() });
      expect(out.basics).toBeNull();
      expect(out.findings).toEqual([]);
      expect(out.note).toMatch(/accessibility checks did not run on \/about/i);
    } finally {
      spy.mockRestore();
      await page.context().close();
    }
  });

  it('passes axe on and no phone breakpoint to the checker, and maps only the axe violations', async () => {
    const { page } = await openFixture(P.gallery);
    const spy = vi.spyOn(UXQualityChecker.prototype, 'check');
    try {
      const out = await accessibilityBasics(page, { urlPath: P.gallery, ids: createFindingIdAllocator() });
      expect(spy).toHaveBeenCalledTimes(1);
      const ctx = spy.mock.calls[0][1];
      expect(ctx.enableAxe).toBe(true);
      expect(ctx.breakpoint).not.toBe('375px');
      const raw: Finding[] = await spy.mock.results[0].value;
      const axeIds = raw
        .filter((f) => /^F-A11Y-/.test(f.id) && !/^F-A11Y-(REVIEW|SCAN-FAILED)-/.test(f.id))
        .map((f) => f.id);
      expect(out.findings.map((f) => f.findingId)).toEqual(axeIds);
    } finally {
      spy.mockRestore();
      await page.context().close();
    }
  });
});
