import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import path from 'path';
import { promises as fs } from 'fs';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { RobotsPolicy } from '../src/competitive/robots.js';
import {
  AUDIT_SITE_PAGES as P,
  AUDIT_SITE_ROOT,
  ORIGIN_PLACEHOLDER,
  startAuditSite,
  type AuditSiteServer,
} from './helpers/audit-site-server.js';

/** Every HTML file of the fixture, keyed by its URL path. 404.html is the not-found body, not a page. */
async function readFixturePages(): Promise<Map<string, string>> {
  const pages = new Map<string, string>();
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.html')) {
        const rel = path.relative(AUDIT_SITE_ROOT, full).split(path.sep).join('/');
        if (rel === '404.html') continue;
        const urlPath = '/' + rel.replace(/\.html$/, '').replace(/(^|\/)index$/, '');
        pages.set(urlPath, await fs.readFile(full, 'utf8'));
      }
    }
  };
  await walk(AUDIT_SITE_ROOT);
  return pages;
}

/** Same-site links of a page as paths (query, hash and trailing slash dropped). */
function internalLinks(html: string): string[] {
  const links: string[] = [];
  for (const [, href] of html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/g)) {
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const p = new URL(href, 'http://fixture.local').pathname;
    links.push(p.length > 1 ? p.replace(/\/$/, '') : p);
  }
  return links;
}

