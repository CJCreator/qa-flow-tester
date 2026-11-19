/**
 * T-419: copy variants in batches. A memory store and a fake AI provider behind the real stage AI.
 */
import { describe, it, expect } from 'vitest';
import type { AIMessage, PageContent } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { auditAiRequestBudget, resolveAuditAi } from '../src/audit/ai/stage-ai.js';
import { RewriteStore, type RewriteStoreBackend } from '../src/audit/ai/rewrite-store.js';

const ORIGINALS = [
  'Fresh bread baked every morning in our family kitchen near the market.',
  'Call us to order cakes for birthdays and weddings across the city.',
  'Our bakers have worked with local farms for many years now.',
  'Visit the shop on weekdays for warm buns and sweet treats.',
  'We deliver large orders to offices and schools on request.',
  'Ask about gluten free loaves made in a separate oven every week.',
];

function page(): PageContent {
  let text = '';
  const sections = ORIGINALS.map((t, i) => {
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
    language: { primary: 'en', others: [], declared: 'en' },
    sections,
  };
}

function memoryStore(): RewriteStoreBackend {
  const files = new Map<string, unknown>();
  return {
    async readVersionJson<T>(_a: string, _v: number, name: string) {
      return (files.get(name) as T) ?? null;
    },
    async writeVersionJson(_a: string, _v: number, name: string, value: unknown) {
      files.set(name, JSON.parse(JSON.stringify(value)));
    },
  } as RewriteStoreBackend;
}

/** Answers each request with 2 fresh drafts per part, matched by the ids it was sent. */
function provider(copyFor?: string) {
  const requests: AIMessage[][] = [];
  const p: AIProvider = {
    providerType: 'mock',
    async generateText(messages) {
      requests.push(messages);
      const user = messages[1].content as string;
      const parts = JSON.parse(user.slice(user.indexOf('['))) as Array<{ id: string; original: string }>;
      return JSON.stringify({
        drafts: parts.reverse().map((part) => ({
          id: part.id,
          variants:
            part.original === copyFor
              ? [part.original, 'A short new line about the shop.']
              : [`New wording number one for ${part.id}.`, `Second fresh take for ${part.id}.`],
        })),
      });
    },
  };
  return { p, requests };
}

const SECTIONS = ORIGINALS.map((_, i) => ({ urlPath: '/about', sectionId: `s${i + 1}` }));

async function setup(copyFor?: string) {
  const store = new RewriteStore(memoryStore(), 'audit-1', 1);
  const { p, requests } = provider(copyFor);
  const budget = auditAiRequestBudget();
  const deps = {
    language: 'en' as const,
    contentFor: () => page(),
    resolveAi: () =>
      resolveAuditAi({
        setup: { provider: 'mock' },
        keys: { resolveKey: async () => ({ provider: 'mock' as const, apiKey: 'test-only', source: 'env' as const }) },
        budget,
        createProvider: () => p,
      }),
  };
  return { store, requests, budget, deps };
}

describe('copy variants in batches', () => {
  it('approving 5 Sections gives 10 drafts from 1 call', async () => {
    const { store, requests, budget, deps } = await setup();
    const five = SECTIONS.slice(0, 5);
    const approved = await store.approveMany(five);
    expect(approved.every((r) => r.ok)).toBe(true);
    const results = await store.runBatch(five, deps);
    expect(requests).toHaveLength(1);
    expect(budget.used).toBe(1);
    const drafts = results.flatMap((r) => (r.ok ? (r.rewrite.proposal?.variants ?? []) : []));
    expect(drafts).toHaveLength(10);
    // Matched by id, not by position: the fake answers in reverse order.
    results.forEach((r, i) => {
      expect(r.ok && r.rewrite.sectionId).toBe(`s${i + 1}`);
      expect(r.ok && r.rewrite.proposal?.text).toBe(`New wording number one for p${i + 1}.`);
    });
  });

  it('6 Sections make 2 calls; an unapproved Section is refused and never sent', async () => {
    const { store, requests, deps } = await setup();
    await store.approveMany(SECTIONS.slice(0, 5));
    await store.approveMany([SECTIONS[5]]);
    const results = await store.runBatch([...SECTIONS], deps);
    expect(requests).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);

    const fresh = await setup();
    await fresh.store.approveMany(SECTIONS.slice(0, 2));
    const mixed = await fresh.store.runBatch(SECTIONS.slice(0, 3), fresh.deps);
    expect(mixed[2]).toMatchObject({ ok: false, code: 'ERR_NOT_APPROVED' });
    expect(fresh.requests).toHaveLength(1);
    expect(fresh.requests[0][1].content).not.toContain(ORIGINALS[2]);
  });

  it('a draft that copies the original fails with ERR_OVERLAP when accepted', async () => {
    const { store, deps } = await setup(ORIGINALS[0]);
    await store.approveMany([SECTIONS[0]]);
    const [result] = await store.runBatch([SECTIONS[0]], deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [copied, fresh] = result.rewrite.proposal!.variants!;
    expect(copied.overlaps.length).toBeGreaterThan(0);
    const refused = await store.accept({ ...SECTIONS[0], text: copied.text }, { content: page() });
    expect(refused).toMatchObject({ ok: false, code: 'ERR_OVERLAP' });
    const accepted = await store.accept({ ...SECTIONS[0], text: fresh.text }, { content: page() });
    expect(accepted.ok).toBe(true);
  });

  it('without a key nothing is sent', async () => {
    const store = new RewriteStore(memoryStore(), 'audit-1', 1);
    await store.approveMany([SECTIONS[0]]);
    const results = await store.runBatch([SECTIONS[0]], {
      language: 'en',
      contentFor: () => page(),
      resolveAi: async () => ({ ok: false, reason: 'no-ai-key' }),
    });
    expect(results[0]).toMatchObject({ ok: false, code: 'ERR_NO_AI_KEY' });
  });
});
