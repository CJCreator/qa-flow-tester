/**
 * BE-605 (REQ-024): the improved-homepage preview rows. The real store in a temp folder, the real core
 * generator and stage AI, and a fake AI Provider; handlers are called with a mock request and response.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { AUDIT_API, matchAuditPath, type AICompletionOptions, type AuditAiModels } from '@qa/types';
import { AuditStore, LocalAuditStoreBackend, pageContentName, resolveAuditAi, type AIProvider } from '@qa/core';
import { generatePreview } from '../../core/src/audit/preview/index.js';
import { auditDocContents, auditDocResult, PATHS } from '../../core/tests/helpers/audit-doc-fixture.js';
import {
  auditPreviewRoutes,
  previewHeaders,
  PREVIEW_FAILED,
  type AuditPreviewRouteDeps,
  type PreviewGenerator,
} from '../src/routes/audit-preview.js';
import type { AuditCaller } from '../src/routes/audit-store.js';
import type { Route } from '../src/routes/route.js';

const TEST_KEY = 'test-key-not-real';
const NOW = new Date('2026-11-03T10:00:00.000Z');
const AI_PAGE =
  '<nav><a href="/about">About</a><a href="/services">Services</a></nav><h1 id="top">Fresh groceries</h1>';

class MockResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = '';
  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    this.headers = { ...(headers ?? {}) };
  }
  end(chunk?: string | Buffer) {
    if (chunk) this.body += chunk.toString();
  }
  json(): any {
    return JSON.parse(this.body);
  }
}

let dir: string;
let store: AuditStore;
let caller: AuditCaller;
let auditId: string;
let providerCalls: AICompletionOptions[];
let providerAnswer: string | Error;
let hasKey: boolean;

const provider: AIProvider = {
  providerType: 'openrouter',
  async generateText(_messages, options) {
    providerCalls.push(options ?? {});
    if (providerAnswer instanceof Error) throw providerAnswer;
    return providerAnswer;
  },
};

function deps(extra: Partial<AuditPreviewRouteDeps> = {}): AuditPreviewRouteDeps {
  const models: AuditAiModels = { preview: 'preview/model-x', assessment: 'other/model' };
  return {
    store,
    caller: () => caller,
    resolveAi: () =>
      resolveAuditAi({
        setup: { provider: 'openrouter', text: 'default/text', vision: 'default/vision' },
        keys: {
          resolveKey: async () => (hasKey ? { provider: 'openrouter', apiKey: TEST_KEY, source: 'keychain' } : null),
        },
        models,
        createProvider: () => provider,
      }),
    generate: generatePreview,
    fetchImage: async () => null,
    now: () => NOW,
    ...extra,
  };
}

async function call(
  rows: Route[],
  key: 'createPreview' | 'getPreview',
  id: string,
  options: { body?: string; search?: string } = {}
): Promise<MockResponse> {
  const { method, path: pattern } = AUDIT_API[key];
  const row = rows.find((r) => r.method === method && r.path === pattern)!;
  const pathname = `/api/audits/${id}/preview`;
  const params = (matchAuditPath(pattern, pathname) ?? {}) as Record<string, string>;
  const req = Readable.from(options.body === undefined ? [] : [options.body]) as unknown as http.IncomingMessage;
  Object.assign(req, { method, headers: {} });
  const res = new MockResponse();
  await row.handle({
    server: undefined as never,
    req,
    res: res as unknown as http.ServerResponse,
    url: new URL(`http://localhost${pathname}${options.search ?? ''}`),
    params,
  });
  return res;
}

async function storedPreview(version = 1): Promise<Uint8Array | null> {
  return store.getVersionFile(auditId, version, 'preview.html');
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-preview-routes-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir));
  caller = { owner: true };
  providerCalls = [];
  providerAnswer = AI_PAGE;
  hasKey = true;

  const v1 = await store.createAudit({
    url: 'https://shop.example.in/',
    limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
    language: 'en',
  });
  auditId = v1.auditId;
  await store.saveResult(auditId, 1, { ...auditDocResult(), auditId, version: 1 });
  const home = auditDocContents().find((c) => c.urlPath === PATHS.home)!;
  await store.writeVersionJson(auditId, 1, pageContentName(PATHS.home), home);
  await store.updateVersion(auditId, 1, { status: 'done', finishedAt: NOW.toISOString() });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('preview rows', () => {
  it('createPreview and getPreview equal AUDIT_API: method, path and access (owner, view)', () => {
    const rows = auditPreviewRoutes(deps());
    expect(rows).toHaveLength(2);
    for (const key of ['createPreview', 'getPreview'] as const) {
      const entry = AUDIT_API[key];
      const matches = rows.filter((r) => r.method === entry.method && r.path === entry.path);
      expect(matches).toHaveLength(1);
      expect(matches[0].access).toBe(entry.access);
    }
    expect(rows.find((r) => r.method === 'POST')!.access).toBe('owner');
    expect(rows.find((r) => r.method === 'GET')!.access).toBe('view');
  });

  it('without an AI key: 409 ERR_NO_AI_KEY, no AI request, nothing stored', async () => {
    hasKey = false;
    const generate = vi.fn<PreviewGenerator>(generatePreview);
    const res = await call(auditPreviewRoutes(deps({ generate })), 'createPreview', auditId, {
      body: JSON.stringify({ version: 1, language: 'en' }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ERR_NO_AI_KEY');
    expect(generate).not.toHaveBeenCalled();
    expect(providerCalls).toHaveLength(0);
    expect(await storedPreview()).toBeNull();
  });

  it("with a key: stores preview.html and answers PreviewReply; the 'preview' stage model is used", async () => {
    const res = await call(auditPreviewRoutes(deps()), 'createPreview', auditId, {
      body: JSON.stringify({ version: 1, language: 'ta' }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ preview: { version: 1, language: 'ta', createdAt: NOW.toISOString() } });
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].stage).toBe('preview');
    expect(providerCalls[0].model).toBe('preview/model-x');
    expect(typeof providerCalls[0].timeoutMs).toBe('number');
    const page = new TextDecoder().decode((await storedPreview())!);
    expect(page).toContain('<html lang="ta"');
    expect(page).toContain('Preview of suggested changes');
  });

  it('an empty body uses the latest version and its language', async () => {
    const res = await call(auditPreviewRoutes(deps()), 'createPreview', auditId, { body: '' });
    expect(res.statusCode).toBe(200);
    expect(res.json().preview).toMatchObject({ version: 1, language: 'en' });
  });

  it('an AI failure answers fixed wording and stores nothing', async () => {
    providerAnswer = new Error('provider said: internal detail 12345');
    const res = await call(auditPreviewRoutes(deps()), 'createPreview', auditId, { body: '{}' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: PREVIEW_FAILED, code: 'ERR_AI_FAILED' });
    expect(res.body).not.toContain('internal detail');
    expect(res.body).not.toContain(TEST_KEY);
    expect(await storedPreview()).toBeNull();
  });

  it('a generator that throws is the same fixed failure', async () => {
    const generate: PreviewGenerator = async () => {
      throw new Error('boom /tmp/secret/path');
    };
    const res = await call(auditPreviewRoutes(deps({ generate })), 'createPreview', auditId, { body: '{}' });
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('/tmp/secret');
    expect(await storedPreview()).toBeNull();
  });

  it('refuses bad bodies, unknown audits and versions, and a Helper', async () => {
    const rows = auditPreviewRoutes(deps());
    for (const body of ['not json', '[]', '{"version":0}', '{"version":"1"}', '{"language":"xx"}', '{"other":1}']) {
      const res = await call(rows, 'createPreview', auditId, { body });
      expect(res.statusCode, body).toBe(400);
      expect(res.json().code).toBe('ERR_INVALID_REQUEST');
    }
    expect((await call(rows, 'createPreview', auditId, { body: 'x'.repeat(5000) })).statusCode).toBe(400);
    const unknown = await call(rows, 'createPreview', 'unknown_audit_1', { body: '{}' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe('ERR_AUDIT_NOT_FOUND');
    expect((await call(rows, 'createPreview', auditId, { body: '{"version":7}' })).statusCode).toBe(404);

    caller = { owner: false, helperEmail: 'helper@example.com' };
    const helper = await call(rows, 'createPreview', auditId, { body: '{}' });
    expect(helper.statusCode).toBe(403);
    expect(providerCalls).toHaveLength(0);
  });

  it('a running version is refused with 409 ERR_AUDIT_RUNNING', async () => {
    await store.updateVersion(auditId, 1, { status: 'running' });
    const res = await call(auditPreviewRoutes(deps()), 'createPreview', auditId, { body: '{}' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ERR_AUDIT_RUNNING');
  });
});

describe('serving the preview', () => {
  it('404 ERR_AUDIT_NOT_FOUND when no preview exists for that version', async () => {
    const rows = auditPreviewRoutes(deps());
    const res = await call(rows, 'getPreview', auditId, { search: '?version=1' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('ERR_AUDIT_NOT_FOUND');
    expect((await call(rows, 'getPreview', auditId, { search: '?version=abc' })).statusCode).toBe(400);
    expect((await call(rows, 'getPreview', auditId, { search: '?version=2' })).statusCode).toBe(404);
  });

  it('serves the stored page with the Shared Link page headers (ADR 0036)', async () => {
    const rows = auditPreviewRoutes(deps());
    await call(rows, 'createPreview', auditId, { body: '{"version":1}' });
    const res = await call(rows, 'getPreview', auditId, { search: '?version=1' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    const csp = res.headers['Content-Security-Policy'];
    const styleTexts = [...res.body.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
    const hashes = styleTexts.map((t) => `'sha256-${createHash('sha256').update(t, 'utf8').digest('base64')}'`);
    expect(styleTexts.length).toBeGreaterThanOrEqual(2);
    for (const t of styleTexts) expect(t).not.toBe('');
    expect(csp).toContain(`style-src ${hashes.join(' ')};`);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("default-src 'none'");
    expect(res.headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(res.headers['Referrer-Policy']).toBe('no-referrer');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.body).toContain('Preview of suggested changes');
    expect(res.body).toContain('href="https://shop.example.in/about" target="_blank" rel="noopener noreferrer"');
    expect(res.body).not.toMatch(/<script/i);
  });

  it('the policy keeps the ADR 0036 directives; styles come only through hashes', () => {
    const adr = readFileSync(
      path.resolve(__dirname, '../../../docs/adr/0036-hosted-audit-storage-and-shared-links.md'),
      'utf8'
    );
    expect(adr).toContain(
      "default-src 'none'; img-src data:; style-src 'sha256-…'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    expect(previewHeaders('<p>x</p>')['Content-Security-Policy']).toBe(
      "default-src 'none'; img-src data:; style-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    );
  });

  it('a Helper needs a view grant on this audit', async () => {
    const rows = auditPreviewRoutes(deps());
    await call(rows, 'createPreview', auditId, { body: '{}' });
    caller = { owner: false, helperEmail: 'helper@example.com' };
    expect((await call(rows, 'getPreview', auditId)).statusCode).toBe(404);
    await store.grantHelper(auditId, 'helper@example.com', ['view']);
    expect((await call(rows, 'getPreview', auditId)).statusCode).toBe(200);
  });
});
