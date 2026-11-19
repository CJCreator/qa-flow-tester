/**
 * T-407: a Website Audit paused with a checkpoint (by a restart, or by its hosted tab closing) is resumed with
 * POST /api/audits/:id/resume. A plain http server, a real RunSlot and a real audit store in a temp folder, and a
 * fake crawl: no Chromium, no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { AuditRequest } from '@qa/types';
import {
  AUDIT_CHECKPOINT_NAME,
  AuditStore,
  LocalAuditStoreBackend,
  createPageRecorder,
  type AuditCrawlCheckpoint,
  type AuditCrawlOptions,
  type AuditCrawlResult,
  type AuditPageRecorder,
  type RecordedPage,
} from '@qa/core';
import {
  AUDIT_NOT_PAUSED,
  AUDIT_PAUSED,
  createAuditCrawlRoutes,
  pauseAuditRun,
  type AuditCrawl,
  type AuditCrawlRouteDeps,
} from '../src/routes/audit-crawl.js';
import { resolveRoute, type Route } from '../src/routes/route.js';
import { DefaultRunSlot } from '../src/session/run-slot.js';
import { AuditRuns } from '../src/session/audit-run.js';
import { recoverRunningAudits } from '../src/server.js';

const REQUEST: AuditRequest = {
  url: 'https://example.com/',
  limits: { maxPages: 3, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};

let dir: string;
let store: AuditStore;
let slot: DefaultRunSlot;
let runs: AuditRuns;
let servers: http.Server[];

function crawlResult(pages: AuditCrawlResult['pages']): AuditCrawlResult {
  return {
    startUrl: REQUEST.url,
    finalUrl: REQUEST.url,
    pages,
    coverage: { found: pages.length, reached: pages.length, skipped: [] },
    leavingSite: [],
    signInWalls: [],
    paymentAreas: [],
    pacer: {} as never,
    crawlDelayMs: null,
  };
}

function deps(crawl: AuditCrawl, extra: Partial<AuditCrawlRouteDeps> = {}): AuditCrawlRouteDeps {
  return {
    store,
    caller: () => ({ owner: true }),
    slot: () => slot,
    runs,
    checkAddress: async () => ({ ok: true, finalUrl: REQUEST.url, status: 200 }),
    crawl,
    makeWorkDir: () => fs.mkdtemp(path.join(dir, 'work-')),
    ...extra,
  };
}

async function serve(rows: Route[]): Promise<string> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = resolveRoute(rows, req.method ?? 'GET', url.pathname);
    if (!match) {
      res.writeHead(404);
      res.end();
      return;
    }
    Promise.resolve(match.route.handle({ server: undefined as never, req, res, url, params: match.params })).catch(
      () => {
        res.writeHead(500);
        res.end();
      }
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function post(url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, json: await res.json() };
}

/** Resolves once the audit's run has sent its final event. */
async function runEnded(auditId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const run = runs.get(auditId);
    if (run?.finished) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('the run did not end');
}

function recorded(urlPath: string, depth: number): RecordedPage {
  return {
    info: { urlPath, title: urlPath, depth, links: [] },
    read: null,
    coverage: 'sample',
    accessibility: null,
    phone: null,
    timing: null,
    labDone: true,
  };
}

