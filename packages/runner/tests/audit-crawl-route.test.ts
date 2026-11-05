/**
 * BE-205 (REQ-001, REQ-002, REQ-003): POST /api/audits and GET /api/audits/:id/stream. The rows run on a
 * plain http server with a fake crawl, a fake address check, a real RunSlot and a real audit store in a temp
 * folder: no Chromium, no RunnerServer, no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_API, AUDIT_ID_PATTERN, type AuditProgressEvent, type AuditRequest, type AuditResult } from '@qa/types';
import {
  AuditCrawlBlockedError,
  AuditPipelineError,
  AuditStore,
  LocalAuditStoreBackend,
  abortError,
  type AuditAddressResult,
  type AuditCrawlOptions,
  type AuditCrawlResult,
} from '@qa/core';
import {
  AUDIT_CRAWL_FAILED,
  AUDIT_SAVE_FAILED,
  AUDIT_STOPPED,
  auditCrawlRoutes,
  auditPipelineStep,
  createAuditCrawlRoutes,
  type AfterCrawlStep,
  type AuditCrawlRouteDeps,
} from '../src/routes/audit-crawl.js';
import { resolveRoute, type Route } from '../src/routes/route.js';
import { DefaultRunSlot } from '../src/session/run-slot.js';
import { AuditRuns } from '../src/session/audit-run.js';
import type { AuditCaller } from '../src/routes/audit-store.js';

// ---- helpers ----------------------------------------------------------------------------------------

interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function crawlResult(request: AuditRequest, pages = 2, skipped = 1): AuditCrawlResult {
  return {
    startUrl: request.url,
    finalUrl: request.url,
    pages: Array.from({ length: pages }, (_, i) => ({
      url: `${request.url}p${i}`,
      urlPath: `/p${i}`,
      title: `Page ${i}`,
      depth: 1,
      links: [],
    })),
    coverage: { found: pages + skipped, reached: pages, skipped: Array.from({ length: skipped }, () => ({}) as never) },
    leavingSite: [],
    signInWalls: [],
    paymentAreas: [],
    pacer: {} as never,
    crawlDelayMs: null,
  } as unknown as AuditCrawlResult;
}

type CrawlCall = { request: AuditRequest; opts: AuditCrawlOptions };

let dir: string;
let store: AuditStore;
let slot: DefaultRunSlot;
let runs: AuditRuns;
let caller: AuditCaller;
let addressCalls: string[];
let crawlCalls: CrawlCall[];
let address: AuditAddressResult;
let workDirs: string[];
let servers: http.Server[];

/** The crawl the tests drive: reports progress, then waits for `gate` when one is set. */
let gate: Deferred | null;
let crawlImpl: (request: AuditRequest, opts: AuditCrawlOptions) => Promise<AuditCrawlResult>;

function defaultCrawl(request: AuditRequest, opts: AuditCrawlOptions): Promise<AuditCrawlResult> {
  return (async () => {
    opts.onProgress?.({ stage: 'crawling', pagesFound: 1, pagesRecorded: 0, pagesSkipped: 0, currentPath: '/' });
    opts.onProgress?.({
      stage: 'crawling',
      pagesFound: 3,
      pagesRecorded: 1,
      pagesSkipped: 1,
      currentPath: '/account?token=[redacted]',
    });
    if (gate) await gate.promise;
    return crawlResult(request);
  })();
}

function deps(extra: Partial<AuditCrawlRouteDeps> = {}): AuditCrawlRouteDeps {
  return {
    store,
    caller: () => caller,
    slot: () => slot,
    runs,
    checkAddress: async (url) => {
      addressCalls.push(url);
      return address;
    },
    crawl: (request, opts) => {
      crawlCalls.push({ request, opts });
      return crawlImpl(request, opts);
    },
    makeWorkDir: async () => {
      const wd = await fs.mkdtemp(path.join(dir, 'work-'));
      workDirs.push(wd);
      return wd;
    },
    ...extra,
  };
}

