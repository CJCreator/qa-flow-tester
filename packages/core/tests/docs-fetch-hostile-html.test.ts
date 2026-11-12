import { describe, it, expect } from 'vitest';
import { fetchDocsPages, htmlToDoc, type DocsGet } from '../src/discovery/docs-fetch.js';
import { RobotsPolicy } from '../src/competitive/robots.js';

describe('htmlToDoc hostile pages', () => {
  it.each([
    ['<!--', '<!--'.repeat(262_144)],
    ['<script', '<script'.repeat(150_000)],
    ['<', '<'.repeat(1_048_576)],
    ['<h1>', '<h1>'.repeat(262_144)],
    ['<li', '<li'.repeat(350_000)],
    ['<a x', '<a x'.repeat(262_144)],
  ])('strips %s in under 2000 ms', (_label, page) => {
    const t0 = performance.now();
    const res = htmlToDoc(page);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(2000);
    expect(typeof res).toBe('string');
  });
});

describe('fetchDocsPages hostile links', () => {
  it('links are found in one pass', async () => {
    const startUrl = 'https://docs.example/start';
    const nextUrl = 'https://docs.example/next';
    const get: DocsGet = async (url) => {
      if (url === startUrl) {
        return {
          ok: true,
          status: 200,
          finalUrl: url,
          contentType: 'text/html',
          body: '<a x'.repeat(250_000) + '<a href="/next">n</a>',
        };
      }
      if (url === nextUrl) {
        return {
          ok: true,
          status: 200,
          finalUrl: url,
          contentType: 'text/html',
          body: '<h1>Next page</h1>',
        };
      }
      return { ok: false, why: 'not found' };
    };

    const t0 = performance.now();
    const { docs } = await fetchDocsPages(startUrl, { get, robots: RobotsPolicy.allowAll() });
    const elapsed = performance.now() - t0;

    expect(elapsed).toBeLessThan(3000);
    const names = docs.map((d) => d.name);
    expect(names).toContain(nextUrl);
  });
});

describe('htmlToDoc normal pages', () => {
  it('formats headings, paragraphs, and list items', () => {
    expect(htmlToDoc('<h2>Plans <small>new</small></h2><p>One</p><ul><li>A</li><li>B</li></ul>')).toBe(
      '## Plans new\nOne\n\n- A\n- B'
    );
  });

  it('drops comments and script tags', () => {
    expect(htmlToDoc('<p>a<!-- hidden -->b</p><script>x()</script><p>c</p>')).toBe('a b\nc');
  });

  it('preserves comparison operator <', () => {
    expect(htmlToDoc('<p>1 < 2</p>')).toBe('1 < 2');
  });

  it('keeps header tag content (<header> is not <head>)', () => {
    expect(htmlToDoc('<header>Top</header><p>Body</p>')).toBe('Top Body');
  });

  it('formats multiple headings and paragraphs', () => {
    expect(htmlToDoc('<h1>Title</h1><p>One</p><p>Two</p>')).toBe('# Title\nOne\nTwo');
  });

  it('hides rest of page on unclosed comment', () => {
    expect(htmlToDoc('<p>shown</p><!-- <p>not shown</p>')).toBe('shown');
  });
});
