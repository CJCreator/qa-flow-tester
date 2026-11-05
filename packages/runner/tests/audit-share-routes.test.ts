/**
 * REQ-024 / REQ-023 (BE-604): Shared Link rows and the public page /s/:linkId (ADR 0036, D-004, F-009).
 * A real local audit store in a temp folder with an injected clock, and a bare http server that dispatches
 * through resolveRoute, so path rules and handlers run as in the runner.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { AUDIT_API, SHARE_LINK_DAYS, type AuditRequest, type AuditResult, type ShareLinkReply } from '@qa/types';
import { createAuditStore, createLocalAuditStoreBackend, pageContentName, type AuditStore } from '@qa/core';
import { authorizeRoute, resolveRoute, type Route } from '../src/routes/index.js';
import {
  auditShareRoutes,
  NO_PREVIEW_MESSAGE,
  SHARED_GONE_PAGE,
  SHARED_NOT_FOUND_PAGE,
  withRobotsMeta,
} from '../src/routes/audit-share.js';
import type { AuditCaller } from '../src/routes/audit-store.js';
import { createHash } from 'crypto';
import { auditDocContents, auditDocResult } from '../../core/tests/helpers/audit-doc-fixture.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.parse('2026-11-03T10:00:00.000Z');
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64'
);

/** The site owner's contact details, planted in the marketing signals; none may reach a Shared Link page. */
const OWNER = {
  name: 'Kavitha Ramalingam',
  address: '42 Usman Road, T Nagar, Chennai 600017',
  phone: '+91 98400 12345',
  email: 'kavitha.owner@shop-example.in',
};

/** ADR 0018 words and release verdict wording a shared page must never show. */
const CLAIM_WORDS = /\b(compliant|certified|secure|fully accessible|passes WCAG)\b/i;
const VERDICT_WORDS = /\b(release verdict|ready to release|not ready|ready for release|verdict)\b/i;

let dir: string;
let clock = START;
let store: AuditStore;
let caller: AuditCaller = { owner: true };
let routes: Route[];
let server: http.Server;
let port: number;

const REQUEST: AuditRequest = {
  url: 'https://shop.example.in/',
  limits: { maxPages: 20, maxDepth: 3, includePaths: [], excludePaths: [] },
  language: 'en',
} as unknown as AuditRequest;

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: any;
}

