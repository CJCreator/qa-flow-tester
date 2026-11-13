/**
 * T-297: on a beta copy every tester holds the shared access key, so the key alone is not an audit owner in the
 * audit handlers. A key holder who is also a Helper sees only the audits given to them and no Shared Link ids;
 * an AUDIT_OWNER_EMAILS sign-in still sees everything. A copy that is not beta keeps the key as the owner.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import type { AuditRequest } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend } from '../../core/src/audit/store/index.js';
import { createHelperAccess } from '../src/helpers/helper-access.js';
import { HELPER_COOKIE, signHelperSession } from '../src/helpers/helper-session.js';
import { RunnerServer } from '../src/server.js';
import { freePort } from './helpers/free-port.js';

const KEY = 'beta-key-not-owner-0123456789';
const HELPER = 'priya@example.com';
const OWNER = 'owner@example.com';
const REQUEST: AuditRequest = {
  url: 'https://salon.example/',
  limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
  language: 'en',
};

interface Answer {
  status: number;
  body: string;
  json: any;
}

function call(port: number, pathname: string, headers: Record<string, string> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    http
      .request(
        { host: 'localhost', port, path: pathname, method: 'GET', headers: { host: `localhost:${port}`, ...headers } },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            let json: unknown;
            try {
              json = JSON.parse(body);
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode || 0, body, json });
          });
        }
      )
      .on('error', reject)
      .end();
  });
}

let scratch: string;
let beta: RunnerServer;
let local: RunnerServer;
let betaPort = 0;
let localPort = 0;
let auditA: string;
let auditB: string;
let linkId: string;
let helperCookie: string;
let ownerCookie: string;
let savedBucket: string | undefined;

beforeAll(async () => {
  savedBucket = process.env.AUDIT_STORE_BUCKET;
  delete process.env.AUDIT_STORE_BUCKET;
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-beta-key-owner-'));
  const dataDir = path.join(scratch, 'data');
  const store = new AuditStore(new LocalAuditStoreBackend(dataDir));
  const access = createHelperAccess({ projectId: 'proj', accessToken: KEY, store, auditOwnerEmails: [OWNER] });

  auditA = (await store.createAudit(REQUEST)).auditId;
  auditB = (await store.createAudit({ ...REQUEST, url: 'https://gym.example/' })).auditId;
  await store.grantHelper(auditA, HELPER, ['view']);
  linkId = (await store.createShare(auditA, { version: 1, kind: 'pitch', language: 'en' })).id;

  const now = new Date();
  helperCookie = `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), { email: HELPER, sub: 'u1' }, now)}`;
  ownerCookie = `${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), { email: OWNER, sub: 'u2' }, now)}`;

  [betaPort, localPort] = await Promise.all([freePort(), freePort()]);
  beta = new RunnerServer({
    port: betaPort,
    outputDir: path.join(scratch, 'beta-report'),
    dataDir,
    beta: true,
    accessToken: KEY,
    helperAccess: access,
    auditOwnerEmails: [OWNER],
  });
  local = new RunnerServer({
    port: localPort,
    outputDir: path.join(scratch, 'local-report'),
    dataDir: path.join(scratch, 'local-data'),
    accessToken: KEY,
  });
  await beta.start();
  await local.start();
});

afterAll(async () => {
  await beta?.stop();
  await local?.stop();
  if (savedBucket === undefined) delete process.env.AUDIT_STORE_BUCKET;
  else process.env.AUDIT_STORE_BUCKET = savedBucket;
  await fs.rm(scratch, { recursive: true, force: true });
});

describe('T-297: on a beta copy the access key alone is not an audit owner', () => {
  it('key + Helper cookie: GET /api/audits lists only the audit given to the Helper', async () => {
    const res = await call(betaPort, '/api/audits', { 'x-qa-access': KEY, cookie: helperCookie });
    expect(res.status).toBe(200);
    const ids = res.json.audits.map((a: any) => a.auditId);
    expect(ids).toEqual([auditA]);
    expect(res.body).not.toContain(auditB);
  });

  it('key + Helper cookie: GET /api/shortlist shows nothing from the other audit', async () => {
    const res = await call(betaPort, '/api/shortlist', { 'x-qa-access': KEY, cookie: helperCookie });
    expect(res.status).toBe(200);
    expect(res.body).not.toContain(auditB);
  });

  it('key + Helper cookie: the Shared Link list carries no link id', async () => {
    const res = await call(betaPort, `/api/audits/${auditA}/share`, { 'x-qa-access': KEY, cookie: helperCookie });
    expect(res.status).toBe(200);
    expect(res.json.links).toHaveLength(1);
    expect(res.json.links[0]).not.toHaveProperty('id');
    expect(res.body).not.toContain(linkId);
  });

  it('key + Helper cookie: an audit not given to the Helper is refused', async () => {
    const res = await call(betaPort, `/api/audits/${auditB}/share`, { 'x-qa-access': KEY, cookie: helperCookie });
    expect(res.status).not.toBe(200);
    expect(res.body).not.toContain(linkId);
  });

  it('key only: /api/runner/status says auditOwner false', async () => {
    const res = await call(betaPort, '/api/runner/status', { 'x-qa-access': KEY });
    expect(res.status).toBe(200);
    expect(res.json.auditOwner).toBe(false);
  });

  it('owner sign-in, with and without the key: every audit, the link id, auditOwner true', async () => {
    for (const headers of [{ cookie: ownerCookie }, { cookie: ownerCookie, 'x-qa-access': KEY }] as Record<
      string,
      string
    >[]) {
      const list = await call(betaPort, '/api/audits', headers);
      expect(list.status).toBe(200);
      expect(list.json.audits.map((a: any) => a.auditId).sort()).toEqual([auditA, auditB].sort());

      const share = await call(betaPort, `/api/audits/${auditA}/share`, headers);
      expect(share.status).toBe(200);
      expect(share.json.links[0].id).toBe(linkId);

      const status = await call(betaPort, '/api/runner/status', headers);
      expect(status.status).toBe(200);
      expect(status.json.auditOwner).toBe(true);
    }
  });
});

describe('T-297: a copy that is not beta keeps the key as the local owner', () => {
  it('key only: /api/runner/status says auditOwner true', async () => {
    const res = await call(localPort, '/api/runner/status', { 'x-qa-access': KEY });
    expect(res.status).toBe(200);
    expect(res.json.auditOwner).toBe(true);
  });
});
