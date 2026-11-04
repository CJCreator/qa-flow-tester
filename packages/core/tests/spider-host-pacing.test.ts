/**
 * REQ-035 (ADR 0015): with a HostPacer built from the site's robots.txt (Crawl-delay: 1 on the audit
 * fixture), the Spider sends one top-level request to the host at a time, at least the Crawl-delay apart,
 * even with several workers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';
import { RobotsPolicy } from '../src/competitive/robots.js';
import { HostPacer } from '../src/host-pacer.js';
import { makeOutboundFetch } from '../src/safe-net.js';
import { startAuditSite, type AuditSiteRequest, type AuditSiteServer } from './helpers/audit-site-server.js';

/** Page documents, robots.txt and sitemap files: not the stylesheets, scripts and images a page pulls in. */
function topLevel(requests: readonly AuditSiteRequest[], origin: string): AuditSiteRequest[] {
  return requests.filter((r) => {
    const last = new URL(r.path, origin).pathname.split('/').pop() || '';
    const ext = last.includes('.') ? last.slice(last.lastIndexOf('.')).toLowerCase() : '';
    return ext === '' || ext === '.html' || ext === '.xml' || ext === '.txt';
  });
}

describe('Spider with a HostPacer (REQ-035)', () => {
  let browser: Browser;
  let audit: AuditSiteServer;

  beforeAll(async () => {
    browser = await chromium.launch();
    audit = await startAuditSite();
  });

  afterAll(async () => {
    await browser?.close();
    await audit?.close();
  });

  it('AC-1: no two top-level requests to the host overlap, and starts are at least the Crawl-delay apart', async () => {
    const robots = await RobotsPolicy.fetch(audit.origin, 'qa-crawler', makeOutboundFetch());
    expect(robots.crawlDelayMs).toBe(1000);
    const pacer = new HostPacer({ minGapMs: 100, crawlDelayMs: robots.crawlDelayMs });
    audit.clearRequests();

    const context = await browser.newContext();
    let result;
    try {
      result = await new DeterministicSpider([], 4).crawl(context, audit.origin, {
        concurrency: 3,
        exploreClicks: false,
        robots,
        pacer,
        outboundFetch: makeOutboundFetch({ pacer }),
      });
    } finally {
      await context.close();
    }

    expect(result.pages.length).toBeGreaterThan(0);
    const top = topLevel(audit.requests, audit.origin).sort((a, b) => a.startedAt - b.startedAt);
    const paths = top.map((r) => new URL(r.path, audit.origin).pathname);
    expect(paths).toEqual(expect.arrayContaining(['/robots.txt', '/sitemap.xml', '/']));
    expect(top.length).toBeGreaterThanOrEqual(5);

    for (let i = 1; i < top.length; i++) {
      const prev = top[i - 1];
      const cur = top[i];
      expect(prev.finishedAt, `${prev.path} finished`).toBeDefined();
      // No overlap: the next request arrives only after the previous response has finished.
      expect(cur.startedAt, `${cur.path} started before ${prev.path} finished`).toBeGreaterThanOrEqual(
        prev.finishedAt!
      );
      expect(cur.startedAt - prev.startedAt, `${prev.path} -> ${cur.path}`).toBeGreaterThanOrEqual(1000);
    }
  }, 120000);

  it('waiting for a turn stops at the crawl deadline', async () => {
    // A 30 s delay against a 2 s crawl: after robots.txt, every later request would have to wait past the deadline.
    const pacer = new HostPacer({ crawlDelayMs: 30_000 });
    const context = await browser.newContext();
    const started = Date.now();
    let result;
    try {
      result = await new DeterministicSpider([], 10).crawl(context, audit.origin, {
        concurrency: 2,
        exploreClicks: false,
        maxDurationMs: 2000,
        pacer,
      });
    } finally {
      await context.close();
    }

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.pages).toEqual([]);
    expect(result.skipped?.some((s) => s.why === 'time-limit')).toBe(true);
  }, 60000);
});
