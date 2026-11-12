/**
 * BE-605 (REQ-024): the improved-homepage preview generator. A fake AI Provider behind the real stage AI
 * (resolveAuditAi), so the 'preview' stage model and the timeout are what a real request would carry.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { AICompletionOptions, AIMessage, AIProviderType } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { resolveAuditAi, type AuditAi } from '../src/audit/ai/stage-ai.js';
import { emptyOverlay } from '../src/audit/documents/edits.js';
import { labelsFor } from '../src/audit/documents/labels/index.js';
import {
  generatePreview,
  previewFacts,
  previewMessages,
  PREVIEW_AI_TIMEOUT_MS,
  PREVIEW_IMAGE_MAX_BYTES,
  type PreviewImageFetch,
  type PreviewInput,
} from '../src/audit/preview/index.js';
import { buildTemplateHtml } from '../src/audit/preview/template.js';
import { findClaimWords } from '../src/audit/ai/claim-words.js';
import { makeOutboundFetch, type NetDeps, type PinnedRequest } from '../src/safe-net.js';
import { auditDocContents, auditDocResult, PATHS } from './helpers/audit-doc-fixture.js';

const TEST_KEY = 'test-key-not-real';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** The AI's page: the About menu link only (Services left out), an in-page link, the hero image. */
const AI_PAGE = `\`\`\`html
<header><nav><a href="/about">About us</a></nav></header>
<main>
  <h1 id="top">Fresh groceries, delivered today</h1>
  <p><a href="#offers">See offers</a> <a href="#nowhere">Broken</a></p>
  <img src="/img/hero.jpg" alt="Fresh vegetables">
  <img src="/img/not-listed.png" alt="Unlisted picture">
  <img src="https://cdn.other.example/x.png" alt="Other host picture">
  <section id="offers"><h2>Offers</h2><p>Order before 6 pm.</p></section>
</main>
\`\`\``;

