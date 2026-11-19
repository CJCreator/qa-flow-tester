/**
 * T-395 follow-up: an audit owner starting a Website Audit on a hosted copy for https://host:8443 gets that
 * port opened in the egress proxy once the start checks pass. Every other port stays refused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { getBrowserPolicy } from '@qa/core';
import { AuditStore, LocalAuditStoreBackend } from '../../core/src/audit/store/index.js';
import { createHelperAccess } from '../src/helpers/helper-access.js';
import { HELPER_COOKIE, signHelperSession } from '../src/helpers/helper-session.js';
import { RunnerServer } from '../src/server.js';
import { freePort } from './helpers/free-port.js';

const KEY = 'access-key-egress-audit';
const OWNER = 'owner@example.com';

function startAudit(port: number, cookie: string, url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ url, maxPages: 5, maxDepth: 1, language: 'en' });
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: '/api/audits',
        method: 'POST',
        headers: {
          host: `localhost:${port}`,
          'x-qa-access': KEY,
          cookie,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function sendConnect(proxyUrl: string, target: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: Number(new URL(proxyUrl).port),
      method: 'CONNECT',
      path: target,
      agent: false,
    });
    req.on('connect', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

let scratch: string;
let server: RunnerServer;
let port = 0;
let cookie = '';
let sink: net.Server;
let savedBucket: string | undefined;

beforeAll(async () => {
  savedBucket = process.env.AUDIT_STORE_BUCKET;
  delete process.env.AUDIT_STORE_BUCKET;
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-egress-audit-'));
  const dataDir = path.join(scratch, 'data');
  const store = new AuditStore(new LocalAuditStoreBackend(dataDir));
  const access = createHelperAccess({ projectId: 'proj', accessToken: KEY, store, auditOwnerEmails: [OWNER] });
  cookie = `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), { email: OWNER, sub: 'u2' }, new Date())}`;

  sink = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', () => resolve()));
  const sinkPort = (sink.address() as net.AddressInfo).port;

  port = await freePort();
  server = new RunnerServer({
    port,
    outputDir: path.join(scratch, 'report'),
    dataDir,
    beta: true,
    accessToken: KEY,
    helperAccess: access,
    auditOwnerEmails: [OWNER],
    hostChecks: { lookup: async () => ['93.184.216.34'], connect: async () => Promise.reject(new Error('no')) },
    egressConnect: () => net.connect(sinkPort, '127.0.0.1'),
    auditCheckAddress: async (url) => ({ ok: true, finalUrl: url, status: 200 }),
    auditCrawl: async () => {
      throw new Error('no crawl in this test');
    },
  });
  await server.start();
});

afterAll(async () => {
  await server?.stop();
  await new Promise<void>((resolve) => sink.close(() => resolve()));
  if (savedBucket === undefined) delete process.env.AUDIT_STORE_BUCKET;
  else process.env.AUDIT_STORE_BUCKET = savedBucket;
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('egress proxy and a Website Audit on an explicit port (beta, audit owner)', () => {
  it('opens the start address port after the start checks, and still refuses port 22', async () => {
    const proxy = getBrowserPolicy()?.proxy;
    expect(proxy).toBeTruthy();
    expect(await sendConnect(proxy!, 'routed.test:8443')).toBe(403);

    expect(await startAudit(port, cookie, 'https://routed.test:8443/')).toBeLessThan(300);

    expect(await sendConnect(proxy!, 'routed.test:8443')).toBe(200);
    expect(await sendConnect(proxy!, 'routed.test:22')).toBe(403);
  });
});
