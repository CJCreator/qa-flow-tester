import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { runSafeWebsiteScan } from '../src/safe-scan.js';
import { isPrivateHost, scanScope } from '../src/competitive/safe-crawler.js';

const layout = (title: string, main: string) => `<!doctype html><html lang="en"><head><title>${title}</title></head><body>
  <header><nav><a href="/">Home</a> <a href="/category/books">Books</a> <a href="/category/games">Games</a> <a href="/logout">Log out</a></nav></header>
  <main><h1>${title}</h1>${main}</main><footer><a href="/private/admin">Staff</a> <a href="/catalogue.pdf">Catalogue (PDF)</a></footer>
</body></html>`;

const product = (slug: string) =>
  layout(slug.replace(/-/g, ' '), `<section><img src="/x.png" alt=""><p>£10</p><form method="post" action="/basket"><button>Add to basket</button></form></section>`);

const category = (name: string, items: string[]) =>
  layout(name, `<ul>${items.map((i) => `<li><article><a href="/product/${i}">${i}</a></article></li>`).join('')}</ul><a href="/category/${name}?page=2">Next</a>`);

const PAGES: Record<string, string> = {
  '/': layout('Shop', '<p>Welcome</p><a href="/product/the-silent-sea-1">Featured</a>'),
  '/category/books': category('books', ['the-silent-sea-1', 'a-light-in-the-attic-2', 'tipping-the-velvet-3']),
  '/category/games': category('games', ['chess-set-4', 'go-board-5']),
  '/product/the-silent-sea-1': product('the-silent-sea-1'),
  '/product/a-light-in-the-attic-2': product('a-light-in-the-attic-2'),
  '/product/tipping-the-velvet-3': product('tipping-the-velvet-3'),
  '/product/chess-set-4': product('chess-set-4'),
  '/product/go-board-5': product('go-board-5'),
};

describe('Read-only scan follows links', () => {
  const PORT = 3506;
  const baseUrl = `http://localhost:${PORT}`;
  const outputDir = path.join(process.cwd(), '.tmp-safe-crawl-links');
  const requests: string[] = [];
  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      const url = new URL(req.url || '/', baseUrl);
      if (url.pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /private/\n');
        return;
      }
      const page = PAGES[url.pathname];
      res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html' });
      res.end(page || 'Not found');
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  it('visits pages of every shape first, groups pages built from one template, and stays read-only', async () => {
    const report = await runSafeWebsiteScan({ targetUrl: baseUrl, outputDir, maxPages: 5, runId: 'run-links' });
    const visited = report.pages!.map((p) => p.urlPath);

    // Home, then one page of each new shape (a product, a category) before more of the same.
    expect(visited[0]).toBe('/');
    expect(visited.slice(1, 3).sort()).toEqual(['/category/books', '/product/the-silent-sea-1']);
    expect(visited).toHaveLength(5);

    // Every product page shares one layout group; categories share another.
    const groupOf = Object.fromEntries(report.pages!.map((p) => [p.urlPath, p.layoutGroup]));
    const productGroups = new Set(visited.filter((p) => p.startsWith('/product/')).map((p) => groupOf[p]));
    expect(productGroups.size).toBe(1);
    expect(groupOf['/category/books']).not.toBe(groupOf['/product/the-silent-sea-1']);

    // One result per page, and notes on what was left out.
    expect(report.results).toHaveLength(5);
    expect(report.coverage.totalTestPoints).toBe(5);
    expect(report.notes).toContain('Stopped after 5 pages, the limit for a standard review.');
    expect(report.notes?.some((n) => n.includes('robots.txt') && n.includes('/private/admin'))).toBe(true);

    // Never: robots-blocked pages, files, logging out, or anything but GET.
    expect(requests.some((r) => r.includes('/private/'))).toBe(false);
    expect(requests.some((r) => r.includes('.pdf') || r.includes('/logout'))).toBe(false);
    expect(requests.filter((r) => !r.startsWith('GET'))).toEqual([]);
  }, 90000);

  it('stays in the part of the site the review started in', () => {
    expect(scanScope('https://www.w3.org/WAI/demos/bad/before/home.html')).toBe('/WAI/demos/bad/before/');
    expect(scanScope('https://demo.playwright.dev/todomvc/')).toBe('/todomvc/');
    expect(scanScope('https://books.toscrape.com/')).toBe('/');
    expect(scanScope('https://books.toscrape.com')).toBe('/');
  });

  it('pauses between pages only on hosts we do not own', () => {
    for (const host of ['localhost', '127.0.0.1', '192.168.1.20', '10.0.0.5', '172.20.0.2', 'host.docker.internal', 'app.localhost']) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    for (const host of ['books.toscrape.com', '172.32.0.1', 'example.com']) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });
});