/** A version left 'running' with a checkpoint of 2 recorded pages and 1 still to load, as a crash leaves it. */
async function runningWithCheckpoint(): Promise<string> {
  const v = await store.createAudit(REQUEST);
  await store.writeVersionJson(v.auditId, 1, 'checkpoint/pages-1', [recorded('/', 0), recorded('/a', 1)]);
  await store.writeVersionJson(v.auditId, 1, AUDIT_CHECKPOINT_NAME, {
    format: 1,
    savedAt: new Date().toISOString(),
    chunks: 1,
    crawl: {
      finalUrl: REQUEST.url,
      frontier: { visited: ['/', '/a'], queued: ['/b'], shapeCounts: [] },
      pending: [{ url: 'https://example.com/b', depth: 1 }],
      pages: ['/', '/a'],
      skipped: [],
      signInWalls: [],
      crawlDone: false,
    },
  });
  return v.auditId;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-resume-route-'));
  store = new AuditStore(new LocalAuditStoreBackend(path.join(dir, 'store')));
  slot = new DefaultRunSlot();
  runs = new AuditRuns();
  servers = [];
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(null)))));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('T-407: resume after a restart', () => {
  it('a restart leaves the version paused and resumable; Resume carries it on to done', async () => {
    const auditId = await runningWithCheckpoint();
    const plain = await store.createAudit(REQUEST);

    expect(await recoverRunningAudits(store)).toBe(2);
    const paused = await store.getVersion(auditId, 1);
    expect(paused?.status).toBe('paused');
    expect(paused?.stoppedReason).toBe('tool-restarted');
    // Without a checkpoint there is nothing to carry on from.
    expect((await store.getVersion(plain.auditId, 1))?.status).toBe('stopped');

    let seen: AuditCrawlOptions | undefined;
    let recorder: AuditPageRecorder | undefined;
    const crawl: AuditCrawl = async (_request, opts) => {
      seen = opts;
      return crawlResult([...(opts.resume?.pages ?? []), { urlPath: '/b', title: 'B', depth: 1, links: [] }]);
    };
    const base = await serve(
      createAuditCrawlRoutes(
        deps(crawl, {
          createRecorder: (o) => {
            recorder = createPageRecorder(o);
            return recorder;
          },
        })
      )
    );

    const reply = await post(`${base}/api/audits/${auditId}/resume`);
    expect(reply.status).toBe(202);
    expect(reply.json).toEqual({ auditId, version: 1 });
    await runEnded(auditId);

    expect(seen?.resume?.pages.map((p) => p.urlPath)).toEqual(['/', '/a']);
    expect(seen?.resume?.pending).toEqual([{ url: 'https://example.com/b', depth: 1 }]);
    expect(seen?.checkpoint).toBeDefined();
    expect(recorder?.pages.map((p) => p.info.urlPath)).toEqual(['/', '/a']);

    const done = await store.getVersion(auditId, 1);
    expect(done?.status).toBe('done');
    expect(done?.pagesRecorded).toBe(3);
    expect(done?.error).toBeUndefined();
    expect(done?.stoppedReason).toBeUndefined();
    expect(slot.kind).toBeNull();
  });

  it('refuses to resume a version that is not paused', async () => {
    const v = await store.createAudit(REQUEST);
    await store.updateVersion(v.auditId, 1, { status: 'done', finishedAt: new Date().toISOString() });
    const base = await serve(createAuditCrawlRoutes(deps(async () => crawlResult([]))));
    const reply = await post(`${base}/api/audits/${v.auditId}/resume`);
    expect(reply.status).toBe(409);
    expect(reply.json).toEqual({ error: AUDIT_NOT_PAUSED, code: 'ERR_AUDIT_NOT_PAUSED' });
    expect(slot.kind).toBeNull();
  });
});

describe('T-407: pausing a run', () => {
  const checkpoint: AuditCrawlCheckpoint = {
    finalUrl: REQUEST.url,
    frontier: { visited: ['/'], queued: [], shapeCounts: [] },
    pending: [{ url: 'https://example.com/a', depth: 1 }],
    pages: [],
    skipped: [],
    signInWalls: [],
    crawlDone: false,
  };
  /** Saves a checkpoint, then waits for the stop. */
  const pausableCrawl =
    (onStarted: () => void): AuditCrawl =>
    async (_request, opts) => {
      await opts.checkpoint?.save(checkpoint);
      onStarted();
      await new Promise<void>((resolve) => opts.signal?.addEventListener('abort', () => resolve(), { once: true }));
      return crawlResult([]);
    };

  it('a pause with a checkpoint leaves the version paused; a stop leaves it stopped', async () => {
    let started!: () => void;
    let ready = new Promise<void>((r) => (started = r));
    const base = await serve(createAuditCrawlRoutes(deps(pausableCrawl(() => started()))));

    const first = await post(`${base}/api/audits`, REQUEST);
    expect(first.status).toBe(202);
    await ready;
    pauseAuditRun(runs.get(first.json.auditId)!);
    await runEnded(first.json.auditId);
    const paused = await store.getVersion(first.json.auditId, 1);
    expect(paused?.status).toBe('paused');
    expect(paused?.error).toBe(AUDIT_PAUSED);
    expect(await store.readVersionJson(first.json.auditId, 1, AUDIT_CHECKPOINT_NAME)).not.toBeNull();

    ready = new Promise<void>((r) => (started = r));
    const second = await post(`${base}/api/audits`, REQUEST);
    await ready;
    runs.get(second.json.auditId)!.stop();
    await runEnded(second.json.auditId);
    expect((await store.getVersion(second.json.auditId, 1))?.status).toBe('stopped');
  });

  it('on the hosted copy a run whose stream closed pauses', async () => {
    let started!: () => void;
    const ready = new Promise<void>((r) => (started = r));
    const base = await serve(
      createAuditCrawlRoutes(
        deps(
          pausableCrawl(() => started()),
          { pauseWhenUnwatchedMs: 20 }
        )
      )
    );
    const reply = await post(`${base}/api/audits`, REQUEST);
    await ready;

    const tab = new AbortController();
    const stream = await fetch(`${base}/api/audits/${reply.json.auditId}/stream`, { signal: tab.signal });
    expect(stream.status).toBe(200);
    tab.abort();
    await runEnded(reply.json.auditId);
    expect((await store.getVersion(reply.json.auditId, 1))?.status).toBe('paused');
  });
});
