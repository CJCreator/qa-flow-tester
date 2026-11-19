import { describe, it, expect } from 'vitest';
import {
  seedFromSitemaps,
  SITEMAP_FETCH_CONCURRENCY,
  SITEMAP_MAX_FILES,
} from '../src/discovery/deterministic-spider.js';
import type { FetchFn } from '@qa/checkers';

const SITE = new URL('https://shop.example/');

function urlset(paths: string[]): string {
  return `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>https://shop.example${p}</loc></url>`).join('')}</urlset>`;
}

function sitemapIndex(files: string[]): string {
  return `<?xml version="1.0"?><sitemapindex>${files.map((f) => `<sitemap><loc>https://shop.example${f}</loc></sitemap>`).join('')}</sitemapindex>`;
}

/** A routed site: each address answers its body, anything else 404. Counts fetches in flight. */
function routed(routes: Record<string, string>) {
  let inFlight = 0;
  let peak = 0;
  const fetched: string[] = [];
  const fetch: FetchFn = async (url) => {
    fetched.push(url);
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const body = routes[new URL(url).pathname];
    return body === undefined
      ? { status: 404, headers: {}, text: async () => '' }
      : { status: 200, headers: {}, text: async () => body };
  };
  return { fetch, fetched, peak: () => peak };
}

function seed(fetch: FetchFn, limit: number) {
  const queued = new Set<string>();
  const skipped: string[] = [];
  const run = seedFromSitemaps({
    site: SITE,
    fetch,
    onSite: (u) => u.host === SITE.host,
    limit,
    stop: () => false,
    enqueue: (loc) => {
      if (queued.has(loc)) return false;
      queued.add(loc);
      return true;
    },
    overLimit: (u) => {
      if (!queued.has(u.toString()) && !skipped.includes(u.pathname)) skipped.push(u.pathname);
    },
  });
  return { run, queued, skipped };
}

describe('sitemap seeding up to the page limit (T-400)', () => {
  it('queues 1,000 of 1,200 sitemap addresses and lists the other 200 as past the page limit', async () => {
    const all = Array.from({ length: 1200 }, (_, i) => `/p/${i}`);
    const site = routed({
      '/robots.txt': 'User-agent: *\nSitemap: https://shop.example/sitemap-index.xml\n',
      '/sitemap-index.xml': sitemapIndex(['/sm-1.xml', '/sm-2.xml', '/sm-3.xml']),
      '/sm-1.xml': urlset(all.slice(0, 400)),
      '/sm-2.xml': urlset(all.slice(400, 800)),
      '/sm-3.xml': urlset(all.slice(800)),
    });
    const { run, queued, skipped } = seed(site.fetch, 1000);
    const result = await run;

    expect(result.queued).toBe(1000);
    expect(queued.size).toBe(1000);
    expect(skipped).toHaveLength(200);
    // recorded + skipped == unique sitemap addresses
    expect(new Set([...[...queued].map((u) => new URL(u).pathname), ...skipped]).size).toBe(1200);
    // Files are parsed in the order found, so the first 1,000 addresses are the ones queued.
    expect(skipped[0]).toBe('/p/1000');
  });

  it('reads sitemap files 4 at a time, and at most 100 of them', async () => {
    const files = Array.from({ length: 150 }, (_, i) => `/f-${i}.xml`);
    const routes: Record<string, string> = { '/sitemap.xml': sitemapIndex(files) };
    for (const f of files) routes[f] = urlset([`/page${f.replace('.xml', '')}`]);
    const site = routed(routes);
    const { run, queued } = seed(site.fetch, 1000);
    const result = await run;

    expect(SITEMAP_FETCH_CONCURRENCY).toBe(4);
    expect(SITEMAP_MAX_FILES).toBe(100);
    expect(site.peak()).toBe(4);
    expect(result.files).toBe(100);
    // /sitemap.xml plus 99 files from the index; robots.txt is fetched once besides.
    expect(site.fetched.filter((u) => u.endsWith('.xml'))).toHaveLength(100);
    expect(queued.size).toBe(99);
  });

  it('stops reading files when told to', async () => {
    const site = routed({ '/sitemap.xml': urlset(['/a', '/b']) });
    const result = await seedFromSitemaps({
      site: SITE,
      fetch: site.fetch,
      onSite: () => true,
      limit: 10,
      stop: () => true,
      enqueue: () => true,
      overLimit: () => {},
    });
    expect(result.queued).toBe(0);
  });
});
