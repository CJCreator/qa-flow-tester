/**
 * AC5: on the same login-protected shop, a headless Check-up (QA_USERNAME / QA_PASSWORD, no AI key) and a
 * direct POST /api/runner/run with the same details and consent report the same Issues. Identity is the
 * finding fingerprint (the findings contract, ADR 0017); timestamps, run ids and order are ignored.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import http from 'http';
import type { ReleaseReport } from '@qa/types';
import { buildKnownFindings } from '@qa/core';
import { RunnerServer } from '../src/server.js';

const SITE_PORT = 3310;
const RUNNER_PORT = 3311;
const CHECKUP_PORT = 3312;
const runnerUrl = `http://localhost:${RUNNER_PORT}`;
const outputDir = path.join(process.cwd(), '.tmp-checkup-vs-api');
const dataDir = `${outputDir}-data`;
const ciOut = `${outputDir}-ci`;
const PASSWORD = 'Same-Pw-Kd52-unique';
const USER = 'owner@shop.test';
const siteUrl = `http://localhost:${SITE_PORT}`;

const shop = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
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
      if (form.get('email') === USER && form.get('password') === PASSWORD) {
        res.writeHead(302, { 'Set-Cookie': 'shop_session=1; Path=/; HttpOnly', Location: '/account' });
        res.end();
      } else {
        page('Sign in', `<p role="alert">Wrong email or password</p>${SIGN_IN}`);
      }
    });
    return;
  }
  if (url.pathname === '/signin') return page('Sign in', SIGN_IN);
  if (url.pathname === '/pricing') return page('Pricing', '<p>Plans from nothing.</p><img src="/p.png">');
  if (url.pathname === '/account') {
    if (!signedIn) return page('Sign in needed', '<p>Please <a href="/signin">sign in</a>.</p>', 401);
    return page(
      'Account',
      `<a href="/account/orders">Orders</a><form method="post" action="/contact"><label for="m">Message</label><input id="m" name="message" type="text"><button type="submit">Send message</button></form>`
    );
  }
  if (url.pathname === '/account/orders' && signedIn) return page('Orders', '<p>No orders yet.</p>');
  if (url.pathname === '/contact') return page('Done', '<p>Done.</p>');
  if (url.pathname === '/') return page('Shop', '<p>Welcome to the shop.</p>');
  page('Not found', '<p>Nothing here.</p>', 404);
});

async function waitDone(seconds = 240): Promise<string> {
  for (let i = 0; i < seconds * 2; i++) {
    const s = (await (await fetch(`${runnerUrl}/api/runner/status`)).json()) as { phase: string };
    if (s.phase === 'done' || s.phase === 'failed') return s.phase;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('timed out');
}

describe('headless Check-up and API run report the same Issues (AC5)', () => {
  let runner: RunnerServer;
  const prevPort = process.env.QA_CHECKUP_PORT;

  beforeAll(async () => {
    // checkup.ts reads its port when first loaded, so set it before the dynamic import below.
    process.env.QA_CHECKUP_PORT = String(CHECKUP_PORT);
    await new Promise<void>((resolve) => shop.listen(SITE_PORT, () => resolve()));
    runner = new RunnerServer({ port: RUNNER_PORT, outputDir, dataDir });
    await runner.start();
  });

  afterAll(async () => {
    if (prevPort === undefined) delete process.env.QA_CHECKUP_PORT;
    else process.env.QA_CHECKUP_PORT = prevPort;
    await runner?.stop().catch(() => {});
    await new Promise<void>((resolve) => shop.close(() => resolve()));
    for (const d of [outputDir, dataDir, ciOut]) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it('same fingerprints from both paths', async () => {
    const { runCheckup, parseArgs, buildRunBody } = await import('../src/checkup.js');
    const args = parseArgs(
      [siteUrl, '--fail-on', 'none', '--max-pages', '8', '--output', ciOut],
      { QA_USERNAME: USER, QA_PASSWORD: PASSWORD, QA_LOGIN_PATH: '/signin' } as NodeJS.ProcessEnv
    );
    expect(await runCheckup(args)).toBe(0);
    const headless = JSON.parse(await fs.readFile(path.join(ciOut, 'known-findings.json'), 'utf8')) as {
      findings: Array<{ fingerprint: string }>;
    };

    // The API run sends exactly the body the headless path builds, plus one viewport to keep it short.
    const body = { ...buildRunBody(args), breakpoints: ['375px'] };
    const res = await fetch(`${runnerUrl}/api/runner/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(202);
    expect(await waitDone()).toBe('done');
    const report = (await (await fetch(`${runnerUrl}/api/report`)).json()) as ReleaseReport;
    const api = buildKnownFindings(report);

    const ids = (l: Array<{ fingerprint: string }>) => l.map((f) => f.fingerprint).sort();
    expect(ids(headless.findings).length).toBeGreaterThan(0);
    expect(ids(api.findings)).toEqual(ids(headless.findings));
  }, 600000);
});