const titleOf = (html: string) => html.match(/<title>([\s\S]*?)<\/title>/)?.[1].trim();
const descriptionOf = (html: string) => html.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1];
const mainTextOf = (html: string) =>
  (html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** Share of the letters (and their combining marks) that belong to one script. */
const scriptShare = (text: string, script: RegExp) => {
  const letters = [...text].filter((c) => /[\p{L}\p{M}]/u.test(c));
  return letters.filter((c) => script.test(c)).length / letters.length;
};

let site: AuditSiteServer;
let pages: Map<string, string>;
const get = (p: string, init?: RequestInit) => fetch(site.url(p), init);
const linkedFrom = (target: string) =>
  [...pages].filter(([, html]) => internalLinks(html).includes(target)).map(([p]) => p);

beforeAll(async () => {
  site = await startAuditSite();
  pages = await readFixturePages();
});

afterAll(async () => {
  await site?.close();
});

describe('audit site server', () => {
  it('listens on 127.0.0.1 on a port the OS chose, a new one per server', async () => {
    const other = await startAuditSite();
    try {
      expect(site.port).toBeGreaterThan(0);
      expect(other.port).toBeGreaterThan(0);
      expect(other.port).not.toBe(site.port);
      expect(site.origin).toBe(`http://127.0.0.1:${site.port}`);
      expect(site.url('/about')).toBe(`${site.origin}/about`);
    } finally {
      await other.close();
    }
  });

  it('serves every fixture page byte for byte as UTF-8 HTML with a title', async () => {
    expect(pages.size).toBe(22);
    for (const [name, p] of Object.entries(P)) {
      if (name !== 'missing') expect(pages.has(p), `${name} ${p} is a fixture page`).toBe(true);
    }
    for (const [p, file] of pages) {
      const res = await get(p);
      expect(res.status, p).toBe(200);
      expect(res.headers.get('content-type'), p).toBe('text/html; charset=utf-8');
      const body = await res.text();
      expect(body, p).toBe(file.split(ORIGIN_PLACEHOLDER).join(site.origin));
      expect(titleOf(body), p).toBeTruthy();
    }
  });

  it('serves a page with or without a trailing slash, and its assets', async () => {
    expect((await get('/blog/')).status).toBe(200);
    const css = await get('/wp-content/themes/kaveri/style.css');
    expect(css.status).toBe(200);
    expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
    const svg = await get('/wp-content/uploads/2025/10/logo.svg');
    expect(svg.status).toBe(200);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
  });

  it('logs every request with method, path, status, user agent and timestamps, in arrival order', async () => {
    site.clearRequests();
    expect(site.requests).toHaveLength(0);
    const before = Date.now();
    await (await get('/', { headers: { 'user-agent': 'AuditFixtureTest/1.0' } })).text();
    await get('/robots.txt', { method: 'HEAD' });
    const post = await get('/enquiry', { method: 'POST', body: 'name=Test' });
    expect(post.status).toBe(405);
    await (await get(`${P.missing}?from=about`)).text();
    await vi.waitFor(() => expect(site.requests.every((r) => r.finishedAt !== undefined)).toBe(true));
    const after = Date.now();

    expect(site.requests.map((r) => [r.method, r.path, r.status])).toEqual([
      ['GET', '/', 200],
      ['HEAD', '/robots.txt', 200],
      ['POST', '/enquiry', 405],
      ['GET', `${P.missing}?from=about`, 404],
    ]);
    expect(site.requests[0].userAgent).toBe('AuditFixtureTest/1.0');
    let previous = before;
    for (const r of site.requests) {
      expect(r.startedAt).toBeGreaterThanOrEqual(previous);
      expect(r.finishedAt!).toBeGreaterThanOrEqual(r.startedAt);
      expect(r.finishedAt!).toBeLessThanOrEqual(after);
      previous = r.startedAt;
    }
  });

  it('answers unknown paths with the 404 page and serves nothing outside the fixture folder', async () => {
    const missing = await get(P.missing);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('<h1>Page not found</h1>');
    for (const escape of ['/..%2F..%2Fpackage.json', '/..%5C..%5Cpackage.json', '/%2e%2e/%2e%2e/package.json']) {
      const res = await get(escape);
      expect(res.status, escape).toBe(404);
      expect(await res.text(), escape).not.toContain('"name"');
    }
  });
});

describe('robots.txt and sitemap.xml', () => {
  it('robots.txt disallows /private for every crawler, sets Crawl-delay 1 and names two sitemaps', async () => {
    const res = await get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const text = await res.text();
    expect(text).toMatch(/^User-agent: \*$/m);
    expect(text).toMatch(/^Disallow: \/private$/m);
    expect(text).toMatch(/^Crawl-delay: 1$/m);

    const policy = RobotsPolicy.parse(text, 'any-crawler');
    expect(policy.isAllowed(P.privateLinked)).toBe(false);
    expect(policy.isAllowed(P.privateSitemapOnly)).toBe(false);
    expect(policy.isAllowed(P.blog)).toBe(true);
    expect(policy.isAllowed(P.home)).toBe(true);

    const sitemaps = [...text.matchAll(/^Sitemap: (.+)$/gm)].map((m) => new URL(m[1].trim()));
    expect(sitemaps.map(String)).toContain(`${site.origin}/sitemap.xml`);
    const foreign = sitemaps.filter((u) => u.host !== new URL(site.origin).host);
    expect(foreign).toHaveLength(1);
    // A reserved name that never resolves: a crawler that fetches it reaches no real host.
    expect(foreign[0].hostname.endsWith('.invalid')).toBe(true);
  });

  it('writes the host the client asked for into robots.txt and sitemap.xml', async () => {
    const read = (p: string) =>
      new Promise<string>((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port: site.port, path: p, headers: { host: `localhost:${site.port}` } }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve(body));
          })
          .on('error', reject);
      });
    expect(await read('/robots.txt')).toContain(`Sitemap: http://localhost:${site.port}/sitemap.xml`);
    expect(await read('/sitemap.xml')).toContain(`<loc>http://localhost:${site.port}/seasonal-offers</loc>`);
  });

  it('sitemap.xml lists an unlinked page and a disallowed page, all on the site and all served', async () => {
    const res = await get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    const xml = await res.text();
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]));
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(loc.origin).toBe(site.origin);
      expect(pages.has(loc.pathname), loc.pathname).toBe(true);
      expect((await get(loc.pathname)).status, loc.pathname).toBe(200);
    }
    const listed = locs.map((u) => u.pathname);
    expect(listed).toContain(P.sitemapOnly);
    expect(listed).toContain(P.privateSitemapOnly);
    expect(listed).toContain(P.about); // also linked: found both ways
    // Pages whose scenario depends on how they are reached stay out of the sitemap.
    for (const p of [P.depth4, P.depth5, P.jsOnlyTarget, P.checkout, P.checkoutOnlyTarget, P.privateLinked]) {
      expect(listed, p).not.toContain(p);
    }

    expect(linkedFrom(P.sitemapOnly)).toEqual([]);
    expect(linkedFrom(P.privateSitemapOnly)).toEqual([]);
    const script = await fs.readFile(path.join(AUDIT_SITE_ROOT, 'wp-content/themes/kaveri/js/updates.js'), 'utf8');
    expect(script).not.toContain(P.sitemapOnly);
  });
});