function fakeAi(answers: Array<string | Error>, models: Record<string, string> = { preview: 'preview/model-x' }) {
  const calls: Array<{ messages: AIMessage[]; options: AICompletionOptions }> = [];
  let n = 0;
  const provider: AIProvider = {
    providerType: 'openrouter',
    async generateText(messages, options) {
      calls.push({ messages, options: options ?? {} });
      const answer = answers[Math.min(n++, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return {
    calls,
    async ai(): Promise<AuditAi> {
      const resolved = await resolveAuditAi({
        setup: { provider: 'openrouter', text: 'default/text', vision: 'default/vision' },
        keys: {
          resolveKey: async () => ({
            provider: 'openrouter' as AIProviderType,
            apiKey: TEST_KEY,
            source: 'keychain' as const,
          }),
        },
        models,
        createProvider: () => provider,
      });
      if (!resolved.ok) throw new Error('no key');
      return resolved.ai;
    },
  };
}

function input(overrides: Partial<PreviewInput> = {}): PreviewInput {
  const home = auditDocContents().find((c) => c.urlPath === PATHS.home)!;
  return { result: auditDocResult(), home, edits: emptyOverlay(), language: 'en', ...overrides };
}

function pngFetch(): { fetchImage: PreviewImageFetch; urls: string[] } {
  const urls: string[] = [];
  const fetchImage: PreviewImageFetch = async (url) => {
    urls.push(url);
    return { status: 200, headers: { 'content-type': 'image/png' }, bytes: async () => PNG };
  };
  return { fetchImage, urls };
}

function anchors(html: string): Array<{ tag: string; href: string | null }> {
  return (html.match(/<a\b[^>]*>/g) ?? []).map((tag) => ({ tag, href: /\shref="([^"]*)"/.exec(tag)?.[1] ?? null }));
}

describe('preview generator', () => {
  it("REQ-039: one request on the 'preview' stage, with its chosen model and a timeout", async () => {
    const fake = fakeAi([AI_PAGE]);
    const out = await generatePreview(input(), { ai: await fake.ai() });
    expect(out.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].options.stage).toBe('preview');
    expect(fake.calls[0].options.model).toBe('preview/model-x');
    expect(fake.calls[0].options.timeoutMs).toBe(PREVIEW_AI_TIMEOUT_MS);
  });

  it('the prompt carries the homepage, its menu links and edits as data, and the API key never', async () => {
    const edits = {
      ...emptyOverlay(),
      sections: [
        {
          urlPath: PATHS.home,
          sectionId: 's2',
          text: 'Groceries at your door by evening.',
          by: 'person' as const,
          editedAt: '2026-11-03T00:00:00.000Z',
        },
      ],
    };
    const messages = previewMessages(previewFacts(input({ edits })));
    const all = messages.map((m) => m.content).join('\n');
    expect(all).toContain('https://shop.example.in/about');
    expect(all).toContain('https://shop.example.in/services');
    expect(all).toContain('Groceries at your door by evening.');
    expect(all).toContain('untrusted');
    expect(all).not.toContain(TEST_KEY);
  });

  it('REQ-024 AC-1: every homepage menu link is a working absolute link opening in a new tab', async () => {
    const fake = fakeAi([AI_PAGE]);
    const out = await generatePreview(input(), { ai: await fake.ai() });
    if (!out.ok) throw new Error(out.problem);
    const links = anchors(out.html);
    const menu = auditDocResult().hierarchy.links.filter((l) => l.region === 'menu' && l.from === PATHS.home);
    expect(menu.length).toBeGreaterThan(1);
    for (const link of menu) {
      const href = new URL(link.to, 'https://shop.example.in/').href;
      const found = links.find((a) => a.href === href);
      expect(found, href).toBeDefined();
      expect(found!.tag).toContain('target="_blank"');
      expect(found!.tag).toContain('rel="noopener noreferrer"');
    }
    // Every in-page link points to an id that exists.
    const ids = new Set([...out.html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const inPage = links.filter((a) => a.href?.startsWith('#'));
    expect(inPage.map((a) => a.href)).toEqual(['#offers']);
    for (const a of inPage) expect(ids.has(a.href!.slice(1))).toBe(true);
  });

  it('inlines listed homepage images through the injected fetch; others keep their alt text', async () => {
    const fake = fakeAi([AI_PAGE]);
    const { fetchImage, urls } = pngFetch();
    const out = await generatePreview(input(), { ai: await fake.ai(), fetchImage });
    if (!out.ok) throw new Error(out.problem);
    expect(urls).toEqual(['https://shop.example.in/img/hero.jpg']);
    expect(out.html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="Fresh vegetables">/);
    expect(out.html).toContain('Unlisted picture');
    expect(out.html).toContain('Other host picture');
    expect(out.html.match(/<img\b/g)).toHaveLength(1);
  });

  it('a refused, failed or non-image answer leaves the alt text', async () => {
    const answers: Array<Awaited<ReturnType<PreviewImageFetch>> | Error> = [
      null,
      new Error('network'),
      { status: 200, headers: {}, bytes: async () => new TextEncoder().encode('<svg onload=alert(1)>') },
      { status: 404, headers: {}, bytes: async () => PNG },
      { status: 200, headers: {} }, // no bytes (a text-only fetch)
    ];
    for (const answer of answers) {
      const fake = fakeAi([AI_PAGE]);
      const fetchImage: PreviewImageFetch = vi.fn(async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      });
      const out = await generatePreview(input(), { ai: await fake.ai(), fetchImage });
      if (!out.ok) throw new Error(out.problem);
      expect(out.html).not.toMatch(/<img\b/);
      expect(out.html).toContain('Fresh vegetables');
    }
  });

  it('the page says it is a preview of suggested changes, with no verdict and no claim words', async () => {
    const fake = fakeAi([AI_PAGE]);
    const out = await generatePreview(input(), { ai: await fake.ai() });
    if (!out.ok) throw new Error(out.problem);
    expect(out.html).toContain('Preview of suggested changes');
    expect(out.html).not.toMatch(/\b(compliant|compliance|certified|secure|safe|hack-proof)\b/i);
    expect(out.html).not.toMatch(
      /Ready to release|Not ready yet|release verdict|release-ready|passes WCAG|fully accessible/i
    );
  });

  it('claim words: one retry that names them; the clean retry is kept', async () => {
    const fake = fakeAi(['<h1>Secure checkout, fully accessible</h1>', AI_PAGE]);
    const out = await generatePreview(input(), { ai: await fake.ai() });
    expect(out.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1].messages.at(-1)?.content).toMatch(/secure/i);
    expect(out.source).toBe('ai');
    expect(out.problem).toBeUndefined();
  });

  it('claim words in both answers: falls back to template text without claim words', async () => {
    const fake = fakeAi(['<p>Certified and safe</p>']);
    const out = await generatePreview(input(), { ai: await fake.ai() });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected ok');
    expect(out.html).toContain('Preview of suggested changes');
    expect(out.html).not.toContain('Certified');
    expect(out.html).not.toContain('safe');
    expect(out.html).toContain('href="https://shop.example.in/about"');
    expect(out.source).toBe('template');
    expect(out.problem).toBe('claim-words');
  });

  it('a failed or empty AI answer falls back to template text with no provider text', async () => {
    const failing = fakeAi([new Error('upstream said: secret detail')]);
    const failedOut = await generatePreview(input(), { ai: await failing.ai() });
    expect(failedOut.ok).toBe(true);
    if (!failedOut.ok) throw new Error('expected ok');
    expect(failedOut.html).not.toContain('secret detail');
    expect(failedOut.html).toContain('href="https://shop.example.in/about"');
    expect(failedOut.source).toBe('template');
    expect(failedOut.problem).toBe('failed');

    const empty = fakeAi(['   ']);
    const emptyOut = await generatePreview(input(), { ai: await empty.ai() });
    expect(emptyOut.ok).toBe(true);
    if (!emptyOut.ok) throw new Error('expected ok');
    expect(emptyOut.html).toContain('href="https://shop.example.in/about"');
    expect(emptyOut.source).toBe('template');
    expect(emptyOut.problem).toBe('failed');
  });

  it('no AI provided: builds preview copy from findings and Page Content (ADR 0018 template)', async () => {
    const out = await generatePreview(input(), {});
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected ok');
    expect(out.html).toContain('Preview of suggested changes');
    expect(out.html).toContain('href="https://shop.example.in/about"');
    expect(out.html).toContain(labelsFor('en').labels.headings.topIssues);
    expect(out.source).toBe('template');
    expect(out.problem).toBeUndefined();
  });

  it('the template filters claim words from menu text and keeps no reserved names', async () => {
    const base = input();
    const withMenu: PreviewInput = {
      ...base,
      result: {
        ...base.result,
        hierarchy: {
          ...base.result.hierarchy,
          links: [
            ...base.result.hierarchy.links,
            {
              from: PATHS.home,
              to: 'https://shop.example.in/checkout',
              text: 'Secure checkout',
              region: 'menu',
            },
          ],
        },
      },
    };
    const out = await generatePreview(withMenu, {});
    expect(findClaimWords(out.html)).toEqual([]);
    expect(out.html).toContain('href="https://shop.example.in/checkout"');
    expect(out.html).not.toMatch(/id="qa-preview-(actions|suggestions|gallery)"|class="qa-preview-lead"/);
  });

  it('the template uses the document language for its headings', () => {
    const html = buildTemplateHtml({ ...previewFacts(input()), language: 'ta' });
    expect(html).toContain(labelsFor('ta').labels.headings.topIssues);
    expect(html).not.toContain('Suggested improvements');
    expect(html).not.toContain('Actions');
    expect(html).not.toContain('Site menu');
    expect(html).not.toContain('Welcome');
  });

  it('a menu link the AI left out keeps its link but loses its claim words', async () => {
    const base = input();
    const withMenu: PreviewInput = {
      ...base,
      result: {
        ...base.result,
        hierarchy: {
          ...base.result.hierarchy,
          links: [
            {
              from: PATHS.home,
              to: 'https://shop.example.in/bakers',
              text: 'Certified bakers',
              region: 'menu',
            },
          ],
        },
      },
    };
    const fake = fakeAi(['<main><h1>Hello</h1></main>']);
    const out = await generatePreview(withMenu, { ai: await fake.ai() });
    expect(out.source).toBe('ai');
    expect(out.html).toContain('href="https://shop.example.in/bakers"');
    expect(out.html).not.toContain('Certified');
    expect(findClaimWords(out.html)).toEqual([]);
  });

  it('works without stored homepage content: the menu links still appear', async () => {
    const fake = fakeAi(['<h1>Welcome</h1>']);
    const out = await generatePreview(input({ home: null }), { ai: await fake.ai() });
    if (!out.ok) throw new Error(out.problem);
    expect(out.html).toContain('href="https://shop.example.in/about"');
    expect(out.html).toContain('href="https://shop.example.in/services"');
  });
});

describe('preview images through the real makeOutboundFetch (BE-101), network faked at NetDeps', () => {
  /** A real PNG header plus binary bytes that are not valid UTF-8, so a text round-trip would corrupt them. */
  const BINARY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x80, 0x00, 0xc3, 0x28]);

  /** Behaves like safe-net's defaultConnect: the body is cut and flagged tooLarge over req.maxBytes. */
  function netDeps(body: Buffer) {
    const connects: PinnedRequest[] = [];
    const deps: NetDeps = {
      async lookup(host) {
        if (host !== 'shop.example.in') throw new Error('ENOTFOUND');
        return ['93.184.216.34'];
      },
      async connect(req) {
        connects.push(req);
        if (body.length > req.maxBytes) {
          const cut = body.subarray(0, req.maxBytes);
          return {
            status: 200,
            headers: { 'content-type': 'image/png' },
            body: cut.toString('utf8'),
            raw: cut,
            tooLarge: true,
          };
        }
        return { status: 200, headers: { 'content-type': 'image/png' }, body: body.toString('utf8'), raw: body };
      },
    };
    return { deps, connects };
  }

  it('a same-site PNG is inlined as a data: image with its exact bytes', async () => {
    const net = netDeps(BINARY_PNG);
    const fetchImage = makeOutboundFetch({ deps: net.deps, maxBytes: PREVIEW_IMAGE_MAX_BYTES, timeoutMs: 8_000 });
    const fake = fakeAi([AI_PAGE]);
    const out = await generatePreview(input(), { ai: await fake.ai(), fetchImage });
    if (!out.ok) throw new Error(out.problem);
    expect(net.connects.map((c) => c.url.toString())).toEqual(['https://shop.example.in/img/hero.jpg']);
    expect(net.connects[0].maxBytes).toBe(PREVIEW_IMAGE_MAX_BYTES);
    expect(out.html).toContain(
      `<img src="data:image/png;base64,${BINARY_PNG.toString('base64')}" alt="Fresh vegetables">`
    );
  });

  it('the byte cap is honoured: an image over it is not inlined and keeps its alt text', async () => {
    const big = Buffer.concat([BINARY_PNG, Buffer.alloc(64, 0x41)]);
    const net = netDeps(big);
    const fetchImage = makeOutboundFetch({ deps: net.deps, maxBytes: 32, timeoutMs: 8_000 });
    const fake = fakeAi([AI_PAGE]);
    const out = await generatePreview(input(), { ai: await fake.ai(), fetchImage });
    if (!out.ok) throw new Error(out.problem);
    expect(net.connects).toHaveLength(1);
    expect(net.connects[0].maxBytes).toBe(32);
    expect(out.html).not.toMatch(/<img\b/);
    expect(out.html).not.toContain('data:image');
    expect(out.html).toContain('Fresh vegetables');
  });

  it('an image larger than the preview cap is left out even when the fetch cap allows it', async () => {
    const big = Buffer.concat([BINARY_PNG, Buffer.alloc(PREVIEW_IMAGE_MAX_BYTES, 0x41)]);
    const net = netDeps(big);
    const fetchImage = makeOutboundFetch({ deps: net.deps, maxBytes: PREVIEW_IMAGE_MAX_BYTES * 2 });
    const fake = fakeAi([AI_PAGE]);
    const out = await generatePreview(input(), { ai: await fake.ai(), fetchImage });
    if (!out.ok) throw new Error(out.problem);
    expect(out.html).not.toMatch(/<img\b/);
    expect(out.html).toContain('Fresh vegetables');
  });

  it('a host that does not resolve leaves the alt text (no request made)', async () => {
    const net = netDeps(BINARY_PNG);
    const fetchImage = makeOutboundFetch({
      deps: { ...net.deps, lookup: async () => Promise.reject(new Error('ENOTFOUND')) },
    });
    const fake = fakeAi([AI_PAGE]);
    const out = await generatePreview(input(), { ai: await fake.ai(), fetchImage });
    if (!out.ok) throw new Error(out.problem);
    expect(net.connects).toHaveLength(0);
    expect(out.html).not.toMatch(/<img\b/);
    expect(out.html).toContain('Fresh vegetables');
  });

  it('the template removes a claim written across a line break', () => {
    const facts = previewFacts(input());
    facts.sections = [
      { id: 's1', kind: 'section', heading: 'Our shop passes\nWCAG checks', text: 'Our shop passes\nWCAG checks' },
    ];
    const html = buildTemplateHtml(facts);
    expect(findClaimWords(html)).toEqual([]);
  });
});

describe('preview sources', () => {
  it('no direct fetch or Playwright request API in the preview code', () => {
    const dir = path.resolve(__dirname, '../src/audit/preview');
    for (const file of readdirSync(dir)) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      expect(source, file).not.toMatch(
        /(^|[^.\w$])fetch\s*\(|globalThis\.fetch|from\s+['"](?:undici|node-fetch|playwright)['"]/
      );
      expect(source, file).not.toMatch(/\.request\.(get|post|fetch)\s*\(|APIRequestContext/);
    }
  });
});
