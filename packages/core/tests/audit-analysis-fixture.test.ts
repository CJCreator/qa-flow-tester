/**
 * QA-300: page analysis end to end on the audit fixture site, in Chromium. Independent of the crawl (group G2):
 * the test opens each public fixture page itself, reads it with readPage, runs accessibilityBasics on the Sample
 * Pages (home and gallery), then calls analyseSite with a FetchFn over the local fixture server
 * (makeOutboundFetch with injected NetDeps that only reach 127.0.0.1). Every assertion is against a known
 * scenario of fixtures/audit-site (see AUDIT_SITE_PAGES).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { promises as fs } from 'fs';
import { chromium, type Browser } from 'playwright';
import { MARKETING_SIGNALS, sectionText } from '@qa/types';
import type { AuditFinding, HierarchyNode, PageContent } from '@qa/types';
import {
  accessibilityBasics,
  analyseSite,
  createFindingIdAllocator,
  readPage,
  type AnalysisAccessibility,
  type AnalysisPage,
  type SiteAnalysis,
} from '../src/audit/analysis/index.js';
import { findClaimWords } from '../src/audit/documents/wording.js';
import { defaultNetDeps, makeOutboundFetch, type NetDeps } from '../src/safe-net.js';
import {
  AUDIT_SITE_PAGES as P,
  AUDIT_SITE_ROOT,
  startAuditSite,
  type AuditSiteRequest,
  type AuditSiteServer,
} from './helpers/audit-site-server.js';

/** Skipped Pages: never opened and passed to the analysis as skippedPaths (sign-in, payment, robots). */
const SKIPPED = [P.signIn, P.checkout, P.privateLinked, P.privateSitemapOnly];
const isSkipped = (p: string) => SKIPPED.includes(p as (typeof SKIPPED)[number]) || p.startsWith('/private/');
/** Sample Pages: accessibility basics run on these only. */
const SAMPLES = [P.home, P.gallery];

/** Every public page of the fixture by its URL path, in a stable order with the home page first. */
async function publicFixturePaths(): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.html')) {
        const rel = path.relative(AUDIT_SITE_ROOT, full).split(path.sep).join('/');
        if (rel === '404.html') continue;
        found.push('/' + rel.replace(/\.html$/, '').replace(/(^|\/)index$/, ''));
      }
    }
  };
  await walk(AUDIT_SITE_ROOT);
  const paths = found.map((p) => (p.length > 1 ? p.replace(/\/$/, '') : p)).filter((p) => !isSkipped(p));
  return [P.home, ...paths.filter((p) => p !== P.home).sort()];
}

const pathOf = (r: AuditSiteRequest) => new URL(r.path, 'http://fixture.local').pathname;

function flatten(node: HierarchyNode): string[] {
  return [node.urlPath, ...node.children.flatMap(flatten)];
}

function findNode(node: HierarchyNode, urlPath: string): HierarchyNode | undefined {
  if (node.urlPath === urlPath) return node;
  for (const child of node.children) {
    const hit = findNode(child, urlPath);
    if (hit) return hit;
  }
  return undefined;
}

let site: AuditSiteServer;
let browser: Browser;
let recordedPaths: string[];
const contents = new Map<string, PageContent>();
let analysis: SiteAnalysis;
/** Requests made by the analysis only (the log is cleared after the browser stage). */
let analysisRequests: AuditSiteRequest[];
/** Every request the fixture server saw, browser stage included. */
let allRequests: AuditSiteRequest[];
/** Requests made while the test opened the pages in Chromium. */
let browserRequests: AuditSiteRequest[];
/** Addresses the injected network was asked to connect to. */
const connects: string[] = [];

