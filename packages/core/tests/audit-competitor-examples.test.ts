/**
 * T-418: competitor examples beside the top findings, and competitor facts as optional variant input. The real
 * stage AI on a mock provider; an in-memory version folder.
 */
import { describe, expect, it } from 'vitest';
import type { AIMessage, CompetitorPageFacts, CompetitorsState } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { resolveAuditAi } from '../src/audit/ai/stage-ai.js';
import {
  competitorExamples,
  competitorIdeas,
  competitorTexts,
  copiesCompetitor,
} from '../src/audit/competitors/examples.js';
import { improvePages, makeVariants, variantFileName, type ImproveIo } from '../src/audit/improve/index.js';
import { emptyOverlay } from '../src/audit/documents/edits.js';
import { auditDocContents, auditDocResult } from './helpers/audit-doc-fixture.js';

const COPIED_HEADING = 'Fresh vegetables picked this morning and delivered to your door';

function facts(urlPath: string, pageType: CompetitorPageFacts['pageType'], extra: Partial<CompetitorPageFacts> = {}) {
  return {
    urlPath,
    pageType,
    title: null,
    sections: [],
    ctas: [],
    trustSignals: [],
    contactOptions: [],
    speedMs: 100,
    ...extra,
  } as CompetitorPageFacts;
}

const STATE: CompetitorsState = {
  version: 1,
  discoveredAt: '2026-11-19T10:00:00.000Z',
  candidates: [],
  sites: [
    {
      url: 'https://green.example',
      host: 'green.example',
      reason: '',
      status: 'read',
      pages: [
        facts('/', 'home', { sections: [COPIED_HEADING], ctas: ['Order today'], trustSignals: ['testimonials'] }),
        facts('/contact', 'contact', { contactOptions: ['phone', 'whatsapp'] }),
      ],
    },
    { url: 'https://closed.example', host: 'closed.example', reason: '', status: 'not-read', pages: [] },
  ],
};

describe('competitor examples', () => {
  it('cite the competitor and the page, and state only what was seen', () => {
    const examples = competitorExamples(
      [
        { id: 'AF-001', rule: 'click-to-call', urlPath: '/contact' },
        { id: 'AF-002', rule: 'trust-signals', urlPath: '/' },
        { id: 'AF-003', rule: 'ctas', urlPath: '/' },
        { id: 'AF-004', rule: 'ctas', urlPath: '/pricing' },
      ],
      STATE
    );
    expect(examples.get('AF-001')).toEqual([
      {
        findingId: 'AF-001',
        host: 'green.example',
        urlPath: '/contact',
        text: 'green.example shows a phone link, a WhatsApp link on /contact',
      },
    ]);
    expect(examples.get('AF-002')![0].text).toBe('green.example shows testimonials on /');
    expect(examples.get('AF-003')![0].text).toBe('green.example shows the call to action “Order today” on /');
    // No pricing page was read: no example, and the site not read never appears.
    expect(examples.has('AF-004')).toBe(false);
    for (const list of examples.values()) {
      for (const e of list) {
        expect(e.text).toContain(e.host);
        expect(e.text).toContain(e.urlPath);
        expect(e.text).not.toMatch(/score|better|worse|best/i);
      }
    }
    expect(competitorIdeas(examples)[0]).toContain('cite as green.example/contact');
  });

  it('a text that copies a competitor sentence fails the overlap check', () => {
    const texts = competitorTexts(STATE);
    expect(copiesCompetitor(`Welcome! ${COPIED_HEADING}.`, texts).length).toBeGreaterThan(0);
    expect(copiesCompetitor('Vegetables from local farms, at your home by noon.', texts)).toEqual([]);
  });
});

describe('competitor facts as variant input', () => {
  function io(): ImproveIo & { files: Map<string, Uint8Array> } {
    const files = new Map<string, Uint8Array>();
    const json = new Map<string, unknown>();
    const byPath = new Map(auditDocContents().map((c) => [c.urlPath, c]));
    return {
      files,
      readContent: async (p) => byPath.get(p) ?? null,
      readFile: async (n) => files.get(n) ?? null,
      writeFile: async (n, d) => void files.set(n, d),
      readJson: async (n) => json.get(n) ?? null,
      writeJson: async (n, v) => void json.set(n, JSON.parse(JSON.stringify(v))),
    };
  }

  async function aiAnswering(heading: string) {
    const calls: AIMessage[][] = [];
    const provider: AIProvider = {
      providerType: 'mock',
      async generateText(messages) {
        calls.push(messages);
        return (
          '<header><nav><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a></nav></header>' +
          `<main><h1 data-section="s2">${heading}</h1></main>`
        );
      },
    };
    const resolved = await resolveAuditAi({
      setup: { provider: 'mock' },
      keys: { resolveKey: async () => ({ provider: 'mock', apiKey: 'mock-key', source: 'keychain' }) },
      createProvider: () => provider,
    });
    if (!resolved.ok) throw new Error('no ai');
    return { ai: resolved.ai, calls };
  }

  const competitor = {
    ideas: competitorIdeas(competitorExamples([{ id: 'AF-001', rule: 'ctas', urlPath: '/' }], STATE)),
    texts: competitorTexts(STATE),
  };

  it('a variant that copies a competitor sentence is not stored', async () => {
    const r = auditDocResult();
    const home = improvePages(r).filter((p) => p.key === 'home');
    const store = io();
    const { ai, calls } = await aiAnswering(COPIED_HEADING);
    const made = await makeVariants(
      { result: r, edits: emptyOverlay(), language: 'en', pages: home, variants: 1, competitor },
      { io: store, ai, fetchImage: async () => null, scanAxe: async () => ({ blockers: 0 }) }
    );
    expect(made.variants[0]).toMatchObject({ status: 'failed', problem: 'failed' });
    expect(store.files.has(variantFileName('home', 1))).toBe(false);
    // The borrowed ideas reached the prompt, cited by site and page.
    expect(JSON.stringify(calls[0])).toContain('cite as green.example/');
  });

  it('a variant in its own words is made', async () => {
    const r = auditDocResult();
    const home = improvePages(r).filter((p) => p.key === 'home');
    const store = io();
    const { ai } = await aiAnswering('Your weekly vegetables, from our farm partners');
    const made = await makeVariants(
      { result: r, edits: emptyOverlay(), language: 'en', pages: home, variants: 1, competitor },
      { io: store, ai, fetchImage: async () => null, scanAxe: async () => ({ blockers: 0 }) }
    );
    expect(made.variants[0].status).toBe('made');
  });
});
