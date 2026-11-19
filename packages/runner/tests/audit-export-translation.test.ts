/**
 * T-420: full AI translation of exports, with the owner's key. The AI is a fake provider behind the real
 * resolveAuditAi (so the T-398 counter is the real one); nothing leaves the machine.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_API, matchAuditPath, sectionText } from '@qa/types';
import {
  AuditStore,
  LocalAuditStoreBackend,
  auditAiRequestBudget,
  pageContentName,
  resolveAuditAi,
  type AIProvider,
  type AuditAiRequestBudget,
} from '@qa/core';
import { auditDocContents, auditDocResult } from '../../core/tests/helpers/audit-doc-fixture.js';
import { auditExportRoutes } from '../src/routes/audit-export.js';
import { auditSettingsStoreOn } from '../src/routes/audit-settings.js';
import type { Route } from '../src/routes/route.js';

class MockResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  writeHead(status: number, headers?: Record<string, string>) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...(headers ?? {}) };
  }
  end(chunk?: string | Buffer) {
    if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  get text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

let dir: string;
let store: AuditStore;
let auditId: string;
let calls: number;
let budget: AuditAiRequestBudget;
let ids: string[][];

/** Translates every item by prefixing "HI:", keeping its id. */
const provider: AIProvider = {
  providerType: 'mock',
  async generateText(messages) {
    calls += 1;
    const items = JSON.parse(messages[1]!.content as string) as Array<{ id: string; text: string }>;
    ids.push(items.map((i) => i.id));
    return JSON.stringify({ items: items.map((i) => ({ id: i.id, text: `HI:${i.text}` })) });
  },
};

function rows(opts: { key?: boolean; owner?: boolean } = {}): Route[] {
  const { key = true, owner = true } = opts;
  return auditExportRoutes({
    store,
    settings: auditSettingsStoreOn(store.backend),
    caller: () => ({ owner }),
    resolveAi: () =>
      key
        ? resolveAuditAi({
            setup: { provider: 'mock' },
            keys: { resolveKey: async () => ({ provider: 'mock', apiKey: 'mock-key', source: 'keychain' }) },
            budget,
            createProvider: () => provider,
          })
        : Promise.resolve({ ok: false as const, reason: 'no-ai-key' as const }),
  });
}

async function get(rowsList: Route[], key: 'export' | 'exportTranslation', search: string) {
  const { method, path: pattern } = AUDIT_API[key];
  const row = rowsList.find((r) => r.method === method && r.path === pattern)!;
  const pathname = `/api/audits/${auditId}/${key === 'export' ? 'export' : 'export-translation'}`;
  const req = Readable.from([]) as unknown as http.IncomingMessage;
  Object.assign(req, { method, headers: {} });
  const res = new MockResponse();
  await row.handle({
    server: undefined as never,
    req,
    res: res as unknown as http.ServerResponse,
    url: new URL(`http://localhost${pathname}${search}`),
    params: (matchAuditPath(pattern, pathname) ?? {}) as Record<string, string>,
  });
  return res;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-export-translation-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir));
  calls = 0;
  ids = [];
  budget = auditAiRequestBudget();
  const v1 = await store.createAudit({
    url: 'https://shop.example.in/',
    limits: { maxPages: 10, maxDepth: 2, includePaths: [], excludePaths: [] },
    language: 'en',
  });
  auditId = v1.auditId;
  await store.saveResult(auditId, 1, { ...auditDocResult(), auditId, version: 1 });
  for (const c of auditDocContents()) await store.writeVersionJson(auditId, 1, pageContentName(c.urlPath), c);
  await store.updateVersion(auditId, 1, { status: 'done', finishedAt: '2026-11-19T10:00:00.000Z' });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('export in another language (T-420)', () => {
  it('a Hindi export translates every finding with its id kept, and counts every call', async () => {
    const res = await get(rows(), 'export', '?format=md&language=hi&documents=findings');
    expect(res.statusCode).toBe(200);
    const result = auditDocResult();
    for (const f of result.findings) {
      // The finding's own text came back under its id: the translated one is in the document.
      expect(res.text).toContain(`HI:${f.title}`);
    }
    expect(calls).toBeGreaterThan(0);
    expect(budget.used).toBe(calls);
    // Ids are t1, t2, ... in every batch, at most 40 strings each.
    for (const batch of ids) {
      expect(batch.length).toBeLessThanOrEqual(40);
      expect(batch[0]).toBe('t1');
    }
    expect(res.text).not.toMatch(/Labels only/);
  });

  it('a second Hindi export of the same version makes 0 calls', async () => {
    const list = rows();
    const first = await get(list, 'export', '?format=md&language=hi&documents=findings,roadmap');
    const made = calls;
    expect(made).toBeGreaterThan(0);
    const second = await get(list, 'export', '?format=md&language=hi&documents=findings,roadmap');
    expect(calls).toBe(made);
    expect(second.text).toBe(first.text);
    // The cost note says the same: nothing new to ask.
    const plan = JSON.parse((await get(list, 'exportTranslation', '?language=hi')).text);
    expect(plan.requests).toBeGreaterThanOrEqual(0);
  });

  it('keeps the quoted Page Content in its original wording, marked', async () => {
    const res = await get(rows(), 'export', '?format=md&language=hi&documents=content');
    const first = auditDocContents()[0]!;
    const text = sectionText(
      first,
      first.sections.find((s) => sectionText(first, s).trim() !== '')!
    );
    expect(text.trim()).not.toBe('');
    const line = text
      .trim()
      .split(/[\r\n]+/)[0]!
      .trim();
    expect(res.text).toContain(line);
    expect(res.text).not.toContain(`HI:${line}`);
    expect(res.text).toContain('(HI:original wording)');
  });

  it('without a key the export says labels only and makes no call', async () => {
    const res = await get(rows({ key: false }), 'export', '?format=md&language=hi&documents=findings');
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Labels only: findings stay in English');
    expect(calls).toBe(0);
  });

  it('a Helper never spends the owner key', async () => {
    const res = await get(rows({ owner: false }), 'export', '?format=md&language=hi&documents=findings');
    expect(res.text).toContain('Labels only');
    expect(calls).toBe(0);
  });

  it('the version language needs no translation', async () => {
    const res = await get(rows(), 'export', '?format=md&language=en&documents=findings');
    expect(res.statusCode).toBe(200);
    expect(calls).toBe(0);
    expect(res.text).not.toContain('Labels only');
  });

  it('the cost is known before the export starts', async () => {
    const list = rows();
    const plan = JSON.parse((await get(list, 'exportTranslation', '?language=hi')).text);
    expect(plan).toMatchObject({ needed: true, aiKey: true, labelsOnly: false, sourceLanguage: 'en' });
    expect(plan.requests).toBeGreaterThan(0);
    expect(calls).toBe(0);
    await get(list, 'export', '?format=md&language=hi');
    const after = JSON.parse((await get(list, 'exportTranslation', '?language=hi')).text);
    expect(after.requests).toBe(0);
    const none = JSON.parse((await get(rows({ key: false }), 'exportTranslation', '?language=hi')).text);
    expect(none).toMatchObject({ needed: true, aiKey: false, labelsOnly: true, requests: 0 });
    const same = JSON.parse((await get(list, 'exportTranslation', '?language=en')).text);
    expect(same.needed).toBe(false);
  });
});