async function serve(rows: Route[]): Promise<string> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = resolveRoute(rows, req.method ?? 'GET', url.pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
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

async function post(base: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/api/audits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

/** Opens the stream and collects events until the server ends it (or `stopAfter` events arrived). */
function openStream(
  base: string,
  id: string,
  search = ''
): { status: Promise<number>; events: AuditProgressEvent[]; ended: Promise<void>; next: (n: number) => Promise<void> } {
  const events: AuditProgressEvent[] = [];
  const status = deferred<number>();
  const ended = deferred();
  const waiters: Array<{ n: number; d: Deferred }> = [];
  const check = () => {
    for (const w of [...waiters]) if (events.length >= w.n) w.d.resolve();
  };
  http.get(`${base}/api/audits/${id}/stream${search}`, (res) => {
    status.resolve(res.statusCode ?? 0);
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (frame.startsWith('data: ')) events.push(JSON.parse(frame.slice(6)));
      }
      check();
    });
    res.on('end', () => ended.resolve());
  });
  return {
    status: status.promise,
    events,
    ended: ended.promise,
    next: (n) => {
      const d = deferred();
      waiters.push({ n, d });
      check();
      return d.promise;
    },
  };
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const runEnded = (id: string) => () => runs.get(id)?.finished === true;

function expectErrorReply(json: Record<string, unknown>): void {
  for (const key of Object.keys(json)) expect(['error', 'code', 'fields']).toContain(key);
  expect(typeof json.error).toBe('string');
  expect(JSON.stringify(json)).not.toMatch(/\bat \w|stack|node:|ECONN|10\.0\.0\./);
}

const VALID = { url: 'https://example.com/', maxPages: 5, maxDepth: 1, includePaths: ['/blog'] };

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-crawl-route-'));
  store = new AuditStore(new LocalAuditStoreBackend(path.join(dir, 'store')));
  slot = new DefaultRunSlot();
  runs = new AuditRuns();
  caller = { owner: true };
  addressCalls = [];
  crawlCalls = [];
  address = { ok: true, finalUrl: 'https://example.com/', status: 200 };
  workDirs = [];
  servers = [];
  gate = null;
  crawlImpl = defaultCrawl;
});

