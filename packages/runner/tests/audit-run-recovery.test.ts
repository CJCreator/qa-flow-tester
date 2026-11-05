/**
 * Tests for T-85: Runner recovery, specific error logging, out-of-memory stream response, and busy slot reporting.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { AUDIT_API, type AuditRequest, type AuditProgressEvent } from '@qa/types';
import { createAuditStore, createLocalAuditStoreBackend, type AuditStore } from '@qa/core';
import { DefaultRunSlot } from '../src/session/run-slot.js';
import { AuditRuns } from '../src/session/audit-run.js';
import { createAuditCrawlRoutes, getRunningInfo, AUDIT_STOPPED } from '../src/routes/audit-crawl.js';
import { resolveRoute, type Route } from '../src/routes/index.js';
import { RunnerServer, recoverRunningAudits } from '../src/server.js';
import { logAuditFailure, formatAuditFailureLog } from '../src/audit-log.js';

const VALID_REQUEST: AuditRequest = {
  url: 'https://example.com/',
  limits: { maxPages: 5, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};

describe('recoverRunningAudits (T-85 startup recovery)', () => {
  let dir: string;
  let store: AuditStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-recovery-test-'));
    store = createAuditStore(createLocalAuditStoreBackend(dir));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('handles an empty store without throwing and returns 0', async () => {
    const recovered = await recoverRunningAudits(store);
    expect(recovered).toBe(0);
  });

  it('recovers versions left in running status to stopped with tool-restarted', async () => {
    const clock = () => new Date('2026-11-05T12:00:00.000Z');

    // Audit 1: version 1 running
    const a1 = await store.createAudit(VALID_REQUEST);
    await store.updateVersion(a1.auditId, 1, { status: 'running' });

    // Audit 2: version 1 done, version 2 running
    const a2 = await store.createAudit(VALID_REQUEST);
    await store.updateVersion(a2.auditId, 1, {
      status: 'done',
      finishedAt: '2026-11-05T10:00:00.000Z',
      pagesRecorded: 3,
      pagesSkipped: 0,
      findings: 1,
    });
    const v2 = await store.addVersion(a2.auditId);
    await store.updateVersion(a2.auditId, v2.version, { status: 'running' });

    // Audit 3: version 1 failed
    const a3 = await store.createAudit(VALID_REQUEST);
    await store.updateVersion(a3.auditId, 1, {
      status: 'failed',
      finishedAt: '2026-11-05T09:00:00.000Z',
      error: 'Previous failure',
    });

    const count = await recoverRunningAudits(store, clock);
    expect(count).toBe(2);

    // Verify Audit 1 version 1
    const a1v1 = await store.getVersion(a1.auditId, 1);
    expect(a1v1?.status).toBe('stopped');
    expect(a1v1?.stoppedReason).toBe('tool-restarted');
    expect(a1v1?.finishedAt).toBe('2026-11-05T12:00:00.000Z');
    expect(a1v1?.error).toContain('restarted');

    // Verify Audit 2 version 1 (done, unchanged)
    const a2v1 = await store.getVersion(a2.auditId, 1);
    expect(a2v1?.status).toBe('done');
    expect(a2v1?.stoppedReason).toBeUndefined();

    // Verify Audit 2 version 2 (recovered)
    const a2v2 = await store.getVersion(a2.auditId, v2.version);
    expect(a2v2?.status).toBe('stopped');
    expect(a2v2?.stoppedReason).toBe('tool-restarted');
    expect(a2v2?.finishedAt).toBe('2026-11-05T12:00:00.000Z');

    // Verify Audit 3 version 1 (failed, unchanged)
    const a3v1 = await store.getVersion(a3.auditId, 1);
    expect(a3v1?.status).toBe('failed');
    expect(a3v1?.error).toBe('Previous failure');

    // Idempotency: second run recovers 0
    const count2 = await recoverRunningAudits(store, clock);
    expect(count2).toBe(0);
  });
});

describe('RunnerServer startup recovery wiring (T-85)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-server-recovery-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('automatically recovers running audits on server instantiation', async () => {
    const dataDir = path.join(dir, 'data');
    const store = createAuditStore(createLocalAuditStoreBackend(dataDir));
    const created = await store.createAudit(VALID_REQUEST);
    await store.updateVersion(created.auditId, 1, { status: 'running' });

    const server = new RunnerServer({
      port: 0,
      host: '127.0.0.1',
      outputDir: path.join(dir, 'report'),
      dataDir,
      beta: false,
    });

    const recoveredCount = await server.auditRecoveryDone;
    expect(recoveredCount).toBe(1);

    const version = await store.getVersion(created.auditId, 1);
    expect(version?.status).toBe('stopped');
    expect(version?.stoppedReason).toBe('tool-restarted');
  });
});

describe('Out-of-memory stream connection fallback (T-85)', () => {
  let dir: string;
  let store: AuditStore;
  let server: http.Server;
  let baseUrl: string;
  let routes: Route[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-stream-fallback-'));
    store = createAuditStore(createLocalAuditStoreBackend(dir));
    const slot = new DefaultRunSlot();
    const runs = new AuditRuns();

    routes = createAuditCrawlRoutes({
      store,
      slot: () => slot,
      runs,
      caller: async () => ({ owner: true, helper: null }),
    });

    server = http.createServer(async (req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
      const resolved = resolveRoute(routes, req.method ?? 'GET', parsed.pathname);
      if (!resolved) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      Promise.resolve(
        resolved.route.handle({
          req,
          res,
          url: parsed,
          params: resolved.params,
          server: { session: { run: slot } } as never,
        })
      ).catch(() => {
        res.writeHead(500).end();
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  function readSse(urlPath: string): Promise<{ status: number; events: AuditProgressEvent[] }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlPath, baseUrl);
      const req = http.request(
        {
          hostname: parsed.hostname,
          port: parsed.port,
          path: parsed.pathname + parsed.search,
          method: 'GET',
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return resolve({ status: res.statusCode ?? 0, events: [] });
          }
          const events: AuditProgressEvent[] = [];
          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8');
            const lines = buffer.split('\n\n');
            buffer = lines.pop() ?? '';
            for (const block of lines) {
              const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
              if (dataLine) {
                try {
                  events.push(JSON.parse(dataLine.slice(6)));
                } catch {}
              }
            }
          });
          res.on('end', () => {
            resolve({ status: 200, events });
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('streams terminal failure event for stored stopped run when not in memory', async () => {
    const created = await store.createAudit(VALID_REQUEST);
    await store.updateVersion(created.auditId, 1, {
      status: 'stopped',
      stoppedReason: 'tool-restarted',
      finishedAt: '2026-11-05T12:00:00.000Z',
    });

    const streamPath = AUDIT_API.stream.path.replace(':id', created.auditId);
    const { status, events } = await readSse(streamPath);
    expect(status).toBe(200);
    expect(events).toEqual([
      {
        type: 'failed',
        auditId: created.auditId,
        version: 1,
        error: AUDIT_STOPPED,
        code: 'ERR_INVALID_REQUEST',
      },
    ]);
  });

  it('streams done event for stored completed run when not in memory', async () => {
    const created = await store.createAudit(VALID_REQUEST);
    await store.updateVersion(created.auditId, 1, {
      status: 'done',
      finishedAt: '2026-11-05T12:00:00.000Z',
      pagesRecorded: 4,
      pagesSkipped: 1,
      findings: 2,
    });

    const streamPath = AUDIT_API.stream.path.replace(':id', created.auditId);
    const { status, events } = await readSse(streamPath);
    expect(status).toBe(200);
    expect(events).toEqual([
      {
        type: 'done',
        auditId: created.auditId,
        version: 1,
      },
    ]);
  });

  it('returns 404 for audit not found in memory or store', async () => {
    const streamPath = AUDIT_API.stream.path.replace(':id', 'nonexistent-audit');
    const { status } = await readSse(streamPath);
    expect(status).toBe(404);
  });
});

describe('logAuditFailure (T-85 structured JSON logging)', () => {
  it('formats structured log with redacted URL', () => {
    const line = formatAuditFailureLog({
      code: 'ERR_DNS',
      stage: 'checking-address',
      message: 'The website could not be found.',
      url: 'https://secret.example.com:8080/path?token=topsecret#section',
    });

    expect(line).toContain('[Website Audit]');
    const jsonPart = line.replace(/^\[Website Audit\]\s+/, '').trim();
    const parsed = JSON.parse(jsonPart);
    expect(parsed).toEqual({
      code: 'ERR_DNS',
      stage: 'checking-address',
      message: 'The website could not be found.',
      url: 'https://secret.example.com:8080/path?token=***#section',
    });
    expect(line).not.toContain('topsecret');
  });

  it('writes to process.stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      logAuditFailure({
        code: 'ERR_SITE_BLOCKED',
        stage: 'crawling',
        message: 'Tunnel warning',
        url: 'https://example.com/',
      });
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      const callArg = String(stderrSpy.mock.calls[0][0]);
      expect(callArg).toContain('[Website Audit]');
      expect(callArg).toContain('"code":"ERR_SITE_BLOCKED"');
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

describe('Busy slot & getRunningInfo (T-85)', () => {
  it('reports null when slot is idle', () => {
    const slot = new DefaultRunSlot();
    expect(slot.running).toBeNull();
  });

  it('reports kind checkup and href /check when checkup is running', () => {
    const slot = new DefaultRunSlot();
    slot.begin('chk-1', 'https://example.com/', 'checkup');
    expect(slot.running).toEqual({
      kind: 'checkup',
      href: '/check',
    });
    expect(getRunningInfo(slot)).toEqual({
      kind: 'checkup',
      href: '/check',
    });
  });

  it('reports kind checkup and href /check when benchmark is running', () => {
    const slot = new DefaultRunSlot();
    slot.begin('bm-1', 'https://example.com/', 'benchmark');
    expect(slot.running).toEqual({
      kind: 'checkup',
      href: '/check',
    });
    expect(getRunningInfo(slot)).toEqual({
      kind: 'checkup',
      href: '/check',
    });
  });

  it('reports kind audit and href /audits/:id when audit is running in slot', () => {
    const slot = new DefaultRunSlot();
    slot.begin('audit-12345', 'https://example.com/', 'audit');
    expect(slot.running).toEqual({
      kind: 'audit',
      href: '/audits/audit-12345',
    });
    expect(getRunningInfo(slot)).toEqual({
      kind: 'audit',
      href: '/audits/audit-12345',
    });
  });

  it('uses active auditId from AuditRuns if available in getRunningInfo', () => {
    const slot = new DefaultRunSlot();
    slot.begin('temp-id', 'https://example.com/', 'audit');
    const runs = new AuditRuns();
    runs.start('real-audit-id', 1);

    expect(getRunningInfo(slot, runs)).toEqual({
      kind: 'audit',
      href: '/audits/real-audit-id',
    });
  });
});