function call(method: string, rawPath: string, body?: unknown): Promise<Answer> {
  return new Promise((resolve, reject) => {
    // No access key and no cookie of any kind on any request.
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers: {} }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

/** The fixture result with the owner's contact details in its marketing signals. */
function resultWithOwnerContacts(auditId: string, version: number): AuditResult {
  const result = { ...auditDocResult(), auditId, version };
  result.findings[0].screenshotPath = 'screenshots/af-001.png';
  result.marketing!.signals.push({
    key: 'contact',
    label: 'Contact details',
    status: 'found',
    pages: ['/'],
    detail: `Write to ${OWNER.email} or call ${OWNER.phone}.`,
    nap: [{ urlPath: '/', name: OWNER.name, address: OWNER.address, phone: OWNER.phone }],
  } as never);
  return result;
}

/** A finished version 1 with the fixture's result, Page Content and one screenshot. */
async function seedDone(): Promise<string> {
  const v = await store.createAudit(REQUEST);
  await store.saveResult(v.auditId, v.version, resultWithOwnerContacts(v.auditId, v.version));
  for (const content of auditDocContents()) {
    await store.writeVersionJson(v.auditId, v.version, pageContentName(content.urlPath), content);
  }
  await store.putVersionFile(v.auditId, v.version, 'screenshots/af-001.png', new Uint8Array(PNG_BYTES));
  await store.updateVersion(v.auditId, v.version, { status: 'done' });
  return v.auditId;
}

const sharePath = (id: string) => `/api/audits/${id}/share`;

async function share(id: string, body: unknown = { kind: 'pitch', language: 'en', version: 1 }) {
  const res = await call('POST', sharePath(id), body);
  expect(res.status).toBe(201);
  return (res.json as ShareLinkReply).link;
}

/** The visible text of an HTML page, tags removed. */
function visibleText(html: string): string {
  const at = html.search(/<body[\s>]/i);
  return (at >= 0 ? html.slice(at) : html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function expectSharedPageHeaders(res: Answer): void {
  expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(res.headers['referrer-policy']).toBe('no-referrer');
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
  expect(res.headers['set-cookie']).toBeUndefined();
  const csp = String(res.headers['content-security-policy']);
  const directives = new Map(
    csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values.join(' ')] as const;
    })
  );
  expect(directives.get('default-src')).toBe("'none'");
  expect(directives.get('img-src')).toBe('data:');
  // DEC-008: styles only by the sha256 of the page's own <style> elements, never 'unsafe-inline'.
  expect(csp).not.toContain('unsafe-inline');
  const styles = [...res.text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const styleSrc = directives.get('style-src') ?? '';
  for (const css of styles) {
    expect(styleSrc).toContain(`'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`);
  }
  expect(directives.get('form-action')).toBe("'none'");
  expect(directives.get('frame-ancestors')).toBe("'none'");
  expect(directives.get('base-uri')).toBe("'none'");
  // Nothing loosens script, connections, fonts or frames: they all fall back to default-src 'none'.
  for (const name of [
    'script-src',
    'script-src-elem',
    'connect-src',
    'font-src',
    'frame-src',
    'object-src',
    'media-src',
  ]) {
    expect(directives.has(name)).toBe(false);
  }
  expect(res.text).toMatch(/<meta name="robots" content="noindex, nofollow">/);
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-share-'));
  store = createAuditStore(createLocalAuditStoreBackend(dir), { now: () => new Date(clock) });
  routes = auditShareRoutes({ store, optOutText: async () => ({}), caller: () => caller });
  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const match = resolveRoute(routes, req.method || 'GET', url.pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"Not found"}');
      return;
    }
    // Stands in for a layer before the row (the beta session) that prepares a cookie on every reply.
    res.setHeader('Set-Cookie', 'qa_session=from-an-earlier-layer; Path=/');
    void match.route.handle({ server: undefined as never, req, res, url, params: match.params });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Shared Link rows (D-004, REQ-048)', () => {
  it('each row has the method, path and access of its AUDIT_API entry', () => {
    for (const name of ['listShares', 'createShare', 'revokeShare', 'sharedPage'] as const) {
      const entry = AUDIT_API[name];
      const row = routes.find((r) => r.path === entry.path && r.method === entry.method);
      expect(row, name).toBeDefined();
      expect(row!.access, name).toBe(entry.access);
    }
    expect(AUDIT_API.listShares.access).toBe('view');
    expect(AUDIT_API.createShare.access).toBe('owner');
    expect(AUDIT_API.revokeShare.access).toBe('owner');
    expect(AUDIT_API.sharedPage.access).toBe('public');
  });

  it('only the /s/ rows are public and served on a beta copy; the others need the access key', () => {
    for (const row of routes) {
      const isShared = typeof row.path === 'string' && (row.path === '/s' || row.path.startsWith('/s/'));
      expect(row.access === 'public', String(row.path)).toBe(isShared);
      expect(row.beta === 'allow', String(row.path)).toBe(isShared);
      const visitor = authorizeRoute(row, { hasAccessKey: false, beta: true });
      expect(visitor.allow, String(row.path)).toBe(isShared);
    }
  });
});