afterEach(async () => {
  gate?.resolve();
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ---- the rows ---------------------------------------------------------------------------------------

describe('route rows', () => {
  it('declare AUDIT_API method, path and access, closed in beta', () => {
    for (const rows of [createAuditCrawlRoutes(deps()), auditCrawlRoutes({ ...deps(), store })]) {
      expect(rows).toHaveLength(2);
      const [start, stream] = rows;
      expect([start.method, start.path, start.access]).toEqual([AUDIT_API.start.method, AUDIT_API.start.path, 'owner']);
      expect([stream.method, stream.path, stream.access]).toEqual([
        AUDIT_API.stream.method,
        AUDIT_API.stream.path,
        'view',
      ]);
      expect(start.beta).toBe('closed');
      expect(stream.beta).toBe('closed');
    }
  });
});

// ---- start ------------------------------------------------------------------------------------------

describe('POST /api/audits', () => {
  it('answers 202 with an audit id and version 1, and crawls with the validated limits only', async () => {
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { status, json } = await post(base, {
      ...VALID,
      // None of these may reach the crawl.
      signIn: { user: 'a', password: 'b' },
      roles: ['admin'],
      submitForms: true,
      allowPrivate: true,
    });
    expect(status).toBe(202);
    expect(json.version).toBe(1);
    expect(json.auditId).toMatch(AUDIT_ID_PATTERN);
    expect(Object.keys(json).sort()).toEqual(['auditId', 'version']);

    await waitFor(runEnded(json.auditId));
    expect(addressCalls).toEqual(['https://example.com/']);
    expect(crawlCalls).toHaveLength(1);
    expect(crawlCalls[0].request).toEqual({
      url: 'https://example.com/',
      limits: { maxPages: 5, maxDepth: 1, includePaths: ['/blog'], excludePaths: [] },
      language: 'en',
    });
    expect(crawlCalls[0].opts.signal).toBeInstanceOf(AbortSignal);
    expect(typeof crawlCalls[0].opts.onRenderedPage).toBe('function');

    const v = await store.getVersion(json.auditId, 1);
    expect(v?.status).toBe('done');
    expect(v?.pagesRecorded).toBe(2);
    expect(v?.pagesSkipped).toBe(1);
    expect(slot.kind).toBeNull();
    // The working folder is removed when the run ends.
    expect(workDirs).toHaveLength(1);
    await expect(fs.stat(workDirs[0])).rejects.toThrow();
  });

  it.each([
    ['does not resolve', 'The site name could not be found. Check the address for typos.'],
    ['does not answer', 'The site did not answer in time.'],
    ['answers 404', 'The site answered with error 404.'],
  ])('answers 422 ERR_UNREACHABLE when the address %s, and never crawls', async (_case, reason) => {
    address = { ok: false, code: 'ERR_UNREACHABLE', reason };
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { status, json } = await post(base, VALID);
    expect(status).toBe(422);
    expect(json).toEqual({ error: reason, code: 'ERR_UNREACHABLE' });
    expect(crawlCalls).toHaveLength(0);
    expect(slot.kind).toBeNull();
    expect(await store.listAudits()).toEqual([]);
  });

  it('answers 422 ERR_UNREACHABLE when the address check itself throws, without internals', async () => {
    const base = await serve(
      createAuditCrawlRoutes(
        deps({
          checkAddress: async () => {
            throw new Error('ECONNREFUSED 10.0.0.5:443 at node:net');
          },
        })
      )
    );
    const { status, json } = await post(base, VALID);
    expect(status).toBe(422);
    expect(json.code).toBe('ERR_UNREACHABLE');
    expectErrorReply(json);
    expect(crawlCalls).toHaveLength(0);
  });

  it('answers 400 ERR_INVALID_AUDIT with a message per field; no address check, no crawl', async () => {
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { status, json } = await post(base, { url: 'not a url', maxPages: 0, maxDepth: 500 });
    expect(status).toBe(400);
    expect(json.code).toBe('ERR_INVALID_AUDIT');
    expect(Object.keys(json.fields).sort()).toEqual(['maxDepth', 'maxPages', 'url']);
    for (const message of Object.values(json.fields)) expect(typeof message).toBe('string');
    expectErrorReply(json);
    expect(addressCalls).toHaveLength(0);
    expect(crawlCalls).toHaveLength(0);
    expect(slot.kind).toBeNull();
  });

  it('answers 400 ERR_INVALID_AUDIT for a non-http scheme and 400 ERR_INVALID_REQUEST for a body that is not JSON', async () => {
    const base = await serve(createAuditCrawlRoutes(deps()));
    const ftp = await post(base, { url: 'ftp://example.com/' });
    expect(ftp.status).toBe(400);
    expect(ftp.json.code).toBe('ERR_INVALID_AUDIT');
    expect(ftp.json.fields.url).toBeTruthy();

    const broken = await post(base, '{"url":');
    expect(broken.status).toBe(400);
    expect(broken.json.code).toBe('ERR_INVALID_REQUEST');
    expectErrorReply(broken.json);
    expect(addressCalls).toHaveLength(0);
    expect(crawlCalls).toHaveLength(0);
  });

  it('answers 400 ERR_PRIVATE_ADDRESS for a private or local address, and starts no crawl', async () => {
    address = { ok: false, code: 'ERR_PRIVATE_ADDRESS', reason: 'This address points to a private or local network.' };
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { status, json } = await post(base, { url: 'http://192.168.1.10/' });
    expect(status).toBe(400);
    expect(json.code).toBe('ERR_PRIVATE_ADDRESS');
    expectErrorReply(json);
    expect(crawlCalls).toHaveLength(0);
    expect(slot.kind).toBeNull();
  });

  it('refuses a caller who is not the owner with 403 ERR_FORBIDDEN', async () => {
    caller = { owner: false, helperEmail: 'helper@example.com' };
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { status, json } = await post(base, VALID);
    expect(status).toBe(403);
    expect(json.code).toBe('ERR_FORBIDDEN');
    expect(addressCalls).toHaveLength(0);
  });

  it('answers 500 with a fixed message and releases the slot when the version cannot be created', async () => {
    const failing = {
      createAudit: async () => {
        throw new Error('disk full at /secret/path');
      },
      updateVersion: store.updateVersion.bind(store),
      getResult: store.getResult.bind(store),
      grantsFor: store.grantsFor.bind(store),
    };
    const base = await serve(createAuditCrawlRoutes(deps({ store: failing })));
    const { status, json } = await post(base, VALID);
    expect(status).toBe(500);
    expect(JSON.stringify(json)).not.toMatch(/disk|secret/);
    expect(crawlCalls).toHaveLength(0);
    expect(slot.kind).toBeNull();
  });
});

// ---- the run slot -----------------------------------------------------------------------------------

describe('the run slot', () => {
  it.each([
    ['a Check-up', 'checkup'],
    ['a benchmark', 'benchmark'],
    ['another audit', 'audit'],
  ] as const)('answers 409 ERR_RUN_IN_PROGRESS while %s holds it', async (_label, kind) => {
    expect(slot.begin('other-run', 'https://other.example/', kind)).toBe(true);
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { status, json } = await post(base, VALID);
    expect(status).toBe(409);
    expect(json).toEqual({ error: expect.any(String), code: 'ERR_RUN_IN_PROGRESS' });
    expect(crawlCalls).toHaveLength(0);
    expect(slot.kind).toBe(kind);
  });

  it('holds the slot while the audit runs: a second audit and a Check-up are refused; released when done', async () => {
    gate = deferred();
    const base = await serve(createAuditCrawlRoutes(deps()));
    const first = await post(base, VALID);
    expect(first.status).toBe(202);
    await waitFor(() => crawlCalls.length === 1);
    expect(slot.kind).toBe('audit');

    const second = await post(base, VALID);
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('ERR_RUN_IN_PROGRESS');
    expect(slot.begin('checkup-run', 'http://localhost:4000/', 'checkup')).toBe(false);
    expect(slot.begin('bench-run', 'https://other.example/', 'benchmark')).toBe(false);

    gate.resolve();
    await waitFor(runEnded(first.json.auditId));
    expect(slot.kind).toBeNull();
    // A Check-up on a local Test Copy address is accepted again once the audit is over.
    expect(slot.begin('checkup-run', 'http://localhost:4000/', 'checkup')).toBe(true);
  });

  it('refuses the audit when a Check-up claims the slot while the address check is in flight', async () => {
    const checking = deferred<AuditAddressResult>();
    const asked = deferred();
    const base = await serve(
      createAuditCrawlRoutes(
        deps({
          checkAddress: () => {
            asked.resolve();
            return checking.promise;
          },
        })
      )
    );
    const pending = post(base, VALID);
    await asked.promise;
    expect(slot.begin('checkup-run', 'http://localhost:4000/', 'checkup')).toBe(true);
    checking.resolve({ ok: true, finalUrl: VALID.url, status: 200 });
    const { status, json } = await pending;
    expect(status).toBe(409);
    expect(json.code).toBe('ERR_RUN_IN_PROGRESS');
    expect(slot.kind).toBe('checkup');
    expect(await store.listAudits()).toEqual([]);
  });
});

// ---- outcomes ---------------------------------------------------------------------------------------

describe('run outcomes', () => {
  it('a crawl error marks the version failed with fixed wording and releases the slot', async () => {
    crawlImpl = async () => {
      throw new Error('page.goto: net::ERR_CONNECTION_RESET at 10.0.0.9 <html>secret page text</html>');
    };
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { json } = await post(base, VALID);
    await waitFor(runEnded(json.auditId));

    const last = runs.get(json.auditId)!.lastEvent;
    expect(last).toEqual({
      type: 'failed',
      auditId: json.auditId,
      version: 1,
      error: AUDIT_CRAWL_FAILED,
      code: 'ERR_UNREACHABLE',
    });
    const v = await store.getVersion(json.auditId, 1);
    expect(v?.status).toBe('failed');
    expect(v?.error).toBe(AUDIT_CRAWL_FAILED);
    expect(slot.kind).toBeNull();
    await expect(fs.stat(workDirs[0])).rejects.toThrow();
  });

  it('a start page that is a tunnel warning fails the version with its own sentence, which the wizard shows as-is', async () => {
    crawlImpl = async () => {
      throw new AuditCrawlBlockedError('tunnel-warning');
    };
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { json } = await post(base, VALID);
    await waitFor(runEnded(json.auditId));

    const expected = new AuditCrawlBlockedError('tunnel-warning').message;
    expect(runs.get(json.auditId)!.lastEvent).toEqual({
      type: 'failed',
      auditId: json.auditId,
      version: 1,
      error: expected,
      // No wizard sentence for this code, so the wizard shows `error` (audit-start-api.ts auditErrorText).
      code: 'ERR_INVALID_REQUEST',
    });
    const v = await store.getVersion(json.auditId, 1);
    expect(v?.status).toBe('failed');
    expect(v?.error).toBe(expected);
    expect(slot.kind).toBeNull();
  });

  it("a 'save-failed' pipeline error marks the version failed", async () => {
    const afterCrawl: AfterCrawlStep = async () => {
      throw new AuditPipelineError('save-failed');
    };
    const base = await serve(createAuditCrawlRoutes(deps({ afterCrawl })));
    const { json } = await post(base, VALID);
    await waitFor(runEnded(json.auditId));
    const last = runs.get(json.auditId)!.lastEvent;
    expect(last.type).toBe('failed');
    expect(last.type === 'failed' && last.error).toBe(AUDIT_SAVE_FAILED);
    expect((await store.getVersion(json.auditId, 1))?.status).toBe('failed');
    expect(slot.kind).toBeNull();
  });

  it("a 'status-not-updated' pipeline error is not a failure: the status is set to done from the stored result", async () => {
    const afterCrawl: AfterCrawlStep = async ({ auditId, version, request }) => {
      const result = {
        auditId,
        version,
        url: request.url,
        finishedAt: '2026-11-03T10:00:00.000Z',
        pages: [{}, {}, {}],
        coverage: { found: 4, reached: 3, skipped: [{}] },
        findings: [{}, {}],
      } as unknown as AuditResult;
      await store.saveResult(auditId, version, result);
      throw new AuditPipelineError('status-not-updated');
    };
    const base = await serve(createAuditCrawlRoutes(deps({ afterCrawl })));
    const { json } = await post(base, VALID);
    await waitFor(runEnded(json.auditId));
    expect(runs.get(json.auditId)!.lastEvent).toEqual({ type: 'done', auditId: json.auditId, version: 1 });
    const v = await store.getVersion(json.auditId, 1);
    expect(v?.status).toBe('done');
    expect(v?.findings).toBe(2);
    expect(v?.pagesRecorded).toBe(3);
    expect(slot.kind).toBeNull();
  });

  it('a stop marks the version stopped (not failed, not done) and releases the slot', async () => {
    crawlImpl = (_request, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(abortError()));
      });
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { json } = await post(base, VALID);
    await waitFor(() => crawlCalls.length === 1);
    runs.get(json.auditId)!.stop();
    await waitFor(runEnded(json.auditId));
    const last = runs.get(json.auditId)!.lastEvent;
    expect(last.type === 'failed' && last.error).toBe(AUDIT_STOPPED);
    expect((await store.getVersion(json.auditId, 1))?.status).toBe('stopped');
    expect(slot.kind).toBeNull();
  });

  it('the pipeline step gets the crawl, recorder and work folder, no pacer, and no AI when the AI setup fails', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const step = auditPipelineStep({
      store,
      resolveAi: async () => {
        throw new Error('key file unreadable');
      },
      pipeline: async (crawl, d) => {
        seen.push({
          pages: crawl.pages.length,
          ai: d.ai,
          workDir: d.workDir,
          hasPacer: 'pacer' in d,
          recorder: !!d.recorder,
        });
        await store.updateVersion(d.auditId, d.version, { status: 'done', finishedAt: '2026-11-03T10:00:00.000Z' });
        return {} as never;
      },
    });
    const base = await serve(createAuditCrawlRoutes(deps({ afterCrawl: step })));
    const { json } = await post(base, VALID);
    await waitFor(runEnded(json.auditId));
    expect(seen).toEqual([
      { pages: 2, ai: { ok: false, reason: 'no-ai-key' }, workDir: workDirs[0], hasPacer: false, recorder: true },
    ]);
    expect(runs.get(json.auditId)!.lastEvent.type).toBe('done');
  });
});

