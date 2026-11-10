import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { AIMessage, AIProviderType, PageContent } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { resolveAuditAi } from '../src/audit/ai/stage-ai.js';
import { REWRITES_FILE, RewriteStore, type RewriteRunDeps } from '../src/audit/ai/rewrite-store.js';

const TEST_KEY = 'test-key-not-real';
const FIXED = new Date('2026-11-03T10:00:00.000Z');
const now = () => FIXED;

const HEADER = 'Kumar Bakery';
const BODY =
  'Fresh bread baked every morning in our family kitchen. Call us to order cakes for birthdays and weddings.';
const FRESH = 'Every day our home kitchen bakes new loaves. Ring us for celebration cakes.';
const COPIED = 'Fresh bread baked every morning in our family kitchen. Ring us for cakes.';

function content(urlPath = '/about'): PageContent {
  const text = `${HEADER}${BODY}`;
  return {
    urlPath,
    title: 'About',
    description: null,
    text,
    headings: [],
    images: [],
    links: [],
    forms: [],
    ctas: [],
    language: { primary: 'en', others: [], declared: 'en' },
    sections: [
      { id: 's1', kind: 'header', start: 0, end: HEADER.length },
      { id: 's2', kind: 'main', start: HEADER.length, end: text.length },
    ],
  };
}

function scripted(script: string[]) {
  const requests: AIMessage[][] = [];
  const provider: AIProvider = {
    providerType: 'mock',
    async generateText(messages) {
      requests.push(messages);
      const next = script.shift();
      if (next === undefined) throw new Error('script ran out');
      return next;
    },
  };
  return { provider, requests };
}

function deps(provider: AIProvider, extra: Partial<RewriteRunDeps> = {}) {
  const resolveKey = vi.fn(async () => ({ provider: 'mock' as const, apiKey: TEST_KEY, source: 'env' as const }));
  const createProvider = vi.fn((_t: AIProviderType, _k: string) => provider);
  const run: RewriteRunDeps = {
    resolveAi: () => resolveAuditAi({ setup: { provider: 'mock' }, keys: { resolveKey }, createProvider }),
    content: content(),
    now,
    ...extra,
  };
  return { run, resolveKey, createProvider };
}