describe('POST /api/audits/:id/share', () => {
  it('creates a pitch link through the store and returns ShareLinkReply', async () => {
    const id = await seedDone();
    const link = await share(id, { kind: 'pitch', language: 'ta', version: 1 });
    expect(link).toMatchObject({ auditId: id, version: 1, kind: 'pitch', language: 'ta', revokedAt: null });
    expect(link.id).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(Date.parse(link.expiresAt) - Date.parse(link.createdAt)).toBe(SHARE_LINK_DAYS * DAY_MS);

    const listed = await call('GET', sharePath(id));
    expect(listed.status).toBe(200);
    expect(listed.json.links).toEqual([link]);
  });

  it('defaults to the latest version and its language', async () => {
    const id = await seedDone();
    const link = await share(id, { kind: 'pitch' });
    expect(link).toMatchObject({ version: 1, language: 'en' });
  });

  it('answers 400 ERR_INVALID_REQUEST with a fixed message for a preview link when the version has no stored preview', async () => {
    const id = await seedDone();
    const res = await call('POST', sharePath(id), { kind: 'preview', language: 'en', version: 1 });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: NO_PREVIEW_MESSAGE, code: 'ERR_INVALID_REQUEST' });
    expect((await call('GET', sharePath(id))).json.links).toEqual([]);
  });

  it('answers 404 ERR_AUDIT_NOT_FOUND for a pitch link when the version has no finished result', async () => {
    const v = await store.createAudit(REQUEST);
    await store.updateVersion(v.auditId, v.version, { status: 'failed' });
    const res = await call('POST', sharePath(v.auditId), { kind: 'pitch', version: 1 });
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('ERR_AUDIT_NOT_FOUND');
    expect((await call('GET', sharePath(v.auditId))).json.links).toEqual([]);
  });

  it('serves the stored preview.html of that version for a preview link', async () => {
    const id = await seedDone();
    const preview =
      '<!DOCTYPE html><html><head><title>Better homepage</title></head><body><h1>Better homepage</h1></body></html>';
    await store.putVersionFile(id, 1, 'preview.html', new TextEncoder().encode(preview));
    const link = await share(id, { kind: 'preview', language: 'en', version: 1 });
    expect(link.kind).toBe('preview');

    const page = await call('GET', `/s/${link.id}`);
    expect(page.status).toBe(200);
    expect(page.text).toBe(withRobotsMeta(preview));
    expectSharedPageHeaders(page);
  });

  it('answers 404 ERR_AUDIT_NOT_FOUND for an unknown audit or version', async () => {
    const unknown = await call('POST', sharePath('unknown-audit-1'), { kind: 'pitch' });
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe('ERR_AUDIT_NOT_FOUND');

    const id = await seedDone();
    const noVersion = await call('POST', sharePath(id), { kind: 'pitch', version: 7 });
    expect(noVersion.status).toBe(404);
    expect(noVersion.json.code).toBe('ERR_AUDIT_NOT_FOUND');
  });

  it('refuses a bad body with 400 ERR_INVALID_REQUEST', async () => {
    const id = await seedDone();
    for (const body of [
      'not json',
      [],
      { kind: 'report' },
      { kind: 'pitch', language: 'zz' },
      { kind: 'pitch', version: 0 },
      { kind: 'pitch', version: 1.5 },
    ]) {
      const res = await call('POST', sharePath(id), body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.json.code).toBe('ERR_INVALID_REQUEST');
    }
    expect((await call('GET', sharePath(id))).json.links).toEqual([]);
  });

  it('answers 409 ERR_AUDIT_RUNNING while the version is still running', async () => {
    const v = await store.createAudit(REQUEST);
    const res = await call('POST', sharePath(v.auditId), { kind: 'pitch' });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe('ERR_AUDIT_RUNNING');
  });
});