// ---- stream -----------------------------------------------------------------------------------------

describe('GET /api/audits/:id/stream', () => {
  it('sends progress with stage, counts and a redacted path, then done', async () => {
    gate = deferred();
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { json } = await post(base, VALID);
    await waitFor(() => runs.get(json.auditId)?.lastEvent.type === 'progress' && crawlCalls.length === 1);
    await waitFor(() => (runs.get(json.auditId)!.lastEvent as { pagesFound: number }).pagesFound === 3);

    const stream = openStream(base, json.auditId);
    expect(await stream.status).toBe(200);
    await stream.next(1);
    // A subscriber that comes late first gets the last event.
    expect(stream.events[0]).toEqual({
      type: 'progress',
      auditId: json.auditId,
      version: 1,
      stage: 'crawling',
      pagesFound: 3,
      pagesRecorded: 1,
      pagesSkipped: 1,
      currentPath: '/account?token=[redacted]',
    });
    gate.resolve();
    await stream.ended;
    expect(stream.events.at(-1)).toEqual({ type: 'done', auditId: json.auditId, version: 1 });
  });

  it('streams every event from the start to a subscriber that is there from the beginning', async () => {
    const started = deferred();
    const go = deferred();
    crawlImpl = async (request, opts) => {
      started.resolve();
      await go.promise;
      return defaultCrawl(request, opts);
    };
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { json } = await post(base, VALID);
    await started.promise;
    const stream = openStream(base, json.auditId);
    await stream.next(1);
    expect(stream.events[0]).toMatchObject({ type: 'progress', stage: 'checking-address', pagesFound: 0 });
    go.resolve();
    await stream.ended;
    expect(stream.events.map((e) => (e.type === 'progress' ? e.stage : e.type))).toEqual([
      'checking-address',
      'crawling',
      'crawling',
      'done',
    ]);
    expect(stream.events[1]).toMatchObject({ pagesFound: 1, currentPath: '/' });
  });

  it('gives a subscriber after the end the final event and closes', async () => {
    crawlImpl = async () => {
      throw new Error('boom');
    };
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { json } = await post(base, VALID);
    await waitFor(runEnded(json.auditId));
    const stream = openStream(base, json.auditId);
    await stream.ended;
    expect(stream.events).toEqual([
      { type: 'failed', auditId: json.auditId, version: 1, error: AUDIT_CRAWL_FAILED, code: 'ERR_UNREACHABLE' },
    ]);
  });

  it('answers 404 ERR_AUDIT_NOT_FOUND for an unknown id, a bad id, another version and a Helper without a grant', async () => {
    const rows = createAuditCrawlRoutes(deps());
    const base = await serve(rows);
    const { json } = await post(base, VALID);
    await waitFor(runEnded(json.auditId));

    const unknown = await fetch(`${base}/api/audits/AAAAAAAAAAAAAAAAAAAAAA/stream`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: expect.any(String), code: 'ERR_AUDIT_NOT_FOUND' });

    const otherVersion = await fetch(`${base}/api/audits/${json.auditId}/stream?version=2`);
    expect(otherVersion.status).toBe(404);

    const badVersion = await fetch(`${base}/api/audits/${json.auditId}/stream?version=x`);
    expect(badVersion.status).toBe(400);
    expect((await badVersion.json()).code).toBe('ERR_INVALID_REQUEST');

    // A bad id never matches the row; the handler refuses it too if it is ever reached.
    const stream = rows[1];
    let status = 0;
    let body = '';
    await stream.handle({
      server: undefined as never,
      req: { on: () => undefined } as never,
      res: {
        writeHead: (s: number) => (status = s),
        end: (chunk?: string) => (body += chunk ?? ''),
      } as never,
      url: new URL('http://localhost/api/audits/bad!/stream'),
      params: { id: 'bad!' },
    });
    expect(status).toBe(404);
    expect(JSON.parse(body).code).toBe('ERR_AUDIT_NOT_FOUND');

    caller = { owner: false, helperEmail: 'helper@example.com' };
    const helper = await fetch(`${base}/api/audits/${json.auditId}/stream`);
    expect(helper.status).toBe(404);
  });

  it('serves a Helper holding the view grant on the audit', async () => {
    const base = await serve(createAuditCrawlRoutes(deps()));
    const { json } = await post(base, VALID);
    await waitFor(runEnded(json.auditId));
    await store.grantHelper(json.auditId, 'helper@example.com', ['view']);
    caller = { owner: false, helperEmail: 'helper@example.com' };
    const stream = openStream(base, json.auditId);
    expect(await stream.status).toBe(200);
    await stream.ended;
    expect(stream.events.at(-1)?.type).toBe('done');
  });
});
