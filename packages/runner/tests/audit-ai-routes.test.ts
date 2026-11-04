/**
 * BE-410: audit AI routes. Models per audit stage (REQ-039) and the Section rewrite: approve before any AI
 * (REQ-030 AC-1), no key no AI (REQ-011 AC-2), overlap refused on accept (REQ-030 AC-2). The rows run on a
 * small HTTP server through resolveRoute, with BE-408's real RewriteStore in a temp folder and a fake AI.
 */
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_AI_API,
  AUDIT_API,
  type AuditAiModels,
  type AuditStatus,
  type EditOverlay,
  type PageContent,
  type SectionEdit,
} from '@qa/types';
import { RewriteStore, type AuditAi } from '@qa/core';
import { createAuditAiRoutes, type AuditAiRouteDeps, type AuditRewriteOps } from '../src/routes/audit-ai.js';
import { authorizeRoute, resolveRoute, type Route } from '../src/routes/route.js';

const AUDIT_ID = 'audit_12345';
const SECRET = 'sk-test-SECRET-value-0001';
const ORIGINAL = 'We build sturdy wooden chairs and tables for homes across Chennai since nineteen ninety.';
const CLEAN_COPY = 'Handmade seating and dining furniture, crafted locally for families who value lasting quality.';
const OVERLAPPING = 'Today we build sturdy wooden chairs and tables for homes across the city.';

const content: PageContent = {
  urlPath: '/about',
  title: 'About',
  description: null,
  text: ORIGINAL,
  headings: [],
  images: [],
  links: [],
  forms: [],
  ctas: [],
  language: { primary: 'en', others: [] } as unknown as PageContent['language'],
  sections: [{ id: 's1', kind: 'text' as PageContent['sections'][number]['kind'], start: 0, end: ORIGINAL.length }],
};

interface World {
  dir: string;
  server: http.Server;
  base: string;
  models: AuditAiModels;
  keySaved: boolean;
  status: AuditStatus;
  ask: ReturnType<typeof vi.fn>;
  applied: SectionEdit[];
  routes: Route[];
  deps: AuditAiRouteDeps;
}

let w: World;

async function start(): Promise<World> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-audit-ai-routes-'));
  const store = new RewriteStore(dir);
  const ask = vi.fn(async () => ({
    ok: true as const,
    completion: { text: CLEAN_COPY },
    model: null,
    claimWords: [] as string[],
  }));
  const ai = { provider: 'openai', ask } as unknown as AuditAi;
  const world = { dir, ask, models: {}, keySaved: true, status: 'done', applied: [] } as unknown as World;

  // The wiring BE-190 does: bind the store's run to the tool user's AI.
  const ops: AuditRewriteOps = {
    list: () => store.list(),
    approve: (s) => store.approve(s),
    run: (input, d) =>
      store.run(input, {
        ...d,
        resolveAi: async () => (world.keySaved ? { ok: true, ai } : { ok: false, reason: 'no-ai-key' }),
      }),
    accept: (input, d) => store.accept(input, d),
  };

  world.deps = {
    readModels: () => ({ ...world.models }),
    writeModels: (m) => {
      world.models = { ...m };
    },
    aiDefaults: () => ({ text: 'text-default', vision: 'vision-default' }),
    hasAiKey: () => world.keySaved,
    findVersion: (auditId, version) =>
      auditId === AUDIT_ID && (version === undefined || version === 1)
        ? { version: 1, status: world.status, language: 'en' }
        : null,
    rewrites: () => ops,
    loadSection: (_id, _v, urlPath) => (urlPath === content.urlPath ? content : null),
    applyRewriteEdit: vi.fn(async (_id: string, _v: number, edit: SectionEdit): Promise<EditOverlay> => {
      world.applied.push(edit);
      return { findings: [], sections: [...world.applied], removedPages: [], recommendations: [] } as unknown as EditOverlay;
    }),
    overlapWords: () => 6,
  };
  world.routes = createAuditAiRoutes(world.deps);

  world.server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = resolveRoute(world.routes, req.method ?? 'GET', url.pathname);
    if (!match) {
      res.writeHead(404).end();
      return;
    }
    void match.route.handle({ server: undefined as never, req, res, url, params: match.params });
  });
  await new Promise<void>((resolve) => world.server.listen(0, '127.0.0.1', resolve));
  world.base = `http://127.0.0.1:${(world.server.address() as AddressInfo).port}`;
  return world;
}