describe('Tamil and Hindi pages', () => {
  for (const { name, p, lang, script } of [
    { name: 'Tamil', p: P.tamil, lang: 'ta', script: /\p{Script=Tamil}/u },
    { name: 'Hindi', p: P.hindi, lang: 'hi', script: /\p{Script=Devanagari}/u },
  ]) {
    it(`${name} page is UTF-8 with lang="${lang}" and its main text is in ${name} script`, async () => {
      const res = await get(p);
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const bytes = Buffer.from(await res.arrayBuffer());
      const file = await fs.readFile(path.join(AUDIT_SITE_ROOT, lang, 'index.html'));
      expect(bytes.equals(file)).toBe(true);
      const html = bytes.toString('utf8');
      expect(html).toMatch(new RegExp(`<html lang="${lang}">`));
      expect(html).toMatch(/<meta charset="utf-8" \/>/);
      expect(scriptShare(mainTextOf(html), script)).toBeGreaterThan(0.9);
      expect(scriptShare(titleOf(html)!, script)).toBeGreaterThan(0.9);
    });
  }
});

describe('scenarios', () => {
  it('home: header menu with a sub-menu, footer, breadcrumbs, CTAs, tel: link, NAP, map, lead form', () => {
    const html = pages.get(P.home)!;
    const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? '';
    const menu = header.match(/<nav[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(internalLinks(menu)).toEqual(expect.arrayContaining(['/', P.about, P.services, P.blog, P.shop]));
    expect(menu).toMatch(/<ul class="sub-menu">[\s\S]*href="\/services\/catering"/);
    const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? '';
    expect(internalLinks(footer)).toEqual(expect.arrayContaining([P.about, P.privateLinked]));
    expect(footer).toMatch(/href="https:\/\/www\.facebook\.com\//);
    const breadcrumbs = html.match(/<nav class="breadcrumbs" aria-label="Breadcrumb">[\s\S]*?<\/nav>/)?.[0] ?? '';
    expect(internalLinks(breadcrumbs)).toEqual(['/']);
    expect(html).toMatch(/<a class="button" href="\/shop">Order online<\/a>/);
    expect(html).toMatch(/<a class="button button-secondary" href="tel:\+914424345678">/);

    const nap = html.match(/<address class="nap">([\s\S]*?)<\/address>/)?.[1] ?? '';
    expect(nap).toContain('Kaveri Sweets');
    expect(nap).toContain('12 Lake View Road, T. Nagar');
    expect(nap).toContain('Chennai, Tamil Nadu 600017');
    expect(nap).toContain('<a href="tel:+914424345678">+91 44 2434 5678</a>');
    expect(html).toMatch(/<iframe[\s\S]*?src="https:\/\/www\.google\.com\/maps\/embed\?/);

    const form = html.match(/<form class="lead-form" action="\/enquiry" method="post">([\s\S]*?)<\/form>/)?.[1] ?? '';
    expect(form).toMatch(/type="tel"/);
    expect(form).toMatch(/type="email"/);
    expect(form).toMatch(/<textarea/);
    expect(form).toMatch(/<button type="submit">Send enquiry<\/button>/);
  });

  it('home: LocalBusiness JSON-LD matching the NAP, and the WordPress generator meta', async () => {
    const html = await (await get(P.home)).text();
    expect(html).toMatch(/<meta name="generator" content="WordPress 6\.6\.2" \/>/);
    const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    const data = JSON.parse(json!);
    expect(data['@type']).toBe('LocalBusiness');
    expect(data.name).toBe('Kaveri Sweets');
    expect(data.telephone).toBe('+91 44 2434 5678');
    expect(data.address.streetAddress).toBe('12 Lake View Road, T. Nagar');
    expect(data.address.postalCode).toBe('600017');
    expect(data.url).toBe(`${site.origin}/`);
  });

  it('two pages share a title and a description but not their main text; no other page repeats either', () => {
    const duplicates = (key: (html: string) => string | undefined) => {
      const byKey = new Map<string, string[]>();
      for (const [p, html] of pages) {
        const k = key(html);
        if (k) byKey.set(k, [...(byKey.get(k) ?? []), p]);
      }
      return [...byKey.values()].filter((g) => g.length > 1).map((g) => g.sort());
    };
    const pair = [P.duplicateA, P.duplicateB].sort();
    expect(duplicates(titleOf)).toEqual([pair]);
    expect(duplicates(descriptionOf)).toEqual([pair]);
    expect(mainTextOf(pages.get(P.duplicateA)!)).not.toBe(mainTextOf(pages.get(P.duplicateB)!));
  });

  it('only the gallery has images without alt text, and those images are served', async () => {
    const withoutAlt = (html: string) =>
      [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/\salt=/.test(t));
    const offenders = [...pages].filter(([, html]) => withoutAlt(html).length > 0).map(([p]) => p);
    expect(offenders).toEqual([P.gallery]);
    const images = withoutAlt(pages.get(P.gallery)!);
    expect(images).toHaveLength(2);
    for (const img of images) {
      const src = img.match(/src="([^"]+)"/)![1];
      expect((await get(src)).status, src).toBe(200);
    }
  });

  it('the about page links to a page that answers 404', async () => {
    expect(linkedFrom(P.missing)).toEqual([P.about]);
    expect(pages.has(P.missing)).toBe(false);
    expect((await get(P.missing)).status).toBe(404);
  });

  it('the sign-in page is nothing but a sign-in form', () => {
    const html = pages.get(P.signIn)!;
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html).toMatch(/<form class="sign-in" action="\/account\/sign-in" method="post">/);
    expect(html).toMatch(/type="password"/);
    expect(html).not.toMatch(/<a\b/);
    expect(linkedFrom(P.signIn)).toContain(P.home);
  });

  it('the checkout page has a card-number field and the only link to its delivery terms', () => {
    const html = pages.get(P.checkout)!;
    expect(html).toMatch(/<input[^>]*autocomplete="cc-number"/);
    expect(html).toMatch(/<label for="card-number">Card number<\/label>/);
    expect(linkedFrom(P.checkout)).toEqual([P.shop]);
    expect(linkedFrom(P.checkoutOnlyTarget)).toEqual([P.checkout]);
  });

  it('pages sit four and five link steps from the home page, under the /blog prefix', () => {
    const depth = new Map<string, number>([['/', 0]]);
    const queue = ['/'];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const link of internalLinks(pages.get(current) ?? '')) {
        if (!depth.has(link)) {
          depth.set(link, depth.get(current)! + 1);
          queue.push(link);
        }
      }
    }
    expect(depth.get(P.depth4)).toBe(4);
    expect(depth.get(P.depth5)).toBe(5);
    expect(P.depth4.startsWith(`${P.blog}/`)).toBe(true);
    expect(P.depth5.startsWith(`${P.blog}/`)).toBe(true);
    // Every page but the sitemap-only and JavaScript-only ones is reachable by plain links.
    const unreachable = [...pages.keys()].filter((p) => !depth.has(p)).sort();
    expect(unreachable).toEqual([P.jsOnlyTarget, P.privateSitemapOnly, P.sitemapOnly].sort());
  });

  it('/blog and /private prefixes each hold pages; one /private page is linked, one is only in the sitemap', () => {
    const under = (prefix: string) => [...pages.keys()].filter((p) => p === prefix || p.startsWith(`${prefix}/`));
    expect(under('/blog').length).toBeGreaterThanOrEqual(5);
    expect(under('/private').sort()).toEqual([P.privateSitemapOnly, P.privateLinked].sort());
    expect(linkedFrom(P.privateLinked)).toContain(P.home);
  });
});

