// Guards the built-in fixture app: the benchmark answer key relies on its head tags, headings and
// planted defects. See fixtures/benchmarks/fixture.json.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';

const PORT = 3590;
const base = `http://localhost:${PORT}`;
const get = async (p: string) => {
  const res = await fetch(base + p);
  return { status: res.status, text: await res.text() };
};
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

beforeAll(async () => {
  await new Promise<void>((resolve) => fixtureServer.listen(PORT, () => resolve()));
});
afterAll(async () => {
  await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
});

const PAGES = [
  '/',
  '/login',
  '/dashboard',
  '/deadend',
  '/invoices/new',
  '/about',
  '/invoices/INV-101',
  '/signin',
  '/reports',
];

describe('fixture app head tags', () => {
  it('every HTML page has viewport, icon link and a description', async () => {
    const descriptions = new Set<string>();
    for (const p of PAGES) {
      const { text } = await get(p);
      expect(text, `${p} viewport`).toMatch(/<meta name="viewport"/);
      expect(text, `${p} icon`).toMatch(/<link rel="icon"/);
      const m = text.match(/<meta name="description" content="([^"]*)"/);
      expect(m, `${p} description`).not.toBeNull();
      expect(m![1].length, `${p} description length`).toBeGreaterThanOrEqual(50);
      expect(m![1].length, `${p} description length`).toBeLessThanOrEqual(160);
      descriptions.add(m![1]);
    }
    expect(descriptions.size).toBe(PAGES.length);
  });

  it('/login, /dashboard, /invoices/new have exactly one h1', async () => {
    for (const p of ['/login', '/dashboard', '/invoices/new']) {
      const { text } = await get(p);
      expect(count(text, /<h1[ >]/g), p).toBe(1);
    }
  });
});

describe('fixture app site files', () => {
  it('robots.txt, sitemap.xml and llms.txt name the port the fixture listens on', async () => {
    for (const p of ['/robots.txt', '/sitemap.xml', '/llms.txt']) {
      const { text } = await get(p);
      expect(text, p).toContain(`localhost:${PORT}`);
      expect(text, p).not.toContain('3050');
    }
  });
});

describe('fixture app planted defects', () => {
  it('keeps the planted defects', async () => {
    expect((await get('/about')).text).not.toMatch(/<title/);
    const login = (await get('/login')).text;
    expect(login).toMatch(/method="GET"/);
    expect(login).toMatch(/type="password"/);
    const dead = (await get('/deadend')).text;
    expect(dead).not.toMatch(/<a[ >]/);
    expect(dead).not.toMatch(/<button/);
    const dash = (await get('/dashboard')).text;
    for (const id of ['trigger-error-btn', 'trigger-failed-api-btn', 'tiny-touch-btn']) expect(dash).toContain(id);
    expect((await get('/api/failing-endpoint')).status).toBe(500);
  });

  it('/reports still answers slowly', async () => {
    const t = Date.now();
    await get('/reports');
    expect(Date.now() - t).toBeGreaterThan(1500);
  });
});