async function call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any; raw: string }> {
  const res = await fetch(`${w.base}${p}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const raw = await res.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, raw };
}

const rewritePath = `/api/audits/${AUDIT_ID}/rewrite`;
const section = { urlPath: '/about', sectionId: 's1' };

beforeEach(async () => {
  w = await start();
});

afterEach(async () => {
  await new Promise<void>((resolve) => w.server.close(() => resolve()));
  await fs.rm(w.dir, { recursive: true, force: true });
});

describe('route rows declare their access level', () => {
  it('each row carries the access of its AUDIT_API / AUDIT_AI_API entry', () => {
    const rows = createAuditAiRoutes(w.deps);
    const expected = [
      AUDIT_AI_API.getModels,
      AUDIT_AI_API.putModels,
      AUDIT_API.listRewrites,
      AUDIT_API.approveRewrite,
      AUDIT_API.runRewrite,
      AUDIT_API.acceptRewrite,
    ];
    expect(rows).toHaveLength(expected.length);
    for (const entry of expected) {
      const match = resolveRoute(rows, entry.method, entry.path.replace(':id', AUDIT_ID));
      expect(match, `${entry.method} ${entry.path}`).toBeDefined();
      expect(match!.route.access).toBe(entry.access);
    }
    const accessOf = (method: string, p: string) => resolveRoute(rows, method, p)!.route.access;
    expect(accessOf('GET', '/api/audit-ai/models')).toBe('owner');
    expect(accessOf('PUT', '/api/audit-ai/models')).toBe('owner');
    expect(accessOf('POST', rewritePath)).toBe('owner');
    expect(accessOf('POST', `${rewritePath}/approve`)).toBe('edit');
    expect(accessOf('POST', `${rewritePath}/accept`)).toBe('edit');
    expect(accessOf('GET', rewritePath)).toBe('view');
  });

  it('a Helper with edit may approve but never run a rewrite (owner only)', () => {
    const rows = createAuditAiRoutes(w.deps);
    const helper = { hasAccessKey: false, beta: false, helper: (p: string) => p === 'edit' };
    expect(authorizeRoute(resolveRoute(rows, 'POST', `${rewritePath}/approve`)!.route, helper)).toEqual({ allow: true });
    expect(authorizeRoute(resolveRoute(rows, 'POST', rewritePath)!.route, helper)).toMatchObject({ allow: false, status: 401 });
  });

  it('a malformed audit id does not match any row', () => {
    expect(resolveRoute(createAuditAiRoutes(w.deps), 'POST', '/api/audits/bad id/rewrite')).toBeUndefined();
  });
});

describe('GET/PUT /api/audit-ai/models (REQ-039)', () => {
  it('GET returns each stage on its slot default when nothing is saved', async () => {
    const { status, json } = await call('GET', '/api/audit-ai/models');
    expect(status).toBe(200);
    expect(json).toEqual({
      models: {},
      defaults: { text: 'text-default', vision: 'vision-default' },
      effective: { assessment: 'vision-default', documents: 'text-default', preview: 'text-default', rewrite: 'text-default' },
    });
  });

  it('PUT saves a model per stage; GET returns it; null puts the default back', async () => {
    const put = await call('PUT', '/api/audit-ai/models', { models: { assessment: 'vision-big', rewrite: ' writer-1 ' } });
    expect(put.status).toBe(200);
    expect(put.json.models).toEqual({ assessment: 'vision-big', rewrite: 'writer-1' });
    expect(w.models).toEqual({ assessment: 'vision-big', rewrite: 'writer-1' });

    const get = await call('GET', '/api/audit-ai/models');
    expect(get.json.effective).toEqual({
      assessment: 'vision-big',
      documents: 'text-default',
      preview: 'text-default',
      rewrite: 'writer-1',
    });

    const reset = await call('PUT', '/api/audit-ai/models', { models: { rewrite: null } });
    expect(reset.status).toBe(200);
    expect(reset.json.models).toEqual({ assessment: 'vision-big' });
    expect(reset.json.effective.rewrite).toBe('text-default');
  });

  it('an invalid body answers 400 ERR_INVALID_REQUEST with a message per stage and saves nothing', async () => {
    const write = vi.spyOn(w.deps, 'writeModels');
    const bad = await call('PUT', '/api/audit-ai/models', {
      models: { rewrite: '', preview: 'x'.repeat(201), planning: 'm', documents: 'ok\u0007' },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('ERR_INVALID_REQUEST');
    expect(typeof bad.json.error).toBe('string');
    expect(Object.keys(bad.json.errors).sort()).toEqual(['documents', 'planning', 'preview', 'rewrite']);
    expect(write).not.toHaveBeenCalled();
    expect(w.models).toEqual({});

    for (const body of ['not json', '[]', '{"models":"x"}']) {
      const r = await call('PUT', '/api/audit-ai/models', body);
      expect(r.status).toBe(400);
      expect(r.json.code).toBe('ERR_INVALID_REQUEST');
    }
  });
});

describe('POST /api/audits/:id/rewrite (REQ-030 AC-1, REQ-011 AC-2)', () => {
  it('refuses a Section with no recorded approval with 409 ERR_NOT_APPROVED and calls no AI; runs after approve', async () => {
    const refused = await call('POST', rewritePath, section);
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('ERR_NOT_APPROVED');
    expect(w.ask).not.toHaveBeenCalled();

    const approved = await call('POST', `${rewritePath}/approve`, section);
    expect(approved.status).toBe(200);
    expect(approved.json.rewrite).toMatchObject({ ...section, proposal: null });
    expect(typeof approved.json.rewrite.approvedAt).toBe('string');

    const ran = await call('POST', rewritePath, section);
    expect(ran.status).toBe(200);
    expect(ran.json.rewrite.proposal).toMatchObject({ text: CLEAN_COPY, language: 'en', overlaps: [] });
    expect(w.ask).toHaveBeenCalled();
    expect(w.ask.mock.calls[0][0]).toBe('rewrite');

    const list = await call('GET', rewritePath);
    expect(list.status).toBe(200);
    expect(list.json.rewrites).toHaveLength(1);
    expect(list.json.rewrites[0].proposal.text).toBe(CLEAN_COPY);
  });

  it('without a saved AI key answers 409 ERR_NO_AI_KEY and calls no AI', async () => {
    w.keySaved = false;
    await call('POST', `${rewritePath}/approve`, section);
    const r = await call('POST', rewritePath, section);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('ERR_NO_AI_KEY');
    expect(w.ask).not.toHaveBeenCalled();
  });

  it('a provider failure answers without the key or the provider error text', async () => {
    w.ask.mockRejectedValue(new Error(`401 from provider: invalid key ${SECRET} {"error":"raw body"}`));
    await call('POST', `${rewritePath}/approve`, section);
    const r = await call('POST', rewritePath, section);
    expect(r.status).toBe(502);
    expect(r.json.code).toBe('ERR_AI_FAILED');
    expect(r.raw).not.toContain(SECRET);
    expect(r.raw).not.toContain('raw body');
  });

  it('an unexpected error answers a plain 500 with no internals', async () => {
    w.deps.hasAiKey = () => {
      throw new Error(`key store broke at C:/secret/path ${SECRET}`);
    };
    w.routes.splice(0, w.routes.length, ...createAuditAiRoutes(w.deps));
    await call('POST', `${rewritePath}/approve`, section);
    const r = await call('POST', rewritePath, section);
    expect(r.status).toBe(500);
    expect(r.raw).not.toContain(SECRET);
    expect(r.raw).not.toContain('secret/path');
  });

  it('refuses an unknown language, a bad body, an unknown audit and a running version', async () => {
    const lang = await call('POST', rewritePath, { ...section, language: 'xx' });
    expect(lang.status).toBe(400);
    expect(lang.json.errors.language).toBeTruthy();

    const bad = await call('POST', rewritePath, { urlPath: 5 });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('ERR_INVALID_REQUEST');
    expect(Object.keys(bad.json.errors).sort()).toEqual(['sectionId', 'urlPath']);

    const missing = await call('POST', '/api/audits/audit_99999/rewrite', section);
    expect(missing.status).toBe(404);
    expect(missing.json.code).toBe('ERR_AUDIT_NOT_FOUND');

    const noVersion = await call('GET', `${rewritePath}?version=7`);
    expect(noVersion.status).toBe(404);

    w.status = 'running';
    const running = await call('POST', `${rewritePath}/approve`, section);
    expect(running.status).toBe(409);
    expect(running.json.code).toBe('ERR_AUDIT_RUNNING');
    expect(w.ask).not.toHaveBeenCalled();
  });
});

describe('POST /api/audits/:id/rewrite/accept (REQ-030 AC-2)', () => {
  it('copy sharing a run of rewriteOverlapWords words answers 422 ERR_OVERLAP with overlaps and applies no edit', async () => {
    await call('POST', `${rewritePath}/approve`, section);
    const r = await call('POST', `${rewritePath}/accept`, { ...section, text: OVERLAPPING });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe('ERR_OVERLAP');
    expect(typeof r.json.error).toBe('string');
    expect(r.json.overlaps.length).toBeGreaterThan(0);
    expect(r.json.overlaps[0].wordCount).toBeGreaterThanOrEqual(6);
    expect(w.deps.applyRewriteEdit).not.toHaveBeenCalled();
  });

  it("clean copy is applied as an edit marked 'rewrite'", async () => {
    await call('POST', `${rewritePath}/approve`, section);
    const r = await call('POST', `${rewritePath}/accept`, { ...section, text: CLEAN_COPY });
    expect(r.status).toBe(200);
    expect(typeof r.json.rewrite.acceptedAt).toBe('string');
    expect(w.applied).toHaveLength(1);
    expect(w.applied[0]).toMatchObject({ urlPath: '/about', sectionId: 's1', text: CLEAN_COPY, by: 'rewrite' });
    expect(r.json.edits.sections[0].by).toBe('rewrite');
  });

  it('refuses accept without approval and with empty text', async () => {
    const notApproved = await call('POST', `${rewritePath}/accept`, { ...section, text: CLEAN_COPY });
    expect(notApproved.status).toBe(409);
    expect(notApproved.json.code).toBe('ERR_NOT_APPROVED');

    await call('POST', `${rewritePath}/approve`, section);
    const empty = await call('POST', `${rewritePath}/accept`, { ...section, text: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.json.errors.text).toBeTruthy();
    expect(w.deps.applyRewriteEdit).not.toHaveBeenCalled();
  });
});