const S2 = { urlPath: '/about', sectionId: 's2' };

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-rewrite-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('RewriteStore approval gate (REQ-030 AC-1)', () => {
  it('refuses to run without approval: ERR_NOT_APPROVED, no key lookup, no AI request', async () => {
    const store = new RewriteStore(dir);
    const { provider, requests } = scripted([FRESH]);
    const d = deps(provider);
    const result = await store.run({ ...S2, language: 'en' }, d.run);
    expect(result).toMatchObject({ ok: false, code: 'ERR_NOT_APPROVED' });
    expect(d.resolveKey).not.toHaveBeenCalled();
    expect(d.createProvider).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it('approval of one Section does not approve another', async () => {
    const store = new RewriteStore(dir);
    await store.approve({ urlPath: '/about', sectionId: 's1' }, now);
    const { provider, requests } = scripted([FRESH]);
    expect(await store.run({ ...S2, language: 'en' }, deps(provider).run)).toMatchObject({ code: 'ERR_NOT_APPROVED' });
    expect(requests).toHaveLength(0);
  });

  it('two stores on the same version folder do not lose an update', async () => {
    const a = new RewriteStore(dir);
    const b = new RewriteStore(dir);
    await Promise.all([
      a.approve({ urlPath: '/about', sectionId: 's1' }, now),
      b.approve({ urlPath: '/about', sectionId: 's2' }, now),
    ]);
    const reader = new RewriteStore(dir);
    const list = await reader.list();
    const s1 = list.find((s) => s.urlPath === '/about' && s.sectionId === 's1');
    const s2 = list.find((s) => s.urlPath === '/about' && s.sectionId === 's2');
    expect(s1?.approvedAt).toBeTruthy();
    expect(s2?.approvedAt).toBeTruthy();
  });

  it('refuses ERR_NO_AI_KEY when approved but there is no key', async () => {
    const store = new RewriteStore(dir);
    await store.approve(S2, now);
    const createProvider = vi.fn();
    const result = await store.run(
      { ...S2, language: 'en' },
      {
        resolveAi: () =>
          resolveAuditAi({ setup: { provider: 'mock' }, keys: { resolveKey: async () => null }, createProvider }),
        content: content(),
      }
    );
    expect(result).toMatchObject({ ok: false, code: 'ERR_NO_AI_KEY' });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('approving twice keeps the first time', async () => {
    const store = new RewriteStore(dir);
    await store.approve(S2, now);
    const again = await store.approve(S2, () => new Date('2027-01-01T00:00:00.000Z'));
    expect(again.ok && again.rewrite.approvedAt).toBe(FIXED.toISOString());
  });

  it('rejects malformed paths, ids and languages', async () => {
    const store = new RewriteStore(dir);
    expect(await store.approve({ urlPath: 'about', sectionId: 's2' })).toMatchObject({
      code: 'ERR_INVALID_REQUEST',
      fields: { urlPath: expect.any(String) },
    });
    expect(await store.approve({ urlPath: '/about', sectionId: '../x y' })).toMatchObject({
      code: 'ERR_INVALID_REQUEST',
      fields: { sectionId: expect.any(String) },
    });
    const { provider } = scripted([]);
    expect(await store.run({ ...S2, language: 'xx' as 'en' }, deps(provider).run)).toMatchObject({
      code: 'ERR_INVALID_REQUEST',
      fields: { language: expect.any(String) },
    });
    await expect(fs.access(path.join(dir, REWRITES_FILE))).rejects.toThrow();
  });

  it('refuses a Section that is not on the recorded page, with no AI request', async () => {
    const store = new RewriteStore(dir);
    await store.approve({ urlPath: '/about', sectionId: 's9' }, now);
    const { provider, requests } = scripted([FRESH]);
    expect(await store.run({ urlPath: '/about', sectionId: 's9', language: 'en' }, deps(provider).run)).toMatchObject({
      code: 'ERR_INVALID_REQUEST',
    });
    expect(requests).toHaveLength(0);
  });
});

describe('RewriteStore run and accept (REQ-030 AC-2)', () => {
  it('stores the proposal with its language, overlaps and time; the original is the Section text', async () => {
    const store = new RewriteStore(dir);
    await store.approve(S2, now);
    const { provider, requests } = scripted([FRESH]);
    const result = await store.run({ ...S2, language: 'en' }, deps(provider).run);
    expect(result).toEqual({
      ok: true,
      rewrite: {
        ...S2,
        approvedAt: FIXED.toISOString(),
        proposal: { text: FRESH, language: 'en', overlaps: [], createdAt: FIXED.toISOString() },
        acceptedAt: null,
      },
    });
    const sent = requests[0].map((m) => m.content).join('\n');
    expect(sent).toContain(JSON.stringify(BODY));
    expect(sent).not.toContain(HEADER);
  });

  it('flags copied runs on the stored proposal after the one retry', async () => {
    const store = new RewriteStore(dir);
    await store.approve(S2, now);
    const { provider, requests } = scripted([COPIED, COPIED]);
    const result = await store.run({ ...S2, language: 'en' }, deps(provider).run);
    expect(requests).toHaveLength(2);
    expect(result.ok && result.rewrite.proposal?.overlaps).toEqual([
      { words: 'fresh bread baked every morning in our family kitchen', wordCount: 9 },
    ]);
  });

  it('honours the configured overlap threshold', async () => {
    const store = new RewriteStore(dir);
    await store.approve(S2, now);
    const { provider, requests } = scripted([COPIED]);
    const result = await store.run({ ...S2, language: 'en' }, deps(provider, { overlapWords: 12 }).run);
    expect(requests).toHaveLength(1);
    expect(result.ok && result.rewrite.proposal?.overlaps).toEqual([]);
  });

  it('reports an AI failure without storing a proposal', async () => {
    const store = new RewriteStore(dir);
    await store.approve(S2, now);
    const { provider } = scripted(['Our certified bakery.', 'Our certified bakery again.']);
    const result = await store.run({ ...S2, language: 'en' }, deps(provider).run);
    expect(result).toMatchObject({ ok: false, code: 'ai-failed', problem: 'claim-words' });
    expect((await store.get(S2))?.proposal).toBeNull();
  });

  it('refuses to accept without approval', async () => {
    const store = new RewriteStore(dir);
    const result = await store.accept({ ...S2, text: FRESH }, { content: content(), now });
    expect(result).toMatchObject({ ok: false, code: 'ERR_NOT_APPROVED' });
  });

  it('refuses to accept copy that still has a flagged run: ERR_OVERLAP with the runs', async () => {
    const store = new RewriteStore(dir);
    await store.approve(S2, now);
    const result = await store.accept({ ...S2, text: COPIED }, { content: content(), now });
    expect(result).toMatchObject({
      ok: false,
      code: 'ERR_OVERLAP',
      overlaps: [{ words: 'fresh bread baked every morning in our family kitchen', wordCount: 9 }],
    });
    expect((await store.get(S2))?.acceptedAt).toBeNull();
    // A higher threshold lets the same copy through.
    expect(await store.accept({ ...S2, text: COPIED }, { content: content(), now, overlapWords: 10 })).toMatchObject({
      ok: true,
    });
  });

  it('accepting clean copy returns a SectionEdit marked by rewrite', async () => {
    const store = new RewriteStore(dir);
    await store.approve(S2, now);
    const result = await store.accept({ ...S2, text: FRESH }, { content: content(), now });
    expect(result).toEqual({
      ok: true,
      rewrite: { ...S2, approvedAt: FIXED.toISOString(), proposal: null, acceptedAt: FIXED.toISOString() },
      edit: { ...S2, text: FRESH, by: 'rewrite', editedAt: FIXED.toISOString() },
    });
  });

  it('rejects empty or over-long accepted text', async () => {
    const store = new RewriteStore(dir);
    await store.approve(S2, now);
    expect(await store.accept({ ...S2, text: '   ' }, { content: content() })).toMatchObject({
      code: 'ERR_INVALID_REQUEST',
      fields: { text: expect.any(String) },
    });
    expect(await store.accept({ ...S2, text: 'x'.repeat(20001) }, { content: content() })).toMatchObject({
      code: 'ERR_INVALID_REQUEST',
    });
  });
});

describe('RewriteStore persistence', () => {
  it('approval and proposals survive a reload; the file holds no key', async () => {
    const first = new RewriteStore(dir);
    await first.approve(S2, now);
    const { provider } = scripted([FRESH]);
    await first.run({ ...S2, language: 'ta' }, deps(provider).run);

    const reloaded = new RewriteStore(dir);
    expect(await reloaded.list()).toEqual([
      {
        ...S2,
        approvedAt: FIXED.toISOString(),
        proposal: { text: FRESH, language: 'ta', overlaps: [], createdAt: FIXED.toISOString() },
        acceptedAt: null,
      },
    ]);
    const raw = await fs.readFile(path.join(dir, REWRITES_FILE), 'utf8');
    expect(raw).not.toContain(TEST_KEY);
    expect(raw).not.toMatch(/apiKey|key/i);
  });

  it('reads an unreadable file as empty and drops malformed entries', async () => {
    await fs.writeFile(path.join(dir, REWRITES_FILE), '{not json', 'utf8');
    expect(await new RewriteStore(dir).list()).toEqual([]);
    await fs.writeFile(
      path.join(dir, REWRITES_FILE),
      JSON.stringify({
        schemaVersion: 1,
        rewrites: [
          { urlPath: 'nope', sectionId: 's1' },
          { ...S2, approvedAt: 'x' },
        ],
      }),
      'utf8'
    );
    expect(await new RewriteStore(dir).list()).toEqual([{ ...S2, approvedAt: 'x', proposal: null, acceptedAt: null }]);
  });

  it('keeps concurrent approvals of different Sections', async () => {
    const store = new RewriteStore(dir);
    await Promise.all([store.approve(S2, now), store.approve({ urlPath: '/about', sectionId: 's1' }, now)]);
    expect((await store.list()).map((r) => r.sectionId).sort()).toEqual(['s1', 's2']);
  });
});
