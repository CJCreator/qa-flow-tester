/**
 * The narrow-screen look: which menu links fold behind a button on phones, and which button shows
 * them, marked on every page that shares the menu.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { chromium, type Browser } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';
import { lookAtNarrowScreens } from '../src/plan/narrow-look.js';
import { BREAKPOINT_VIEWPORTS } from '../src/browser.js';

const PORT = 3532;
const base = `http://localhost:${PORT}`;

// Below 600 px the menu's links fold behind a "Menu" button; tablets (768 px) still show them.
const layout = (title: string) => `<!doctype html><html lang="en"><head><title>${title}</title><style>
  .menu-button { display: none; }
  @media (max-width: 600px) { .links { display: none; } .menu-button { display: inline-block; } }
</style></head><body>
  <header><nav>
    <button class="menu-button" aria-expanded="false" aria-controls="links">Menu</button>
    <div class="links" id="links"><a href="/">Home</a> <a href="/alpha">Alpha</a> <a href="/beta">Beta</a></div>
  </nav></header>
  <main><h1>${title}</h1><a href="/beta">Read about Beta</a></main>
</body></html>`;

describe('Looking at narrow screens', () => {
  let server: http.Server;
  let browser: Browser;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const titles: Record<string, string> = { '/': 'Home', '/alpha': 'Alpha', '/beta': 'Beta' };
      const title = titles[new URL(req.url || '/', base).pathname];
      res.writeHead(title ? 200 : 404, { 'Content-Type': 'text/html' });
      res.end(title ? layout(title) : 'Not found');
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('marks the menu links a phone hides and the button that shows them, on every page with that menu', async () => {
    const context = await browser.newContext();
    const { pages } = await new DeterministicSpider().crawl(context, `${base}/`);
    await context.close();
    expect(pages.map((p) => p.urlPath).sort()).toEqual(['/', '/alpha', '/beta']);

    const looked: string[] = [];
    await lookAtNarrowScreens(pages, {
      baseUrl: base,
      openContext: async (size) => {
        looked.push(size);
        return browser.newContext({ viewport: BREAKPOINT_VIEWPORTS[size] });
      },
    });

    // One look per size for the one menu the three pages share.
    expect(looked).toEqual(['375px', '768px']);
    for (const page of pages) {
      const alpha = page.links!.find((l) => l.name === 'Alpha')!;
      expect(alpha.hiddenAt, page.urlPath).toEqual(['375px']);
      expect(page.narrowMenus, page.urlPath).toEqual([
        { breakpoint: '375px', selector: 'role=button[name="Menu"]', name: 'Menu' },
      ]);
      // A link in the page itself stays where it is.
      const inPage = page.links!.find((l) => l.name === 'Read about Beta');
      if (inPage) expect(inPage.hiddenAt).toBeUndefined();
    }
  });
});
