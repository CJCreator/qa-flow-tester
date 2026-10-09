import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchDocsPages, htmlToDoc, makeGuardedDocsGet } from '../src/discovery/docs-fetch.js';

let server: http.Server;
let base = '';
let offHost = '';

const page = (title: string, links: string[] = []) =>
  `<html><head><title>x</title><script>var secret=1</script></head><body><h1>${title}</h1><p>About ${title}.</p><ul><li>Rule of ${title}</li></ul>${links
    .map((l) => `<a href="${l}">l</a>`)
    .join('')}</body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const html = (b: string, type = 'text/html') => {
      res.writeHead(200, { 'content-type': type });
      res.end(b);
    };
    if (url === '/robots.txt') return html('User-agent: *\nDisallow: /private', 'text/plain');
    if (url === '/docs') return html(page('Docs home', ['/docs/a', '/docs/b', '/private/x', `${offHost}/elsewhere`, 'file:///etc/passwd', '/docs/redir', '/docs/big', '/docs/img']));
    if (url === '/docs/a') return html(page('Guide A', ['/docs']));
    if (url === '/docs/b') return html('# Guide B\n- md rule', 'text/markdown');
    if (url === '/docs/redir') {
      res.writeHead(302, { location: `${offHost}/elsewhere` });
      return res.end();
    }
    if (url === '/docs/big') return html('x'.repeat(2000));
    if (url === '/docs/img') return html('png', 'image/png');
    if (url.startsWith('/many/')) {
      const n = Number(url.slice(6));
      return html(page(`P${n}`, [`/many/${n + 1}`, `/many/${n + 2}`]));
    }
    if (url === '/elsewhere') return html(page('Off host'));
    res.writeHead(404);
    res.end('no');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  offHost = `http://localhost:${port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('htmlToDoc', () => {
  it('keeps headings and list items, drops scripts and tags', () => {
    const t = htmlToDoc(page('Hello &amp; bye'));
    expect(t).toContain('# Hello & bye');
    expect(t).toContain('- Rule of Hello & bye');
    expect(t).not.toContain('secret');
    expect(t).not.toContain('<');
  });
});

describe('fetchDocsPages', () => {
  it('follows same-host links, ignores off-host, robots, file:, redirects off-host, non-doc types', async () => {
    const { docs, skipped } = await fetchDocsPages(`${base}/docs`, { maxBytes: 1000 });
    const names = docs.map((d) => d.name.replace(base, ''));
    expect(names).toEqual(expect.arrayContaining(['/docs', '/docs/a', '/docs/b']));
    expect(names.some((n) => n.includes('elsewhere'))).toBe(false);
    expect(names).not.toContain('/private/x');
    expect(docs.find((d) => d.name.endsWith('/docs/b'))?.text).toContain('# Guide B');
    const why = Object.fromEntries(skipped.map((s) => [s.url.replace(base, ''), s.why]));
    expect(why['/private/x']).toMatch(/robots/);
    expect(why['/docs/redir']).toMatch(/another site/);
    expect(why['/docs/big']).toMatch(/too large/);
    expect(why['/docs/img']).toMatch(/not an HTML/);
    expect(Object.keys(why).some((k) => k.startsWith('file:'))).toBe(false);
  });

  it('stops at 20 pages', async () => {
    const { docs, skipped } = await fetchDocsPages(`${base}/many/1`);
    expect(docs).toHaveLength(20);
    expect(skipped.some((s) => /first 20/.test(s.why))).toBe(true);
  });

  it('refuses file: and non-http start', async () => {
    for (const u of ['file:///etc/passwd', 'ftp://x/y', 'not a url']) {
      const r = await fetchDocsPages(u);
      expect(r.docs).toEqual([]);
      expect(r.skipped).toHaveLength(1);
    }
  });

  it('beta guard refuses a loopback/private docs address', async () => {
    const r = await fetchDocsPages(`${base}/docs`, { get: makeGuardedDocsGet() });
    expect(r.docs).toEqual([]);
    expect(r.skipped[0].why).toMatch(/blocked \(private-address\)/);
  });

  it('beta guard refuses a redirect to a private host', async () => {
    const get = makeGuardedDocsGet({
      lookup: async () => ['93.184.216.34'],
      connect: async (req) => {
        if (req.url.hostname === 'docs.example.com') {
          return { status: 302, headers: { location: 'http://127.0.0.1/x' }, body: '' };
        }
        return { status: 200, headers: { 'content-type': 'text/html' }, body: '<h1>no</h1>' };
      },
    });
    const r = await fetchDocsPages('http://docs.example.com/', { get, robots: (await import('../src/competitive/robots.js')).RobotsPolicy.allowAll() });
    expect(r.docs).toEqual([]);
    expect(r.skipped[0].why).toMatch(/private-address/);
  });
});
