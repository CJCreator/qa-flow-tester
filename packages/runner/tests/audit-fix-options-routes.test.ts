/**
 * T-417 follow-up: the runner asks for AI fix options (stage `documents`) when a key works. The screen's route
 * and the Findings and Improvement Roadmap exports show them; rule options stay the fallback. The AI is a fake
 * provider behind the real resolveAuditAi.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { AUDIT_API, matchAuditPath, type FixOptionsReply } from '@qa/types';
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

const provider: AIProvider = {
  providerType: 'mock',
  async generateText(messages) {
    calls += 1;
    const batch = JSON.parse(messages[1]!.content as string) as Array<{ id: string }>;
    return JSON.stringify({
      options: batch.map((f) => ({
        findingId: f.id,
        title: `Site-specific way for ${f.id}`,
        effort: 'M',
        tradeOff: 'Takes about a day.',
      })),
    });
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

async function get(list: Route[], key: 'export' | 'fixOptions', search = '') {
  const { method, path: pattern } = AUDIT_API[key];
  const row = list.find((r) => r.method === method && r.path === pattern)!;
  const pathname = `/api/audits/${auditId}/${key === 'export' ? 'export' : 'fix-options'}`;
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
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-fix-options-'));
  store = new AuditStore(new LocalAuditStoreBackend(dir));
  calls = 0;
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

describe('fix options with a key (T-417 follow-up)', () => {
  it('the screen route returns AI options next to the rule options, and counts each request', async () => {
    const res = await get(rows(), 'fixOptions');
    expect(res.statusCode).toBe(200);
    const reply = JSON.parse(res.text) as FixOptionsReply;
    expect(reply.ai).toBe(true);
    const all = Object.values(reply.options).flat();
    expect(all.some((o) => o.source === 'ai')).toBe(true);
    expect(all.some((o) => o.source === 'rule')).toBe(true);
    expect(calls).toBeGreaterThan(0);
    expect(budget.used).toBe(calls);
  });

  it('the Findings and Roadmap exports show the same AI options without asking again', async () => {
    const list = rows();
    await get(list, 'fixOptions');
    const made = calls;
    const md = (await get(list, 'export', '?format=md&documents=findings,roadmap')).text;
    expect(md).toContain('Site-specific way for');
    expect(md).toContain('AI suggestion for this finding');
    expect(md).toContain('Suggested way to fix it: ');
    expect(calls).toBe(made);
  });

  it('without a key, rule options are shown and nothing is asked', async () => {
    const list = rows({ key: false });
    const reply = JSON.parse((await get(list, 'fixOptions')).text) as FixOptionsReply;
    expect(reply.ai).toBe(false);
    expect(
      Object.values(reply.options)
        .flat()
        .every((o) => o.source === 'rule')
    ).toBe(true);
    const md = (await get(list, 'export', '?format=md&documents=findings,roadmap')).text;
    expect(md).toContain('decided by rule');
    expect(md).not.toContain('Site-specific');
    expect(calls).toBe(0);
  });

  it('a Helper sees stored AI options but never makes a new request', async () => {
    const helper = JSON.parse((await get(rows({ owner: false }), 'fixOptions')).text) as FixOptionsReply;
    expect(helper.ai).toBe(false);
    expect(calls).toBe(0);
    await get(rows(), 'fixOptions');
    const made = calls;
    const again = JSON.parse((await get(rows({ owner: false }), 'fixOptions')).text) as FixOptionsReply;
    expect(again.ai).toBe(true);
    expect(calls).toBe(made);
  });

  it('a Tamil export of the Findings document reads the rule options in Tamil', async () => {
    const md = (await get(rows({ key: false }), 'export', '?format=md&documents=findings&language=ta')).text;
    expect(md).toContain('விதிப்படி முடிவு');
  });
});
