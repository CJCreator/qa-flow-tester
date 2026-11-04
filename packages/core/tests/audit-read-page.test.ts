import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { promises as fs } from 'fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { sectionText, type PageContent } from '@qa/types';
import { readPage, type ReadPageOptions, type ReadPageResult } from '../src/audit/analysis/read-page.js';
import {
  AUDIT_SITE_PAGES as P,
  AUDIT_SITE_ROOT,
  startAuditSite,
  type AuditSiteServer,
} from './helpers/audit-site-server.js';

// Browser test (launches Chromium): listed in vitest.workspace.ts BROWSER_TESTS as core 'audit-read-page'.

let site: AuditSiteServer;
let browser: Browser;
let context: BrowserContext;

beforeAll(async () => {
  site = await startAuditSite();
  browser = await chromium.launch();
  context = await browser.newContext();
  // Keep the test off the network: anything not on the fixture (the map iframe, for one) is aborted.
  await context.route('**/*', (route) =>
    route.request().url().startsWith(`${site.origin}/`) ? route.continue() : route.abort()
  );
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

interface Read extends ReadPageResult {
  /** Requests the fixture server saw, and the page started, while readPage ran. */
  serverRequests: number;
  pageRequests: number;
  urlBefore: string;
  urlAfter: string;
}

/** Opens a page, waits until it is rendered and quiet, then reads it while counting every request. */
async function read(urlPath: string, options?: ReadPageOptions, before?: (page: Page) => Promise<void>): Promise<Read> {
  const page = await context.newPage();
  try {
    await page.goto(site.url(urlPath), { waitUntil: 'networkidle' });
    if (before) await before(page);
    let pageRequests = 0;
    page.on('request', () => {
      pageRequests++;
    });
    site.clearRequests();
    const urlBefore = page.url();
    const result = await readPage(page, options);
    const urlAfter = page.url();
    return { ...result, serverRequests: site.requests.length, pageRequests, urlBefore, urlAfter };
  } finally {
    await page.close();
  }
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
const linkTo = (content: PageContent, to: string) => content.links.filter((l) => l.to === to);

describe('readPage on the home page', () => {
  let home: Read;
  beforeAll(async () => {
    home = await read(P.home, undefined, async (page) => {
      // Something typed into the form must never be read.
      await page.fill('#enquiry-name', 'Typed Secret Name');
      await page.fill('#enquiry-message', 'Typed secret message');
    });
  });

  it('is read-only: no request reaches the server or leaves the page, and the page stays put', () => {
    expect(home.serverRequests).toBe(0);
    expect(home.pageRequests).toBe(0);
    expect(home.urlAfter).toBe(home.urlBefore);
    expect(home.raw.url).toBe(site.url('/'));
  });

  it('records each internal link with its target page and one region (REQ-007 AC-1)', () => {
    const { content } = home;
    // Header menu links.
    for (const to of ['/about', '/services', '/services/party-orders', '/blog', '/ta', '/hi', '/account/sign-in']) {
      expect(
        linkTo(content, to).map((l) => l.region),
        to
      ).toContain('menu');
    }
    expect(linkTo(content, '/blog').map((l) => l.region)).toEqual(['menu']);
    // Breadcrumb link (Home).
    expect(linkTo(content, '/').map((l) => l.region)).toEqual(['menu', 'menu', 'breadcrumb']);
    // Main content links.
    expect(linkTo(content, '/shop').map((l) => l.region)).toEqual(['menu', 'internal']);
    expect(linkTo(content, '/services/catering').map((l) => l.region)).toEqual(['menu', 'internal']);
    expect(linkTo(content, '/gallery').map((l) => l.region)).toEqual(['menu', 'internal']);
    // Footer links.
    expect(linkTo(content, '/updates').map((l) => l.region)).toEqual(['internal', 'footer']);
    expect(linkTo(content, '/private/staff-rota').map((l) => l.region)).toEqual(['footer']);
    expect(linkTo(content, '/about').map((l) => l.region)).toEqual(['menu', 'footer']);
    const facebook = content.links.find((l) => l.to.startsWith('https://www.facebook.com/'));
    expect(facebook).toMatchObject({ region: 'footer', leavesSite: true });
    for (const link of content.links) expect(['menu', 'footer', 'breadcrumb', 'internal']).toContain(link.region);
    // Every link is one entry with one region; tel: is not a page link.
    expect(content.links.some((l) => l.to.startsWith('tel:'))).toBe(false);
  });

  it('reads text, headings, images, links, the enquiry form without values, title, description and CTAs (REQ-009 AC-1)', () => {
    const { content, raw } = home;
    expect(content.urlPath).toBe('/');
    expect(content.title).toBe('Kaveri Sweets | Sweets and savouries in T. Nagar, Chennai');
    expect(content.description).toMatch(/^Ghee sweets, savouries and festival gift boxes/);
    expect(content.text).toContain('Everything is cooked fresh each morning in our kitchen behind the shop.');
    expect(content.text).toContain('Open every day, 8 am to 9 pm.');

    expect(content.headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Fresh sweets and savouries in T. Nagar, Chennai'],
      [2, 'What we make'],
      [2, 'Visit us'],
      [2, 'Ask about an order'],
    ]);
    expect(content.images).toEqual([
      expect.objectContaining({ src: '/wp-content/uploads/2025/10/logo.svg', alt: 'Kaveri Sweets home' }),
    ]);
    expect(content.links.length).toBeGreaterThan(15);

    expect(content.forms).toHaveLength(1);
    const form = content.forms[0];
    expect(form).toMatchObject({ method: 'POST', action: '/enquiry' });
    expect(form.fields).toEqual([
      { type: 'text', label: 'Your name', name: 'name', required: true },
      { type: 'tel', label: 'Phone number', name: 'phone', required: true },
      { type: 'email', label: 'Email', name: 'email', required: false },
      { type: 'textarea', label: 'What would you like to order?', name: 'message', required: false },
    ]);
    for (const field of [...form.fields, ...raw.forms[0].fields]) expect(field).not.toHaveProperty('value');
    const everything = JSON.stringify(home.raw) + JSON.stringify(content);
    expect(everything).not.toContain('Typed Secret Name');
    expect(everything).not.toContain('Typed secret message');

    expect(content.ctas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Order online', kind: 'link', to: '/shop' }),
        expect.objectContaining({ text: 'Call to order', kind: 'link', to: 'tel:+914424345678' }),
        expect.objectContaining({ text: 'Send enquiry', kind: 'button' }),
      ])
    );
    expect(raw.contactLinks.map((c) => [c.kind, c.href])).toEqual([
      ['tel', 'tel:+914424345678'],
      ['tel', 'tel:+914424345678'],
    ]);
    expect(raw.addresses).toHaveLength(1);
    expect(raw.addresses[0]).toContain('12 Lake View Road, T. Nagar');
    expect(raw.addresses[0]).toContain('+91 44 2434 5678');
  });

  it('splits the page into Sections in page order that cover the whole text exactly once (REQ-008 AC-1/AC-2)', () => {
    const { content } = home;
    expect(content.sections.map((s) => [s.kind, s.heading])).toEqual([
      ['header', undefined],
      ['nav', undefined],
      ['heading', 'Fresh sweets and savouries in T. Nagar, Chennai'],
      ['heading', 'What we make'],
      ['heading', 'Visit us'],
      ['heading', 'Ask about an order'],
      ['footer', undefined],
    ]);
    expect(content.sections.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
    expect(content.sections[0].start).toBe(0);
    expect(content.sections.at(-1)!.end).toBe(content.text.length);
    for (let i = 1; i < content.sections.length; i++) {
      expect(content.sections[i].start).toBe(content.sections[i - 1].end);
    }
    expect(content.sections.map((s) => sectionText(content, s)).join('')).toBe(content.text);

    const text = (i: number) => sectionText(content, content.sections[i]);
    expect(text(0)).toContain('Party orders');
    expect(text(0)).toContain('Sign in');
    expect(text(1)).toContain('Sweets and savouries');
    expect(text(2)).toContain('Order online');
    expect(text(3)).toContain('Latest updates from the shop');
    expect(text(4)).toContain('Open every day');
    expect(text(5)).toContain('What would you like to order?');
    expect(text(6)).toContain('Proudly powered by WordPress');

    // Elements land in the Section that holds them.
    const sectionOf = (id: string | undefined) => content.sections.findIndex((s) => s.id === id);
    expect(sectionOf(content.images[0].sectionId)).toBe(0);
    expect(sectionOf(content.headings[0].sectionId)).toBe(2);
    expect(sectionOf(content.headings[3].sectionId)).toBe(5);
    expect(sectionOf(content.forms[0].sectionId)).toBe(5);
    expect(sectionOf(content.links.find((l) => l.region === 'breadcrumb')!.sectionId)).toBe(1);
    expect(sectionOf(content.ctas.find((c) => c.text === 'Order online')!.sectionId)).toBe(2);
    expect(sectionOf(content.links.find((l) => l.to === '/private/staff-rota')!.sectionId)).toBe(6);
  });

  it('keeps the Services sub-menu nested under Services', () => {
    const { menu } = home.raw;
    expect(menu.map((m) => [m.text, m.href])).toEqual([
      ['Home', '/'],
      ['About us', '/about'],
      ['Services', '/services'],
      ['Gallery', '/gallery'],
      ['Blog', '/blog'],
      ['Shop', '/shop'],
    ]);
    expect(menu[2].children).toEqual([
      { text: 'Catering', href: '/services/catering', children: [] },
      { text: 'Party orders', href: '/services/party-orders', children: [] },
    ]);
    for (const item of menu.filter((m) => m.text !== 'Services')) expect(item.children).toEqual([]);
  });

  it('captures the meta generator, /wp-content/ stylesheet, LocalBusiness JSON-LD and the map iframe', () => {
    const { raw } = home;
    expect(raw.metaGenerator).toBe('WordPress 6.6.2');
    expect(raw.stylesheets).toEqual(['/wp-content/themes/kaveri/style.css']);
    expect(raw.jsonLd).toHaveLength(1);
    expect(raw.jsonLd[0].types).toEqual(['LocalBusiness', 'PostalAddress', 'GeoCoordinates']);
    expect(raw.jsonLd[0].raw).toContain('"LocalBusiness"');
    expect(raw.iframes).toHaveLength(1);
    expect(raw.iframes[0]).toMatch(/^https:\/\/www\.google\.com\/maps\/embed\?pb=/);
    expect(raw.frameworkMarkers).toEqual([]);
    expect(raw.socialMetaKeys).toEqual([]);
    expect(raw.breadcrumb).toEqual([
      { text: 'Home', href: '/' },
      { text: 'Sweets and savouries', href: null },
    ]);
  });

  it("detects the home page's language as 'en'", () => {
    expect(home.raw.lang).toBe('en');
    expect(home.content.language.primary).toBe('en');
  });

  it('keeps no response header that carries credentials', () => {
    expect(home.raw.responseHeaders).toBeUndefined();
  });
});

describe('readPage on other fixture pages', () => {
  it('gives the two gallery images without an alt attribute alt null (REQ-009 AC-2)', async () => {
    const { content, serverRequests } = await read(P.gallery);
    expect(serverRequests).toBe(0);
    expect(content.images.map((i) => [i.src, i.alt])).toEqual([
      ['/wp-content/uploads/2025/10/logo.svg', 'Kaveri Sweets home'],
      ['/wp-content/uploads/2025/10/ladoo.svg', null],
      ['/wp-content/uploads/2025/10/jalebi.svg', null],
      ['/wp-content/uploads/2025/10/murukku.svg', 'A ring of crisp murukku'],
    ]);
  });

  it('reads the breadcrumb trail of a blog page in order', async () => {
    const { raw, content } = await read(P.depth5);
    expect(raw.breadcrumb).toEqual([
      { text: 'Home', href: '/' },
      { text: 'Blog', href: '/blog' },
      { text: '2025', href: '/blog/2025' },
      { text: 'Diwali', href: '/blog/2025/diwali' },
      { text: 'Sweets guide', href: '/blog/2025/diwali/sweets' },
      { text: 'Kaju katli', href: null },
    ]);
    expect(content.links.filter((l) => l.region === 'breadcrumb').map((l) => l.to)).toEqual([
      '/',
      '/blog',
      '/blog/2025',
      '/blog/2025/diwali',
      '/blog/2025/diwali/sweets',
    ]);
  });

  it('keeps the Tamil page text character for character, language ta', async () => {
    const html = await fs.readFile(path.join(AUDIT_SITE_ROOT, 'ta', 'index.html'), 'utf8');
    const mainText = collapse((html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? '').replace(/<[^>]+>/g, ' '));
    expect(mainText.length).toBeGreaterThan(100);
    const { raw, content, serverRequests } = await read(P.tamil);
    expect(serverRequests).toBe(0);
    expect(collapse(content.text)).toContain(mainText);
    expect(content.title).toBe('காவேரி ஸ்வீட்ஸ் | தி. நகர், சென்னை இனிப்பகம்');
    expect(raw.lang).toBe('ta');
    expect(content.language.primary).toBe('ta');
  });

  it('reads the JavaScript-rendered updates page after rendering', async () => {
    const { raw, content, serverRequests } = await read(P.jsRendered);
    expect(serverRequests).toBe(0);
    expect(content.text).toContain('Diwali gift boxes are ready');
    expect(content.text).toContain('Updated for Diwali 2025.');
    expect(content.text).not.toContain('Loading updates');
    expect(linkTo(content, P.jsOnlyTarget)).toEqual([
      expect.objectContaining({ text: 'See our festival opening hours', region: 'internal' }),
    ]);
    expect(raw.scripts).toEqual(['/wp-content/themes/kaveri/js/updates.js']);
    expect(raw.stylesheets).toEqual(['/wp-content/themes/kaveri/style.css']);
  });

  it('drops credential headers, keeps platform headers, and cuts the text at maxTextChars', async () => {
    const { raw, content } = await read(P.home, {
      maxTextChars: 50,
      responseHeaders: { Server: 'nginx', 'X-Powered-By': 'PHP/8.2', 'Set-Cookie': 'sid=x', authorization: 'y' },
    });
    expect(raw.responseHeaders).toEqual({ server: 'nginx', 'x-powered-by': 'PHP/8.2' });
    expect(content.textTruncated).toBe(true);
    expect(content.text.length).toBe(50);
    expect(content.sections.at(-1)!.end).toBe(50);
    // Every element still has a Section.
    const ids = new Set(content.sections.map((s) => s.id));
    for (const h of content.headings) expect(ids.has(h.sectionId!)).toBe(true);
    for (const l of content.links) expect(ids.has(l.sectionId!)).toBe(true);
  });
});
