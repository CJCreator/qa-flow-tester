/** T-419: approveRewrite and runRewrite with a list of Sections. */
import { describe, it, expect, vi } from 'vitest';
import type http from 'http';
import { Readable } from 'stream';
import { AUDIT_API, type PageContent, type RewriteBatchReply } from '@qa/types';
import { RewriteStore, type AuditAi } from '@qa/core';
import { createAuditAiRoutes, type AuditAiRouteDeps, type AuditRewriteOps } from '../src/routes/audit-ai.js';
import type { Route } from '../src/routes/route.js';

const AUDIT_ID = 'audit_12345';
const TEXTS = [
  'We build sturdy wooden chairs for homes across Chennai.',
  'Our tables are made from teak grown on local farms.',
  'Visit the workshop on weekdays to see the craft in person.',
];

function content(): PageContent {
  let text = '';
  const sections = TEXTS.map((t, i) => {
    const start = text.length;
    text += t;
    return { id: `s${i + 1}`, kind: 'region' as const, start, end: text.length };
  });
  return {
    urlPath: '/about',
    title: 'About',
    description: null,
    text,
    headings: [],
    images: [],
    links: [],
    forms: [],
    ctas: [],
    language: { primary: 'en', others: [] } as unknown as PageContent['language'],
    sections,
  };
}

class MockResponse {
  statusCode = 0;
  body = '';
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  writeHead(status: number) {
    this.statusCode = status;
  }
  end(chunk?: string) {
    if (chunk) this.body += chunk;
    this.writableEnded = true;
  }
  once() {}
  off() {}
  json(): any {
    return JSON.parse(this.body);
  }
}

function world(keySaved = true) {
  let saved: unknown = null;
  const store = new RewriteStore(
    {
      readVersionJson: async () => saved as never,
      writeVersionJson: async (_a, _v, _n, value) => {
        saved = value;
      },
    },
    AUDIT_ID,
    1
  );
  const ask = vi.fn(async (_stage: string, messages: Array<{ content: string }>) => {
    const user = messages[1].content;
    const parts = JSON.parse(user.slice(user.indexOf('['))) as Array<{ id: string }>;
    return {
      ok: true as const,
      completion: {
        text: JSON.stringify({
          drafts: parts.map((p) => ({ id: p.id, variants: [`Fresh copy A ${p.id}.`, `Fresh copy B ${p.id}.`] })),
        }),
      },
      model: null,
      claimWords: [] as string[],
    };
  });
  const ai = { provider: 'openai', ask } as unknown as AuditAi;
  const resolveAi = async () =>
    keySaved ? { ok: true as const, ai } : { ok: false as const, reason: 'no-ai-key' as const };
  const ops: AuditRewriteOps = {
    list: () => store.list(),
    approve: (s) => store.approve(s),
    run: (input, d) => store.run(input, { ...d, resolveAi }),
    accept: (input, d) => store.accept(input, d),
    approveMany: (s) => store.approveMany(s),
    runBatch: (s, d) => store.runBatch(s, { ...d, resolveAi }),
  };
  const deps: AuditAiRouteDeps = {
    readModels: () => ({}),
    writeModels: () => {},
    aiDefaults: () => ({}),
    hasAiKey: () => keySaved,
    findVersion: () => ({ version: 1, status: 'done', language: 'en' }),
    rewrites: () => ops,
    loadSection: () => content(),
    applyRewriteEdit: async () => ({}) as never,
    overlapWords: () => 6,
  };
  return { routes: createAuditAiRoutes(deps), ask };
}

async function call(routes: Route[], key: 'approveRewrite' | 'runRewrite', body: unknown): Promise<MockResponse> {
  const { method, path } = AUDIT_API[key];
  const row = routes.find((r) => r.method === method && r.path === path)!;
  const req = Readable.from([JSON.stringify(body)]) as unknown as http.IncomingMessage;
  Object.assign(req, { method, headers: {} });
  const res = new MockResponse();
  await row.handle({
    server: undefined as never,
    req,
    res: res as unknown as http.ServerResponse,
    url: new URL(`http://localhost${path.replace(':id', AUDIT_ID)}`),
    params: { id: AUDIT_ID },
  });
  return res;
}

const SECTIONS = TEXTS.map((_, i) => ({ urlPath: '/about', sectionId: `s${i + 1}` }));

describe('batch rewrite rows', () => {
  it('approves the ticked Sections in one step, then writes 2 drafts each in one AI request', async () => {
    const { routes, ask } = world();
    const approved = await call(routes, 'approveRewrite', { version: 1, sections: SECTIONS.slice(0, 2) });
    expect(approved.statusCode).toBe(200);
    expect((approved.json() as RewriteBatchReply).rewrites.every((r) => r.approvedAt)).toBe(true);

    const run = await call(routes, 'runRewrite', { sections: SECTIONS });
    expect(run.statusCode).toBe(200);
    const reply = run.json() as RewriteBatchReply;
    expect(ask).toHaveBeenCalledTimes(1);
    expect(reply.rewrites.flatMap((r) => r.proposal?.variants ?? [])).toHaveLength(4);
    expect(reply.failures).toEqual([
      {
        urlPath: '/about',
        sectionId: 's3',
        code: 'ERR_NOT_APPROVED',
        error: 'Approve this Section for a rewrite first.',
      },
    ]);
  });

  it('without a key: 409 ERR_NO_AI_KEY and no request', async () => {
    const { routes, ask } = world(false);
    await call(routes, 'approveRewrite', { sections: SECTIONS.slice(0, 1) });
    const run = await call(routes, 'runRewrite', { sections: SECTIONS.slice(0, 1) });
    expect(run.statusCode).toBe(409);
    expect(ask).not.toHaveBeenCalled();
  });

  it('refuses a malformed or oversized list', async () => {
    const { routes } = world();
    expect((await call(routes, 'approveRewrite', { sections: [] })).statusCode).toBe(400);
    expect((await call(routes, 'approveRewrite', { sections: [{ urlPath: '/a' }] })).statusCode).toBe(400);
    const many = Array.from({ length: 11 }, (_, i) => ({ urlPath: '/a', sectionId: `s${i + 1}` }));
    expect((await call(routes, 'approveRewrite', { sections: many })).statusCode).toBe(400);
  });
});