describe('in Chromium', () => {
  let browser: Browser;
  let context: BrowserContext;

  beforeAll(async () => {
    browser = await chromium.launch();
    context = await browser.newContext();
    // Keep the test off the network: anything not on the fixture (the map iframe, for one) is aborted.
    await context.route('**/*', (route) =>
      route.request().url().startsWith(`${site.origin}/`) ? route.continue() : route.abort()
    );
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('the updates page gets its text and its only link from JavaScript', async () => {
    const raw = pages.get(P.jsRendered)!;
    expect(raw).not.toContain('Diwali gift boxes');
    expect(raw).not.toContain(P.jsOnlyTarget);
    expect(linkedFrom(P.jsOnlyTarget)).toEqual([]);

    const page = await context.newPage();
    try {
      await page.goto(site.url(P.jsRendered), { waitUntil: 'domcontentloaded' });
      const items = await page.locator('#updates-list li').allTextContents();
      expect(items).toHaveLength(2);
      expect(items[0]).toContain('Diwali gift boxes');
      expect(await page.locator(`a[href="${P.jsOnlyTarget}"]`).count()).toBe(1);
      expect(await page.locator('#updates-status').textContent()).toBe('Updated for Diwali 2025.');
    } finally {
      await page.close();
    }
    expect((await get(P.jsOnlyTarget)).status).toBe(200);
  });

  it('the Tamil page decodes as UTF-8 and keeps its text character for character', async () => {
    const page = await context.newPage();
    try {
      await page.goto(site.url(P.tamil), { waitUntil: 'domcontentloaded' });
      expect(await page.evaluate(() => document.characterSet)).toBe('UTF-8');
      expect(await page.evaluate(() => document.documentElement.lang)).toBe('ta');
      const h1 = pages.get(P.tamil)!.match(/<h1>([^<]+)<\/h1>/)![1];
      expect(await page.locator('h1').textContent()).toBe(h1);
    } finally {
      await page.close();
    }
  });
});
