/**
 * T-413 (ADR 0049): design variants per Layout Group. The real stage AI on a mock AI Provider, the fixture
 * audit, and an in-memory version folder.
 */
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { AIMessage, AuditResult, PageContent } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { resolveAuditAi, auditAiRequestBudget, type AuditAi } from '../src/audit/ai/stage-ai.js';
import {
  IMPROVE_INDEX_NAME,
  checkImproveBody,
  decodePng,
  findLogo,
  improveEstimate,
  improvePages,
  improvePriceFor,
  makeVariants,
  readImproveIndex,
  screenshotColours,
  variantFileName,
  type ImproveIo,
} from '../src/audit/improve/index.js';
import { emptyOverlay } from '../src/audit/documents/edits.js';
import { auditDocContents, auditDocResult, PATHS } from './helpers/audit-doc-fixture.js';

const SHOT = 'shots/home-phone.png';
const BRAND = [0x1a, 0x4d, 0x8c]; // #1a4d8c
const ACCENT = [0xe0, 0x6a, 0x10]; // #e06a10

/** An 8-bit RGB PNG: mostly white, a band of the brand colour and a smaller one of the accent. */
function png(width: number, height: number, pixel: (x: number, y: number) => number[]): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(y % 2); // filter 0 and 1 (Sub) in turn
    let prev = [0, 0, 0];
    for (let x = 0; x < width; x++) {
      const p = pixel(x, y);
      rows.push(...(y % 2 ? p.map((v, i) => (v - prev[i] + 256) & 0xff) : p));
      prev = p;
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.from(rows))),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

const SCREENSHOT = png(40, 40, (_x, y) => (y < 12 ? BRAND : y < 18 ? ACCENT : [255, 255, 255]));

function result(): AuditResult {
  const r = auditDocResult();
  r.pages = r.pages.map((p) =>
    p.urlPath === PATHS.home
      ? { ...p, phone: { findingIds: [], ...p.phone, screenshotPath: SHOT } as NonNullable<typeof p.phone> }
      : p
  );
  return r;
}

function contents(): PageContent[] {
  return auditDocContents().map((c) =>
    c.urlPath === PATHS.home
      ? { ...c, images: [{ src: '/img/logo.png', alt: 'Shop Example', sectionId: 's1' }, ...c.images] }
      : c
  );
}

function memoryIo(): ImproveIo & { files: Map<string, Uint8Array>; json: Map<string, unknown> } {
  const json = new Map<string, unknown>();
  const files = new Map<string, Uint8Array>([[SHOT, SCREENSHOT]]);
  const byPath = new Map(contents().map((c) => [c.urlPath, c]));
  return {
    files,
    json,
    readContent: async (urlPath) => byPath.get(urlPath) ?? null,
    readFile: async (name) => files.get(name) ?? null,
    writeFile: async (name, data) => void files.set(name, data),
    readJson: async (name) => json.get(name) ?? null,
    writeJson: async (name, value) => void json.set(name, JSON.parse(JSON.stringify(value))),
  };
}

/** The mock AI Provider: a page with the menu, a claim word to strip, and a cited change. */
function mockAi(answer?: (messages: AIMessage[]) => string, budget?: number) {
  const calls: AIMessage[][] = [];
  const provider: AIProvider = {
    providerType: 'mock',
    async generateText(messages) {
      calls.push(messages);
      return answer
        ? answer(messages)
        : '<header><nav><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a></nav></header>' +
            '<main><h1 data-section="s2">Fresh groceries, delivered</h1>' +
            '<p data-finding="AF-004">Order now from our shop. Fully compliant.</p></main>' +
            '<script>alert(1)</script>';
    },
  };
  const ai = async (): Promise<AuditAi> => {
    const resolved = await resolveAuditAi({
      setup: { provider: 'mock' },
      keys: { resolveKey: async () => ({ provider: 'mock', apiKey: 'mock-key', source: 'keychain' }) },
      createProvider: () => provider,
      ...(budget !== undefined ? { budget: auditAiRequestBudget(budget) } : {}),
    });
    if (!resolved.ok) throw new Error('no ai');
    return resolved.ai;
  };
  return { calls, ai };
}

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