beforeAll(async () => {
  site = await startAuditSite();
  browser = await chromium.launch();
  recordedPaths = await publicFixturePaths();

  const pages: AnalysisPage[] = [];
  const statusByPath: Record<string, number> = {};
  const accessibility: AnalysisAccessibility[] = [];
  const browserIds = createFindingIdAllocator();
  const context = await browser.newContext();
  try {
    for (const urlPath of recordedPaths) {
      const page = await context.newPage();
      try {
        const response = await page.goto(site.url(urlPath), { waitUntil: 'load' });
        statusByPath[urlPath] = response?.status() ?? 0;
        const { raw, content } = await readPage(page, { responseHeaders: response?.headers() });
        contents.set(urlPath, content);
        // Link steps are not what this test checks: path segments stand in for them.
        pages.push({ urlPath, depth: urlPath === '/' ? 0 : urlPath.split('/').length - 1, raw, content });
        if ((SAMPLES as string[]).includes(urlPath)) {
          const result = await accessibilityBasics(page, { urlPath, ids: browserIds, testCaseId: `QA300-${urlPath}` });
          accessibility.push({ ...result, urlPath });
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  browserRequests = [...site.requests];
  site.clearRequests();

  // The local fixture is 127.0.0.1: the injected network refuses anything else.
  const deps: NetDeps = {
    lookup: async (host) => {
      if (host !== '127.0.0.1') throw new Error(`unexpected lookup ${host}`);
      return ['127.0.0.1'];
    },
    connect: async (req) => {
      connects.push(req.url.toString());
      if (req.url.origin !== site.origin) throw new Error(`refused ${req.url.toString()}`);
      return defaultNetDeps.connect(req);
    },
  };

  analysis = await analyseSite({
    origin: site.origin,
    startPath: P.home,
    pages,
    statusByPath,
    skippedPaths: SKIPPED,
    accessibility,
    fetch: makeOutboundFetch({ deps }),
    firstFindingNumber: 1,
  });
  analysisRequests = [...site.requests];
  allRequests = [...browserRequests, ...analysisRequests];
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

const byRule = (rule: string): AuditFinding[] => analysis.findings.filter((f) => f.rule === rule);
const analysed = (urlPath: string) => analysis.pages.find((p) => p.urlPath === urlPath)!;

describe('setup', () => {
  it('opened every public fixture page and no Skipped Page', () => {
    for (const p of [P.home, P.about, P.gallery, P.tamil, P.duplicateA, P.duplicateB, P.missing]) {
      if (p === P.missing) expect(recordedPaths).not.toContain(p);
      else expect(recordedPaths).toContain(p);
    }
    for (const p of SKIPPED) expect(recordedPaths).not.toContain(p);
    expect(analysis.pages.map((p) => p.urlPath)).toEqual(recordedPaths);
  });
});

describe('REQ-007 hierarchy and internal links', () => {
  it('every recorded fixture page is in the hierarchy exactly once', () => {
    const all = flatten(analysis.hierarchy.root);
    expect(analysis.hierarchy.root.urlPath).toBe(P.home);
    expect([...all].sort()).toEqual([...recordedPaths].sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("the home page's internal links carry the regions menu, footer, breadcrumb and internal with their targets", () => {
    const fromHome = analysis.hierarchy.links.filter((l) => l.from === P.home);
    const has = (region: string, to: string) => fromHome.some((l) => l.region === region && l.to === to);
    expect(has('menu', P.about)).toBe(true);
    expect(has('menu', P.services)).toBe(true);
    expect(has('menu', P.duplicateA)).toBe(true);
    expect(has('footer', P.jsRendered)).toBe(true);
    expect(has('footer', P.about)).toBe(true);
    expect(has('breadcrumb', P.home)).toBe(true);
    expect(has('internal', P.duplicateA)).toBe(true);
    expect(has('internal', P.gallery)).toBe(true);
    expect(has('internal', P.jsRendered)).toBe(true);
    expect(new Set(fromHome.map((l) => l.region))).toEqual(new Set(['menu', 'footer', 'breadcrumb', 'internal']));
  });

  it('/services/catering sits under /services', () => {
    const services = findNode(analysis.hierarchy.root, P.services);
    expect(services).toBeDefined();
    expect(services!.children.map((c) => c.urlPath)).toContain(P.duplicateA);
  });
});

describe('REQ-008 Sections', () => {
  it("every recorded page's Sections are in page order and cover its text exactly once", () => {
    for (const urlPath of recordedPaths) {
      const content = contents.get(urlPath)!;
      const sections = content.sections;
      expect(sections.length, urlPath).toBeGreaterThan(0);
      expect(sections[0].start, urlPath).toBe(0);
      for (let i = 1; i < sections.length; i++) {
        expect(sections[i].start, `${urlPath} ${sections[i].id}`).toBe(sections[i - 1].end);
        expect(sections[i].end, `${urlPath} ${sections[i].id}`).toBeGreaterThanOrEqual(sections[i].start);
      }
      expect(sections[sections.length - 1].end, urlPath).toBe(content.text.length);
      expect(sections.map((s) => s.id), urlPath).toEqual(sections.map((_, i) => `s${i + 1}`));
      expect(sections.map((s) => sectionText(content, s)).join(''), urlPath).toBe(content.text);
      // The analysis lists the same Sections, in the same order.
      expect(analysed(urlPath).sections.map((s) => s.id), urlPath).toEqual(sections.map((s) => s.id));
    }
  });
});

describe('REQ-009 Page Content', () => {
  it('the home page has text, headings with levels, images with alt, links, the enquiry form, title, description and CTAs', () => {
    const home = contents.get(P.home)!;
    expect(home.text).toContain('Kaveri Sweets has made ghee sweets, crisp savouries and festival gift boxes by hand since 1985.');
    expect(home.headings).toContainEqual(
      expect.objectContaining({ level: 1, text: 'Fresh sweets and savouries in T. Nagar, Chennai' })
    );
    expect(home.headings).toContainEqual(expect.objectContaining({ level: 2, text: 'What we make' }));
    expect(home.headings).toContainEqual(expect.objectContaining({ level: 2, text: 'Ask about an order' }));
    expect(home.images).toContainEqual(
      expect.objectContaining({ src: '/wp-content/uploads/2025/10/logo.svg', alt: 'Kaveri Sweets home' })
    );
    expect(home.links).toContainEqual(expect.objectContaining({ to: P.about, region: 'menu' }));
    expect(home.links).toContainEqual(expect.objectContaining({ to: P.duplicateA, region: 'internal' }));
    expect(home.links.some((l) => l.leavesSite && l.to.startsWith('https://www.facebook.com/'))).toBe(true);

    expect(home.forms).toHaveLength(1);
    const form = home.forms[0];
    expect(form.method.toUpperCase()).toBe('POST');
    expect(form.action).toBe('/enquiry');
    expect(form.fields.map((f) => [f.type, f.label, f.name])).toEqual([
      ['text', 'Your name', 'name'],
      ['tel', 'Phone number', 'phone'],
      ['email', 'Email', 'email'],
      ['textarea', 'What would you like to order?', 'message'],
    ]);
    expect(form.fields.filter((f) => f.required).map((f) => f.name)).toEqual(['name', 'phone']);

    expect(home.title).toBe('Kaveri Sweets | Sweets and savouries in T. Nagar, Chennai');
    expect(home.description).toMatch(/^Ghee sweets, savouries and festival gift boxes made by hand/);
    expect(home.ctas).toContainEqual(expect.objectContaining({ text: 'Order online', kind: 'link', to: P.shop }));
    expect(home.ctas).toContainEqual(expect.objectContaining({ text: 'Send enquiry', kind: 'button' }));
  });

  it("the gallery's two images without alt have alt null", () => {
    const gallery = contents.get(P.gallery)!;
    const missing = gallery.images.filter((i) => i.alt === null).map((i) => i.src);
    expect(missing).toEqual(['/wp-content/uploads/2025/10/ladoo.svg', '/wp-content/uploads/2025/10/jalebi.svg']);
  });
});

describe('REQ-010 technology', () => {
  it('identifies WordPress with its evidence', () => {
    expect(analysis.technology.status).toBe('identified');
    if (analysis.technology.status !== 'identified') return;
    const wp = analysis.technology.technologies.find((t) => t.name === 'WordPress');
    expect(wp).toBeDefined();
    expect(wp!.kind).toBe('cms');
    expect(wp!.evidence).toContain('meta generator');
    expect(wp!.evidence.some((e) => e.includes('/wp-content/'))).toBe(true);
  });
});

describe('REQ-013 language', () => {
  it("records the Tamil page as 'ta' and the home page as 'en'", () => {
    expect(analysed(P.tamil).language.primary).toBe('ta');
    expect(analysed(P.home).language.primary).toBe('en');
  });
});

describe('REQ-014 findings', () => {
  it("the about page's link to the 404 page gives a broken-link finding naming /about and the target", () => {
    const broken = byRule('broken-link').filter((f) => f.target === P.missing);
    expect(broken).toHaveLength(1);
    expect(broken[0].urlPath).toBe(P.about);
    expect(broken[0].pages).toContain(P.about);
    expect(broken[0].detail).toContain(P.about);
    expect(broken[0].detail).toContain(P.missing);
    expect(broken[0].detail).toContain('404');
  });

  it('the duplicate pair gives one duplicate-title and one duplicate-description finding and no duplicate-content', () => {
    const titles = byRule('duplicate-title');
    expect(titles).toHaveLength(1);
    expect([...titles[0].pages!].sort()).toEqual([P.duplicateA, P.duplicateB].sort());
    const descriptions = byRule('duplicate-description');
    expect(descriptions).toHaveLength(1);
    expect([...descriptions[0].pages!].sort()).toEqual([P.duplicateA, P.duplicateB].sort());
    expect(byRule('duplicate-content')).toHaveLength(0);
  });

  it('the gallery gives two missing-alt findings naming each image, and no other page gives one', () => {
    const missingAlt = byRule('missing-alt');
    expect(missingAlt).toHaveLength(2);
    expect(missingAlt.every((f) => f.urlPath === P.gallery)).toBe(true);
    expect(missingAlt.map((f) => f.target)).toEqual([
      '/wp-content/uploads/2025/10/ladoo.svg',
      '/wp-content/uploads/2025/10/jalebi.svg',
    ]);
  });

  it('finding ids are unique and continue from firstFindingNumber', () => {
    const ids = analysis.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(analysis.nextFindingNumber).toBe(ids.length + 1);
  });
});

describe('REQ-015 marketing signals', () => {
  it('has the ten signals in order', () => {
    expect(analysis.marketing.signals.map((s) => s.key)).toEqual(MARKETING_SIGNALS.map((s) => s.key));
  });

  it('finds click-to-call and local signals (NAP, map embed, LocalBusiness schema) on the home page', () => {
    const signal = (key: string) => analysis.marketing.signals.find((s) => s.key === key)!;
    const call = signal('click-to-call');
    expect(call.status).toBe('found');
    expect(call.pages).toContain(P.home);

    const local = signal('local-signals');
    expect(local.status).toBe('found');
    expect(local.pages).toContain(P.home);
    expect(local.nap?.some((n) => n.urlPath === P.home)).toBe(true);
    const part = (name: string) => local.detail.split('; ').find((s) => s.includes(name)) ?? '';
    expect(part('map embed').split(': ')[1]?.split(/, | and /)).toContain(P.home);
    expect(part('LocalBusiness schema').split(': ')[1]?.replace(/\.$/, '').split(/, | and /)).toContain(P.home);
  });

  it('reports the lead form, and nothing was sent to its action: no /enquiry request and no POST at all', () => {
    const leads = analysis.marketing.signals.find((s) => s.key === 'lead-forms')!;
    expect(leads.status).toBe('found');
    expect(leads.pages).toContain(P.home);
    expect(allRequests.filter((r) => pathOf(r) === '/enquiry')).toEqual([]);
    expect(allRequests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD')).toEqual([]);
  });
});

describe('REQ-038 SEO and accessibility basics', () => {
  it('every page has SEO basics', () => {
    for (const p of analysis.pages) {
      expect(p.seo, p.urlPath).toEqual(
        expect.objectContaining({
          hasTitle: expect.any(Boolean),
          hasDescription: expect.any(Boolean),
          h1Count: expect.any(Number),
          skippedHeadingLevel: expect.any(Boolean),
          imagesWithoutAlt: expect.any(Number),
          findingIds: expect.any(Array),
        })
      );
    }
    expect(analysed(P.home).seo).toEqual(
      expect.objectContaining({ hasTitle: true, hasDescription: true, h1Count: 1, imagesWithoutAlt: 0, htmlLang: 'en' })
    );
    expect(analysed(P.gallery).seo.imagesWithoutAlt).toBe(2);
    const galleryAlt = byRule('missing-alt').map((f) => f.id);
    for (const id of galleryAlt) expect(analysed(P.gallery).seo.findingIds).toContain(id);
  });

  it('the Sample Pages name WCAG 2.2 level AA with automatic checks only; other pages have none', () => {
    for (const p of SAMPLES) {
      expect(analysed(p).accessibility, p).toEqual(
        expect.objectContaining({ standard: 'WCAG 2.2', level: 'AA', method: 'automatic checks only' })
      );
      const basics = analysed(p).accessibility!;
      expect(basics.violations).toBe(basics.findingIds.length);
      for (const id of basics.findingIds) expect(analysis.findings.map((f) => f.id)).toContain(id);
    }
    for (const p of analysis.pages) {
      if (!(SAMPLES as string[]).includes(p.urlPath)) expect(p.accessibility, p.urlPath).toBeUndefined();
    }
  });

  it('no output text calls a page accessible or compliant', () => {
    const texts = [
      ...analysis.findings.flatMap((f) => [f.title, f.detail, f.suggestion]),
      ...analysis.notes,
      ...analysis.marketing.signals.map((s) => s.detail),
      ...analysis.marketing.checks.flatMap((c) => Object.values(c).filter((v): v is string => typeof v === 'string')),
      ...analysis.pages.flatMap((p) => (p.accessibility ? [p.accessibility.standard, p.accessibility.method] : [])),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/(?<![\p{L}-])(?:accessible|complian(?:t|ce))(?![\p{L}-])/iu);
      expect(findClaimWords(text), text).toEqual([]);
    }
  });
});

describe('Skipped Pages and the request log', () => {
  it('no request from the analysis reaches a Skipped Page (query strings included)', () => {
    expect(analysisRequests.filter((r) => isSkipped(pathOf(r))).map((r) => r.path)).toEqual([]);
  });

  it('the browser stage opened no Skipped Page either', () => {
    expect(browserRequests.filter((r) => isSkipped(pathOf(r))).map((r) => r.path)).toEqual([]);
  });

  it("the analysis's only requests are GETs on the fixture origin, the 404 target among them", () => {
    expect(analysisRequests.length).toBeGreaterThan(0);
    expect(analysisRequests.every((r) => r.method === 'GET')).toBe(true);
    expect(analysisRequests.map(pathOf)).toContain(P.missing);
    expect(connects.every((u) => new URL(u).origin === site.origin)).toBe(true);
    // Recorded pages loaded in the browser: the analysis does not ask for them again.
    for (const r of analysisRequests) expect(recordedPaths).not.toContain(pathOf(r));
  });
});
