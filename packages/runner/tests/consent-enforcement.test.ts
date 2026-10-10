/**
 * Sign-in consent (ADR 0022) is enforced everywhere a run can act, not only in discovery:
 * approving a kept plan whose sign-in details are gone is refused, a failed sign-in under consent
 * fails the run (also on the caller-supplied test case path), headless Check-ups keep sessions out of
 * the report folder, and the no-AI issues document lists the pages found on its first write.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { RunnerServer } from '../src/server.js';
import { runCheckup, parseArgs } from '../src/checkup.js';

const SITE_PORT = 3291;
const RUNNER_PORT = 3292;
const CHECKUP_PORT = 3293;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-consent-enforcement');
const dataDir = `${outputDir}-data`;
const ciOut = `${outputDir}-ci`;
const PASSWORD = 'Enf0rce-Pw-Qx47-unique';
const siteUrl = `http://shop.example.com:${SITE_PORT}`;
const roles = [{ role: 'manager', username: 'owner@shop.test', password: PASSWORD, loginPath: '/signin' }];

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
      `<form method="post" action="/contact"><label for="m">Message</label><input id="m" name="message" type="text"><button type="submit">Send message</button></form>`
    );
  }
  if (url.pathname === '/contact') return page('Done', '<p>Done.</p>');
  if (url.pathname === '/') return page('Shop', '<p>Welcome to the shop.</p>');
  page('Not found', '<p>Nothing here.</p>', 404);
});

async function post(route: string, body: unknown = {}, port = RUNNER_PORT): Promise<Response> {
  return fetch(`http://localhost:${port}${route}`, {
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
const qaTempDirs = async () => (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('qa-checkup-')).sort();

describe('sign-in consent is enforced beyond discovery', () => {
  let runner: RunnerServer;
  const make = () =>
    new RunnerServer({ port: RUNNER_PORT, outputDir, dataDir, hostAliases: { 'shop.example.com': 'localhost' } });
  const base = { owner: true, breakpoints: ['375px'], maxPages: 10, productId: 'enf' };

  beforeAll(async () => {
    await new Promise<void>((resolve) => shop.listen(SITE_PORT, () => resolve()));
    runner = make();
    await runner.start();
  });

  afterAll(async () => {
    await runner?.stop().catch(() => {});
    await new Promise<void>((resolve) => shop.close(() => resolve()));
    for (const d of [outputDir, dataDir, ciOut]) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it('approving a consented plan whose sign-in details are gone is refused and sends nothing', async () => {
    const res = await post('/api/runner/run', {
      ...base,
      skipReview: false,
      targetUrl: siteUrl,
      roles,
      signInConsent: true,
    });
    expect(res.status).toBe(202);
    expect(await waitForPhase(['awaiting-review', 'failed', 'done'])).toBe('awaiting-review');

    // The runner restarts: the plan is read back from disk, and sign-in details are never on disk.
    await runner.stop();
    runner = make();
    await runner.start();
    sent.length = 0;
    // The person sends a role without a password with the approval: no consent is left.
    const approve = await post('/api/runner/plan/approve', {
      breakpoints: base.breakpoints,
      roles: [{ role: 'manager', username: 'owner@shop.test', loginPath: '/signin' }],
    });
    expect(approve.status).toBe(409);
    expect(await approve.json()).toMatchObject({ code: 'ERR_SIGN_IN_REQUIRED' });
    await new Promise((r) => setTimeout(r, 1500));
    const status = (await (await fetch(`${runnerUrl}/api/runner/status`)).json()) as { phase: string };
    expect(status.phase).toBe('awaiting-review');
    expect(sent).toEqual([]);
  }, 240000);

  it('wrong password under consent on the caller-supplied test case path: run fails, nothing interactive is sent', async () => {
    await post('/api/runner/abort').catch(() => undefined);
    sent.length = 0;
    await post('/api/runner/run', {
      ...base,
      targetUrl: siteUrl,
      roles: [{ ...roles[0], password: `${PASSWORD}-wrong` }],
      signInConsent: true,
      specTestCases: [
        {
          id: 'TC-ANON-1',
          flowId: 'contact',
          name: 'Anonymous visitor sends a message',
          role: 'anonymous',
          startPage: '/',
          steps: [{ action: 'wait', name: 'Wait for page load' }],
          expectations: { url: { pattern: '/*' } },
        },
      ],
    });
    expect(await waitForPhase(['failed', 'done'])).toBe('failed');
    const status = (await (await fetch(`${runnerUrl}/api/runner/status`)).json()) as {
      lastErrorCode?: string;
      lastRunError?: string;
    };
    expect(status.lastErrorCode).toBe('ERR_SIGN_IN_FAILED');
    expect(status.lastRunError ?? '').not.toContain(PASSWORD);
    // Only the failed sign-in attempt itself reached the site.
    expect(sent.filter((s) => s !== 'POST /signin')).toEqual([]);
  }, 240000);

  it('a no-AI run writes "Pages found" into issues.md on its first write', async () => {
    await post('/api/runner/run', { ...base, skipReview: true, planWithoutAI: true, targetUrl: siteUrl });
    expect(await waitForPhase(['done', 'failed'])).toBe('done');
    const issues = (await walk(outputDir)).filter((f) => path.basename(f) === 'issues.md');
    expect(issues.length).toBeGreaterThan(0);
    const texts = await Promise.all(issues.map((f) => fs.readFile(f, 'utf8')));
    expect(texts.some((t) => t.includes('Pages found'))).toBe(true);
  }, 240000);
});

describe('headless Check-up keeps sign-in sessions out of the report folder', () => {
  it('no session file under the report folder, and the working folder is deleted', async () => {
    const before = await qaTempDirs();
    const prev = process.env.QA_CHECKUP_PORT;
    process.env.QA_CHECKUP_PORT = String(CHECKUP_PORT);
    await new Promise<void>((resolve) => shop2.listen(CHECKUP_SITE_PORT, () => resolve()));
    try {
      const args = parseArgs(
        [`http://localhost:${CHECKUP_SITE_PORT}`, '--fail-on', 'none', '--max-pages', '5', '--output', ciOut],
        { QA_USERNAME: 'owner@shop.test', QA_PASSWORD: PASSWORD, QA_LOGIN_PATH: '/signin' } as NodeJS.ProcessEnv
      );
      const code = await runCheckup(args);
      expect(code).toBe(0);
      const files = await walk(ciOut);
      expect(files.length).toBeGreaterThan(0);
      expect(files.filter((f) => /[\\/]auth[\\/]|member\.json|storage-?state/i.test(f))).toEqual([]);
      for (const f of files) {
        if (/\.(png|jpe?g|webm|zip)$/i.test(f)) continue;
        const text = await fs.readFile(f, 'utf8').catch(() => '');
        expect(text, f).not.toContain('shop_session');
        expect(text, f).not.toContain(PASSWORD);
      }
      expect(await qaTempDirs()).toEqual(before);
    } finally {
      if (prev === undefined) delete process.env.QA_CHECKUP_PORT;
      else process.env.QA_CHECKUP_PORT = prev;
      await new Promise<void>((resolve) => shop2.close(() => resolve()));
    }
  }, 300000);
});

// A second small shop on localhost for the headless run (a local address needs no Test Copy mark).
const CHECKUP_SITE_PORT = 3294;
const shop2 = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const signedIn = /shop_session=1/.test(req.headers.cookie || '');
  const page = (title: string, body: string, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><nav><a href="/">Home</a> <a href="/account">Account</a></nav><main><h1>${title}</h1>${body}</main></body></html>`
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
  if (url.pathname === '/account') {
    if (!signedIn) return page('Sign in needed', '<p>Please <a href="/signin">sign in</a>.</p>', 401);
    return page('Account', '<p>Your account.</p>');
  }
  if (url.pathname === '/') return page('Shop', '<p>Welcome to the shop.</p>');
  page('Not found', '<p>Nothing here.</p>', 404);
});