describe('the pages of the Improved version', () => {
  it('are the homepage plus one Sample Page per Layout Group', () => {
    const pages = improvePages(result());
    expect(pages.map((p) => [p.key, p.urlPath, p.layoutGroup])).toEqual([
      ['home', PATHS.home, null],
      ['p-services', PATHS.services, 'content'],
    ]);
  });

  it('checks the create body against the listed pages only', () => {
    const pages = improvePages(result());
    expect(checkImproveBody({ pages: ['home'], variants: 6 }, pages)).toMatch(/1 to 5/);
    expect(checkImproveBody({ pages: ['../../etc'], variants: 1 }, pages)).toMatch(/not one of the pages/);
    expect(checkImproveBody({ pages: [], variants: 1 }, pages)).toMatch(/at least one page/);
    expect(checkImproveBody({ pages: ['home', 'p-services'], variants: 2, only: 1 }, pages)).toMatch(/one page/);
    expect(checkImproveBody({ pages: ['home'], variants: 2, extra: 1 }, pages)).toMatch(/Unknown field/);
    expect(checkImproveBody({ pages: ['home'], variants: 2, only: 2 }, pages)).toMatchObject({ only: 2, variants: 2 });
  });
});

describe('the brand', () => {
  it('reads the logo from the homepage Page Content', () => {
    const home = contents().find((c) => c.urlPath === PATHS.home)!;
    expect(findLogo(home, 'https://shop.example.in/')).toEqual({
      src: 'https://shop.example.in/img/logo.png',
      alt: 'Shop Example',
    });
    expect(findLogo(null, 'https://shop.example.in/')).toBeNull();
  });

  it('reads the main colours from the stored screenshot, white left out', () => {
    expect(decodePng(SCREENSHOT)).toMatchObject({ width: 40, height: 40 });
    expect(screenshotColours(SCREENSHOT)).toEqual(['#1a4d8c', '#e06a10']);
    expect(screenshotColours(new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(screenshotColours(null)).toEqual([]);
  });
});

describe('design variants (T-413)', () => {
  it('2 pages × 3 variants make 6 AI requests and store 6 sanitized pages with the brand colours', async () => {
    const io = memoryIo();
    const mock = mockAi();
    const r = result();
    const pages = improvePages(r);
    const estimate = improveEstimate(pages.length, 3, improvePriceFor('mock', null));
    const made = await makeVariants(
      { result: r, edits: emptyOverlay(), language: 'en', pages, variants: 3 },
      { io, ai: await mock.ai(), now: () => new Date('2026-11-19T10:00:00Z') }
    );

    expect(mock.calls).toHaveLength(6);
    expect(made.requests).toBe(6);
    expect(estimate).toEqual({ requests: made.requests, usd: 0 });
    expect(made.variants.map((v) => `${v.page}/${v.variant}/${v.style}/${v.status}`)).toEqual([
      'home/1/clean/made',
      'home/2/bold/made',
      'home/3/trust-first/made',
      'p-services/1/clean/made',
      'p-services/2/bold/made',
      'p-services/3/trust-first/made',
    ]);
    for (const v of made.variants) {
      const html = text(io.files.get(variantFileName(v.page, v.variant)));
      expect(html, v.page).toContain('<!DOCTYPE html>');
      expect(html).not.toMatch(/<script|alert\(1\)/i);
      expect(html).not.toMatch(/compliant/i);
      expect(html).toContain('#1a4d8c');
      expect(html).toContain('href="https://shop.example.in/about"');
      expect(html).toContain('data-finding="AF-004"');
      expect(v.cites).toEqual(['s2', 'AF-004']);
    }
    expect(text(io.files.get(variantFileName('p-services', 1)))).toContain('the page /services of shop.example.in');

    const index = await readImproveIndex(io, 1, 'en');
    expect(index.variants).toHaveLength(6);
    expect((io.json.get(IMPROVE_INDEX_NAME) as { variants: unknown[] }).variants).toHaveLength(6);
  });

  it('each variant asks for its own design direction, the brand and cited changes, in the audit language', async () => {
    const io = memoryIo();
    const mock = mockAi();
    const r = result();
    await makeVariants(
      { result: r, edits: emptyOverlay(), language: 'ta', pages: improvePages(r).slice(1), variants: 2 },
      { io, ai: await mock.ai() }
    );
    const systems = mock.calls.map((m) => m[0]!.content);
    expect(systems[0]).toMatch(/one website page/);
    expect(systems.some((s) => /"clean"/.test(s))).toBe(true);
    expect(systems.some((s) => /"bold"/.test(s))).toBe(true);
    for (const s of systems) {
      expect(s).toContain('#1a4d8c');
      expect(s).toContain('https://shop.example.in/img/logo.png');
      expect(s).toMatch(/data-finding="<finding id>"/);
      expect(s).toMatch(/Tamil|தமிழ்/);
    }
    const data = mock.calls[0]![1]!.content;
    expect(data).toContain('"id":"AF-001"');
    expect(data).not.toContain('AF-004'); // another page's finding
  });

  it('"Try again" makes one request for one variant and keeps the others in the index', async () => {
    const io = memoryIo();
    const r = result();
    const pages = improvePages(r);
    const first = mockAi();
    await makeVariants(
      { result: r, edits: emptyOverlay(), language: 'en', pages: [pages[0]!], variants: 3 },
      { io, ai: await first.ai() }
    );
    const again = mockAi();
    const made = await makeVariants(
      { result: r, edits: emptyOverlay(), language: 'en', pages: [pages[0]!], variants: 3, only: 2 },
      { io, ai: await again.ai() }
    );
    expect(again.calls).toHaveLength(1);
    expect(made.requests).toBe(1);
    expect(made.index.variants.map((v) => v.variant)).toEqual([1, 2, 3]);
  });

  it('a spent AI Request Budget stops the batch without more requests', async () => {
    const io = memoryIo();
    const mock = mockAi(undefined, 2);
    const r = result();
    const made = await makeVariants(
      { result: r, edits: emptyOverlay(), language: 'en', pages: improvePages(r), variants: 3 },
      { io, ai: await mock.ai() }
    );
    expect(mock.calls).toHaveLength(2);
    expect(made.requests).toBe(2);
    expect(made.variants.filter((v) => v.problem === 'budget-spent')).toHaveLength(4);
  });

  it('an empty answer is a failed variant, not a template page', async () => {
    const io = memoryIo();
    const mock = mockAi(() => '   ');
    const r = result();
    const made = await makeVariants(
      { result: r, edits: emptyOverlay(), language: 'en', pages: [improvePages(r)[0]!], variants: 1 },
      { io, ai: await mock.ai() }
    );
    expect(made.variants).toEqual([expect.objectContaining({ status: 'failed', problem: 'failed' })]);
    expect(io.files.has(variantFileName('home', 1))).toBe(false);
  });

  it('the estimate is pages × variants, priced when the model price is known', () => {
    expect(improveEstimate(2, 3, null)).toEqual({ requests: 6, usd: null });
    const usd = improvePriceFor('anthropic', 'claude-sonnet-5-5')!;
    expect(usd).toBeCloseTo((8000 * 2 + 6000 * 10) / 1e6);
    expect(improveEstimate(2, 3, usd).usd).toBeCloseTo(6 * usd);
    expect(improvePriceFor('openrouter', 'x/y')).toBeNull();
  });
});