describe('GET /s/:linkId', () => {
  it('is served with no access key and no cookie, sets no cookie, and carries the noindex and CSP headers', async () => {
    const id = await seedDone();
    const link = await share(id);
    const page = await call('GET', `/s/${link.id}`);
    expect(page.status).toBe(200);
    expectSharedPageHeaders(page);
    expect(page.text).toMatch(/<style[^>]*>/i); // the Pitch Glimpse has a style element, so a hash is checked
    expect(page.text).not.toMatch(/<script/i);
    expect(page.text).toContain('data:image/png;base64,');
  });

  it('shows the snapshot made when the link was created, not later edits', async () => {
    const id = await seedDone();
    const link = await share(id);
    const before = (await call('GET', `/s/${link.id}`)).text;
    const result = await store.getResult(id, 1);
    await store.writeVersionJson(id, 1, 'edits', {
      findings: [{ findingId: result!.findings[0].id, title: 'A title changed after sharing' }],
      sections: [],
      removedPages: [],
      recommendations: [],
      updatedAt: new Date(clock).toISOString(),
    });
    const after = (await call('GET', `/s/${link.id}`)).text;
    expect(after).toBe(before);
    expect(after).not.toContain('A title changed after sharing');
  });

  it("never shows the owner's contact details", async () => {
    const id = await seedDone();
    for (const language of ['en', 'ta'] as const) {
      const link = await share(id, { kind: 'pitch', language, version: 1 });
      const page = await call('GET', `/s/${link.id}`);
      expect(page.status).toBe(200);
      for (const value of Object.values(OWNER)) expect(page.text).not.toContain(value);
      expect(page.text).not.toMatch(/mailto:|tel:/i);
    }
  });

  it('shows no release verdict and none of the ADR 0018 words', async () => {
    const id = await seedDone();
    const link = await share(id);
    const pages = [(await call('GET', `/s/${link.id}`)).text, SHARED_GONE_PAGE, SHARED_NOT_FOUND_PAGE];
    for (const html of pages) {
      const text = visibleText(html);
      expect(text).not.toMatch(CLAIM_WORDS);
      expect(text).not.toMatch(VERDICT_WORDS);
    }
  });

  it('answers 410 ERR_LINK_GONE as a small HTML page once revoked', async () => {
    const id = await seedDone();
    const link = await share(id);
    await store.revokeShare(id, link.id);
    const gone = await call('GET', `/s/${link.id}`);
    expect(gone.status).toBe(410);
    expect(gone.text).toBe(SHARED_GONE_PAGE);
    expect(gone.text).toContain('data-code="ERR_LINK_GONE"');
    expect(gone.text.length).toBeLessThan(2000);
    expectSharedPageHeaders(gone);
  });

  it('is open until 30 days after creation and answers 410 at 30 days plus 1 ms (injected clock)', async () => {
    const id = await seedDone();
    const link = await share(id);
    try {
      clock = START + SHARE_LINK_DAYS * DAY_MS - 1;
      expect((await call('GET', `/s/${link.id}`)).status).toBe(200);
      clock = START + SHARE_LINK_DAYS * DAY_MS + 1;
      const gone = await call('GET', `/s/${link.id}`);
      expect(gone.status).toBe(410);
      expect(gone.text).toBe(SHARED_GONE_PAGE);
    } finally {
      clock = START;
    }
  });

  it('answers 410 once the audit is deleted', async () => {
    const id = await seedDone();
    const link = await share(id);
    await store.deleteAudit(id);
    const gone = await call('GET', `/s/${link.id}`);
    expect(gone.status).toBe(410);
    expect(gone.text).toBe(SHARED_GONE_PAGE);
  });

  it('answers the same 404 body for a malformed or an unknown linkId', async () => {
    const unknown = await call('GET', `/s/${'U'.repeat(22)}`);
    expect(unknown.status).toBe(404);
    expect(unknown.text).toBe(SHARED_NOT_FOUND_PAGE);
    expectSharedPageHeaders(unknown);
    for (const malformed of [
      '/s/short',
      `/s/${'U'.repeat(21)}!`,
      `/s/${'U'.repeat(21)}%2F`,
      `/s/${'U'.repeat(129)}`,
      `/s/${'U'.repeat(22)}/extra`,
      '/s/',
      '/s',
    ]) {
      const res = await call('GET', malformed);
      expect(res.status, malformed).toBe(404);
      expect(res.text, malformed).toBe(unknown.text);
      expect(res.headers['content-type'], malformed).toBe(unknown.headers['content-type']);
      expect(res.headers['set-cookie'], malformed).toBeUndefined();
    }
  });
});

