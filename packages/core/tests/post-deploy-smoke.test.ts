import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { releaseVerdict } from '@qa/types';
import { runPostDeploySmoke, smokeReport, readVersion } from '../src/post-deploy-smoke.js';

type Handler = (url: string, res: http.ServerResponse) => void;
let server: http.Server | undefined;
const methods: string[] = [];
const hits: string[] = [];

async function start(handler: Handler): Promise<string> {
  methods.length = 0;
  hits.length = 0;
  server = http.createServer((req, res) => {
    methods.push(req.method ?? '');
    hits.push(req.url ?? '');
    handler(req.url ?? '', res);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  server?.closeAllConnections?.();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

const ok = (res: http.ServerResponse, body = 'ok', type = 'text/plain') => {
  res.writeHead(200, { 'content-type': type });
  res.end(body);
};
const none = (res: http.ServerResponse, code = 404) => {
  res.writeHead(code);
  res.end('');
};

const healthy: Handler = (url, res) => {
  if (url === '/healthz') return ok(res);
  if (url === '/' || url === '/pricing' || url === '/robots.txt') return ok(res);
  if (url === '/sitemap.xml') return ok(res, '<urlset></urlset>', 'application/xml');
  if (url === '/version.json') return ok(res, '{"version":"1.2.3"}', 'application/json');
  none(res);
};

describe('post-deploy smoke', () => {
  it('reads only with GET, health first, and passes on a healthy App', async () => {
    const url = await start(healthy);
    const r = await runPostDeploySmoke({ targetUrl: url, expectedVersion: '1.2.3' });
    expect(new Set(methods)).toEqual(new Set(['GET']));
    expect(hits[0]).toBe('/healthz');
    expect(hits.slice(1, 5)).toEqual(['/', '/pricing', '/robots.txt', '/sitemap.xml']);
    expect(r.findings).toEqual([]);
    expect(r.healthGateFailed).toBe(false);
    // Decision (T-47): a smoke run is not a release verdict. With no findings and no grades,
    // releaseVerdict reads "not ready: nothing checked", so assert the smoke report's own outcome.
    const report = smokeReport(r, url);
    expect(report.coverage.passed).toBeGreaterThan(0);
    expect(report.coverage.failed).toBe(0);
  });

  it('stops after a failing health endpoint and lists what it skipped', async () => {
    const url = await start((u, res) => (u === '/healthz' ? none(res, 500) : ok(res)));
    const r = await runPostDeploySmoke({ targetUrl: url });
    expect(r.healthGateFailed).toBe(true);
    expect(hits).toEqual(['/healthz']);
    expect(r.findings[0].severity).toBe('Blocker');
    expect(r.notChecked.some((l) => l.startsWith('/pricing'))).toBe(true);
    expect(releaseVerdict(smokeReport(r, url).findings).ready).toBe(false);
  });

  it('fails the gate when the health endpoint does not answer in time', async () => {
    const url = await start((u, res) => {
      if (u !== '/healthz') ok(res);
    });
    const r = await runPostDeploySmoke({ targetUrl: url, requestTimeoutMs: 150 });
    expect(r.healthGateFailed).toBe(true);
    expect(r.findings[0].title).toBe('Health endpoint failed');
  });

  it('continues and says so when no health endpoint exists', async () => {
    const url = await start((u, res) => (['/', '/pricing', '/robots.txt'].includes(u) ? ok(res) : none(res)));
    const r = await runPostDeploySmoke({ targetUrl: url });
    expect(r.healthGateFailed).toBe(false);
    expect(r.notChecked.some((l) => l.startsWith('Health endpoint not found'))).toBe(true);
    expect(hits).toContain('/');
  });

  it('a missing /pricing is a Minor finding, not a crash', async () => {
    const url = await start((u, res) => (u === '/pricing' ? none(res) : healthy(u, res)));
    const r = await runPostDeploySmoke({ targetUrl: url });
    const f = r.findings.find((x) => x.where.urlPath === '/pricing');
    expect(f?.severity).toBe('Minor');
  });

  it('flags a sitemap that is not a sitemap', async () => {
    const url = await start((u, res) => (u === '/sitemap.xml' ? ok(res, 'hello') : healthy(u, res)));
    const r = await runPostDeploySmoke({ targetUrl: url });
    expect(r.findings.some((f) => f.title.startsWith('sitemap.xml could not be read'))).toBe(true);
  });

  it('flags a version mismatch, notes an uncompared version, and says when none is found', async () => {
    const url = await start(healthy);
    const bad = await runPostDeploySmoke({ targetUrl: url, expectedVersion: '9.9.9' });
    expect(bad.findings.some((f) => f.title.startsWith('Version does not match'))).toBe(true);
    const free = await runPostDeploySmoke({ targetUrl: url });
    expect(free.notes[0]).toContain('Not compared');
    await new Promise<void>((r) => server!.close(() => r()));
    const url2 = await start((u, res) => (u === '/version.json' ? none(res) : healthy(u, res)));
    const none2 = await runPostDeploySmoke({ targetUrl: url2 });
    expect(none2.notChecked.some((l) => l.startsWith('Version not checked'))).toBe(true);
  });

  it('honours the total time budget', async () => {
    const url = await start((u, res) => {
      if (u === '/healthz') return ok(res);
      // everything else hangs
    });
    const t = Date.now();
    const r = await runPostDeploySmoke({ targetUrl: url, totalBudgetMs: 300, requestTimeoutMs: 5000 });
    expect(Date.now() - t).toBeLessThan(3000);
    expect(r.notChecked.some((l) => l.includes('time budget'))).toBe(true);
  });

  it('asks for confirmation before reading a live address, and sends nothing', async () => {
    let called = 0;
    const r = await runPostDeploySmoke({
      targetUrl: 'https://app.example.com',
      fetchImpl: (async () => {
        called++;
        return new Response('');
      }) as typeof fetch,
    });
    expect(r.refused).toContain('live address');
    expect(called).toBe(0);
    const ok2 = await runPostDeploySmoke({
      targetUrl: 'https://app.example.com',
      confirmLive: true,
      fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch,
    });
    expect(ok2.refused).toBeUndefined();
  });

  it('refuses a private address on a shared machine (beta)', async () => {
    const r = await runPostDeploySmoke({ targetUrl: 'http://127.0.0.1:9', beta: true });
    expect(r.refused).toContain('shared machine');
  });

  it('reads versions from JSON or short text only', () => {
    expect(readVersion('{"commit":"abc123"}')).toBe('abc123');
    expect(readVersion('1.4.2\n')).toBe('1.4.2');
    expect(readVersion('<html>nope</html>')).toBeUndefined();
  });

  it('has no paging, Slack or canary code', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/post-deploy-smoke.ts'), 'utf8');
    expect(src).not.toMatch(/slack|pagerduty|canary/i);
  });
});
