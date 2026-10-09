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

describe('fixture app roles, slow pages, docs and saved sessions', () => {
  const as = (role: string, p: string) =>
    fetch(base + p, { headers: { cookie: `fixture_session=${role}` }, redirect: 'manual' }).then(async (r) => ({
      status: r.status,
      text: await r.text(),
    }));

  it('Create user is admin-only: link and page hidden from viewer and manager', async () => {
    const admin = await as('admin', '/account');
    expect(admin.text).toContain('/account/users/new');
    expect((await as('admin', '/account/users/new')).status).toBe(200);
    for (const role of ['viewer', 'manager']) {
      expect((await as(role, '/account')).text, role).not.toContain('/account/users/new');
      expect((await as(role, '/account/users/new')).status, role).toBe(403);
    }
    expect((await as('expired', '/account/users/new')).status).toBe(302);
  });

  it('the admin account signs in, and the Team page still works for manager and admin', async () => {
    const res = await fetch(base + '/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'email=admin%40example.com&password=admin-password',
      redirect: 'manual',
    });
    expect(res.headers.get('set-cookie')).toContain('fixture_session=admin');
    expect((await as('manager', '/account/team')).status).toBe(200);
    expect((await as('viewer', '/account/team')).status).toBe(403);
  });

  it('/slow/:n answers after ?delay and links to the next; delay is capped', async () => {
    const t = Date.now();
    const { text } = await get('/slow/2?delay=300');
    expect(Date.now() - t).toBeGreaterThanOrEqual(250);
    expect(text).toContain('/slow/3?delay=300');
    expect((await get('/slow/abc')).status).toBe(404);
  });

  it('the home page does not link to the slow, docs or saved-session routes', async () => {
    const home = (await get('/')).text;
    for (const p of ['/slow/', '/docs', '/saved-session']) expect(home).not.toContain(p);
  });

  it('serves both guides; the admin guide names a feature the app does not have', async () => {
    const admin = await get('/docs/admin-guide.md');
    expect(admin.status).toBe(200);
    expect(admin.text).toContain('Create user');
    expect(admin.text).toContain('Export all to PDF');
    expect((await get('/invoices')).text).not.toContain('Export all to PDF');
    expect((await get('/docs/product-guide.md')).status).toBe(200);
    expect((await get('/docs/other.md')).status).toBe(404);
  });

  it('mock saved session hands back a storage state; unknown roles are refused', async () => {
    const ok = JSON.parse((await get('/saved-session/mint?role=admin')).text);
    expect(ok.cookies[0]).toMatchObject({ name: 'fixture_session', value: 'admin', domain: 'localhost' });
    expect(ok.origins).toEqual([]);
    expect((await get('/saved-session/mint?role=root')).status).toBe(400);
  });
});