describe('GET /s/bad (malformed id, no key)', () => {
  it('answers 404 with the shared not-found page, never 401, from the AUDIT_API prefix row', async () => {
    expect(AUDIT_API.sharedPageFallback.access).toBe('public');
    const res = await call('GET', '/s/bad');
    expect(res.status).toBe(404);
    expect(res.text).toBe(SHARED_NOT_FOUND_PAGE);
  });
});

describe('DELETE /api/audits/:id/share/:linkId', () => {
  it('revokes the link and the next GET /s/:linkId answers 410', async () => {
    const id = await seedDone();
    const link = await share(id);
    expect((await call('GET', `/s/${link.id}`)).status).toBe(200);

    const revoked = await call('DELETE', `${sharePath(id)}/${link.id}`);
    expect(revoked.status).toBe(200);
    expect(revoked.json.link).toMatchObject({ id: link.id, auditId: id, revokedAt: new Date(clock).toISOString() });

    expect((await call('GET', `/s/${link.id}`)).status).toBe(410);
    const listed = await call('GET', sharePath(id));
    expect(listed.json.links[0].revokedAt).toBe(revoked.json.link.revokedAt);
  });

  it("answers 404 for an unknown link or another audit's link, and leaves that link open", async () => {
    const id = await seedDone();
    const other = await seedDone();
    const otherLink = await share(other);

    const unknown = await call('DELETE', `${sharePath(id)}/${'Z'.repeat(22)}`);
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe('ERR_AUDIT_NOT_FOUND');

    const crossAudit = await call('DELETE', `${sharePath(id)}/${otherLink.id}`);
    expect(crossAudit.status).toBe(404);
    expect((await call('GET', `/s/${otherLink.id}`)).status).toBe(200);

    const unknownAudit = await call('DELETE', `${sharePath('unknown-audit-1')}/${otherLink.id}`);
    expect(unknownAudit.status).toBe(404);
  });
});

describe('GET /api/audits/:id/share by a Helper (SEC-002)', () => {
  const HELPER = 'helper@example.com';

  it('leaves the link ids out for a Helper with a view grant, and keeps them for the owner', async () => {
    const id = await seedDone();
    const link = await share(id);
    await store.grantHelper(id, HELPER, ['view']);

    caller = { owner: false, helperEmail: HELPER };
    const helper = await call('GET', sharePath(id));
    caller = { owner: true };
    expect(helper.status).toBe(200);
    expect(helper.json.links).toHaveLength(1);
    expect(helper.json.links[0]).toMatchObject({ kind: 'pitch', version: 1, language: 'en', revokedAt: null });
    expect(helper.json.links[0].expiresAt).toBe(link.expiresAt);
    expect(helper.json.links[0]).not.toHaveProperty('id');
    expect(helper.text).not.toContain(link.id);

    const owner = await call('GET', sharePath(id));
    expect(owner.json.links).toEqual([link]);
  });

  it('answers 404 for a Helper without a grant on this audit, and for an unknown Helper', async () => {
    const id = await seedDone();
    const other = await seedDone();
    const link = await share(id);
    await store.grantHelper(other, HELPER, ['view']);

    caller = { owner: false, helperEmail: HELPER };
    const noGrant = await call('GET', sharePath(id));
    caller = { owner: false };
    const noSession = await call('GET', sharePath(id));
    caller = { owner: true };
    for (const res of [noGrant, noSession]) {
      expect(res.status).toBe(404);
      expect(res.json.code).toBe('ERR_AUDIT_NOT_FOUND');
      expect(res.text).not.toContain(link.id);
    }
  });
});

describe('GET /api/audits/:id/share', () => {
  it('answers 404 ERR_AUDIT_NOT_FOUND for an unknown audit', async () => {
    const res = await call('GET', sharePath('unknown-audit-1'));
    expect(res.status).toBe(404);
    expect(res.json.code).toBe('ERR_AUDIT_NOT_FOUND');
  });
});
