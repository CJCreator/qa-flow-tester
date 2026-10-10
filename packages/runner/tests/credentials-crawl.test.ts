/**
 * Test sign-in as consent (ADR 0022) against the real runner and a small "live" shop: good details
 * allow full testing without a Test Copy, Sensitive Actions stay untouched, no consent stays
 * read-only, a shared machine ignores consent, a wrong password stops the run before the crawl, and
 * the password never reaches disk, the stream or the console.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import http from 'http';
import type { ReleaseReport, ReviewPlan } from '@qa/types';
import { RunnerServer } from '../src/server.js';

const SITE_PORT = 3194;
const RUNNER_PORT = 3195;
const BETA_PORT = 3196;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-credentials-crawl');
const dataDir = `${outputDir}-data`;
const betaOut = `${outputDir}-beta`;
const PASSWORD = 'S3cret-Pw-Zq81-unique';
const siteUrl = `http://shop.example.com:${SITE_PORT}`;
const roles = [{ role: 'manager', username: 'owner@shop.test', password: PASSWORD, loginPath: '/signin' }];
const SENSITIVE = /\/account\/delete|\/pay\b/;

const sent: string[] = [];
const shop = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (req.method !== 'GET' && req.method !== 'HEAD') sent.push(`${req.method} ${url.pathname}`);
  const signedIn = /shop_session=1/.test(req.headers.cookie || '');
  const page = (title: string, body: string, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><nav><a href="/">Home</a> <a href="/pricing">Pricing</a> <a href="/account">Account</a></nav><main><h1>${title}</h1>${body}</main></body></html>`
    );
  };
  const SIGN_IN = `<form method="post" action="/signin"><label for="e">Email</label><input id="e" name="email" type="email"><label for="p">Password</label><input id="p" name="password" type="password"><button type="submit">Sign in</button></form>`;
  if (url.pathname === '/signin' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const form = new URLSearchParams(raw);
      if (form.get('email') === 'owner@shop.test' && form.get('password') === PASSWORD) {
        res.writeHead(302, { 'Set-Cookie': 'shop_session=1; Path=/; HttpOnly', Location: '/account' });
        res.end();
      } else {
        page('Sign in', `<p role="alert">Wrong email or password</p>${SIGN_IN}`);
      }
    });
    return;
  }
  if (url.pathname === '/signin') return page('Sign in', SIGN_IN);
  if (url.pathname === '/pricing') return page('Pricing', '<p>Plans from nothing.</p>');
  if (url.pathname === '/account') {
    if (!signedIn) return page('Sign in needed', '<p>Please <a href="/signin">sign in</a>.</p>', 401);
    return page(
      'Account',
      `<a href="/account/orders">Orders</a>
       <form method="post" action="/contact"><label for="m">Message</label><input id="m" name="message" type="text"><button type="submit">Send message</button></form>
       <form method="post" action="/account/delete"><button type="submit">Delete account</button></form>
       <form method="post" action="/pay"><button type="submit">Pay now</button></form>`
    );
  }
  if (url.pathname === '/account/orders' && signedIn) return page('Orders', '<p>No orders yet.</p>');
  if (url.pathname === '/contact' || url.pathname === '/account/delete' || url.pathname === '/pay') {
    return page('Done', '<p>Done.</p>');
  }
  if (url.pathname === '/') return page('Shop', '<p>Welcome to the shop.</p>');
  page('Not found', '<p>Nothing here.</p>', 404);
});

async function post(route: string, body: unknown = {}): Promise<Response> {
  return fetch(`${runnerUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
async function waitForPhase(wanted: string[], seconds = 200): Promise<string> {
  for (let i = 0; i < seconds * 2; i++) {
    const s = (await (await fetch(`${runnerUrl}/api/runner/status`)).json()) as { phase: string };
    if (wanted.includes(s.phase)) return s.phase;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timed out');
}
async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : Promise.resolve([path.join(dir, e.name)])))
  );
  return files.flat();
}

describe('test sign-in as consent (ADR 0022)', () => {
  let runner: RunnerServer;
  let streamed = '';
  let stream: http.ClientRequest;
  const logged: string[] = [];
  const events = (): Array<Record<string, unknown>> =>
    streamed
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => {
        try {
          return JSON.parse(l.slice(5)) as Record<string, unknown>;
        } catch {
          return {};
        }
      });
  const base = { owner: true, skipReview: true, breakpoints: ['375px'], maxPages: 10 };

  beforeAll(async () => {
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    await new Promise<void>((resolve) => shop.listen(SITE_PORT, () => resolve()));
    runner = new RunnerServer({
      port: RUNNER_PORT,
      outputDir,
      dataDir,
      hostAliases: { 'shop.example.com': 'localhost' },
    });
    await runner.start();
    stream = http.get({ host: 'localhost', port: RUNNER_PORT, path: '/api/runner/stream' }, (res) => {
      res.on('data', (chunk) => (streamed += chunk));
    });
    stream.on('error', () => undefined);
    await new Promise((r) => setTimeout(r, 500));
  });

  afterAll(async () => {
    stream?.destroy();
    vi.restoreAllMocks();
    await runner.stop();
    await new Promise<void>((resolve) => shop.close(() => resolve()));
    for (const d of [outputDir, dataDir, betaOut, `${betaOut}-data`]) {
      await fs.rm(d, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('live host + consent + good details: acts after sign-in, never on a Sensitive Action', async () => {
    sent.length = 0;
    // Pause at Plan Review so the plan can be read, then approve it: the plan is gone once the run ends.
    const res = await post('/api/runner/run', {
      ...base,
      skipReview: false,
      targetUrl: siteUrl,
      productId: 'consent',
      roles,
      signInConsent: true,
    });
    expect(res.status).toBe(202);
    expect(await waitForPhase(['awaiting-review', 'failed', 'done'])).toBe('awaiting-review');
    const planRes = await fetch(`${runnerUrl}/api/runner/plan`);
    expect(planRes.status).toBe(200);
    const plan = (await planRes.json()) as ReviewPlan;
    const planned = (plan.planPages ?? []).filter((p) => !p.skipped);
    expect(planned.length).toBeGreaterThan(0);
    const approve = await post('/api/runner/plan/approve', { breakpoints: base.breakpoints });
    expect(approve.status).toBeLessThan(300);
    expect(await waitForPhase(['done', 'failed'])).toBe('done');

    expect(sent).toContain('POST /signin');
    expect(sent.filter((s) => SENSITIVE.test(s))).toEqual([]);

    const report = (await (await fetch(`${runnerUrl}/api/report`)).json()) as ReleaseReport;
    expect(report.scanMode).not.toBe('read-only');
    expect(report.notes?.join(' ')).toMatch(/sign-in details you gave/i);
    // Coverage matches the site map.
    expect(report.pageCoverage).toBeDefined();
    expect(report.pageCoverage!.reached).toBe(report.siteMap!.pages.length);
    // Every Plan Item has a result.
    expect(report.results.length).toBeGreaterThan(0);
    const ran = new Set(report.results.map((r) => r.testCaseId));
    // Each planned page is visited (PAGE-nnn, one per role that reaches it); each of its own tests has a result.
    const tests = planned.flatMap((p) => p.tests.filter((t) => !t.skipped).map((t) => t.id));
    const visits = report.results.filter((r) => r.flowId === 'page-visit').length;
    const wanted = planned.reduce((n, p) => n + Math.max(1, p.reachedBy?.length ?? 0), 0);
    expect(visits).toBeGreaterThanOrEqual(planned.length);
    expect(visits).toBe(wanted);
    expect(tests.filter((id) => !ran.has(id))).toEqual([]);
  }, 240000);

  it('no consent flag stays read-only, even after a consented run on the same host', async () => {
    sent.length = 0;
    const res = await post('/api/runner/run', { ...base, targetUrl: siteUrl, productId: 'consent' });
    expect(res.status).toBe(202);
    expect(await waitForPhase(['done', 'failed'])).toBe('done');
    const report = (await (await fetch(`${runnerUrl}/api/report`)).json()) as ReleaseReport;
    expect(report.scanMode).toBe('read-only');
    expect(sent).toEqual([]);

    // Details without the flag are not consent either.
    sent.length = 0;
    await post('/api/runner/run', { ...base, targetUrl: siteUrl, productId: 'consent', roles });
    expect(await waitForPhase(['done', 'failed'])).toBe('done');
    const again = (await (await fetch(`${runnerUrl}/api/report`)).json()) as ReleaseReport;
    expect(again.scanMode).toBe('read-only');
    expect(sent.filter((s) => SENSITIVE.test(s) || s === 'POST /contact')).toEqual([]);
  }, 240000);

  it('wrong password: RUN_FAILED with signInReason wrong-details, no crawl', async () => {
    const before = events().length;
    const bad = [{ ...roles[0], password: `${PASSWORD}-wrong` }];
    await post('/api/runner/run', {
      ...base,
      targetUrl: siteUrl,
      productId: 'consent',
      roles: bad,
      signInConsent: true,
    });
    expect(await waitForPhase(['failed', 'done'])).toBe('failed');
    await new Promise((r) => setTimeout(r, 300));
    const fresh = events().slice(before);
    const failed = fresh.find((e) => e.type === 'RUN_FAILED');
    expect(failed).toMatchObject({ signInReason: 'wrong-details', code: 'ERR_SIGN_IN_FAILED' });
    expect(fresh.filter((e) => e.type === 'DISCOVERY_PROGRESS' || e.type === 'DISCOVERY_COMPLETED')).toEqual([]);
    expect(String(failed?.error)).not.toContain(PASSWORD);
  }, 240000);

  it('password is absent from the run folder, data folder, stream and console', async () => {
    for (const file of [...(await walk(outputDir)), ...(await walk(dataDir))]) {
      if (/\.(png|jpe?g|webm|zip)$/i.test(file)) continue;
      expect(await fs.readFile(file, 'utf8').catch(() => ''), file).not.toContain(PASSWORD);
    }
    expect(streamed).not.toContain(PASSWORD);
    expect(logged.join('\n')).not.toContain(PASSWORD);
  });

  it('a shared machine (beta) ignores consent', async () => {
    const beta = new RunnerServer({
      port: BETA_PORT,
      outputDir: betaOut,
      dataDir: `${betaOut}-data`,
      beta: true,
      hostAliases: { 'shop.example.com': 'localhost' },
    });
    await beta.start();
    try {
      sent.length = 0;
      const baseUrl = `http://localhost:${BETA_PORT}`;
      const res = await fetch(`${baseUrl}/api/runner/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, targetUrl: siteUrl, productId: 'beta', roles, signInConsent: true }),
      });
      // A shared machine refuses a private target or runs it read-only; it never acts on it.
      if (res.status === 202) {
        let phase = '';
        for (let i = 0; i < 120; i++) {
          phase = ((await (await fetch(`${baseUrl}/api/runner/status`)).json()) as { phase: string }).phase;
          if (['done', 'failed'].includes(phase)) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (phase === 'done') {
          const rep = (await (await fetch(`${baseUrl}/api/report`)).json()) as ReleaseReport;
          expect(rep.scanMode).toBe('read-only');
        }
      } else {
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
      expect(sent.filter((x) => SENSITIVE.test(x) || x === 'POST /contact')).toEqual([]);
    } finally {
      await beta.stop();
    }
  }, 240000);
});
