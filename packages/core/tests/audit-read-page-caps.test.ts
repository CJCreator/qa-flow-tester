import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import { readPage } from '../src/audit/analysis/read-page.js';
import {
  capRawPage,
  RAW_LIST_CAP,
  RAW_ITEM_TEXT_CAP,
  type RawPage,
  type RawMenuItem,
} from '../src/audit/analysis/raw-page.js';

function countMenuItems(items: RawMenuItem[]): number {
  let count = 0;
  for (const item of items) {
    count += 1 + countMenuItems(item.children ?? []);
  }
  return count;
}

function makeBigFacts() {
  const longText = 'a'.repeat(5000);
  const chunkText = 'b'.repeat(50000);
  return {
    title: 'Test Shop',
    description: 'Test description',
    lang: 'en',
    textChunks: [{ text: chunkText, boundary: { kind: 'heading' as const, heading: longText } }],
    headings: Array.from({ length: 2000 }, (_, i) => ({
      level: 2,
      text: `Heading ${i} ${longText}`,
      chunk: 0,
    })),
    images: Array.from({ length: 2000 }, (_, i) => ({
      src: `/img${i}.jpg`,
      alt: `Image ${i} ${longText}`,
      chunk: 0,
    })),
    anchors: Array.from({ length: 2000 }, (_, i) => ({
      href: `/page${i}`,
      text: `Link ${i}`,
      region: 'internal' as const,
      chunk: 0,
    })),
    contactLinks: [],
    forms: [],
    ctaCandidates: [],
    metaGenerator: null,
    scripts: [],
    stylesheets: [],
    iframes: [],
    jsonLd: [],
    socialMetaKeys: [],
    frameworkMarkers: [],
    addresses: [],
    menu: [],
    breadcrumb: [],
  };
}

function makeFakePage(facts: ReturnType<typeof makeBigFacts>): Page {
  return {
    evaluate: async () => facts,
    url: () => 'https://shop.example/',
  } as unknown as Page;
}

describe('readPage caps', () => {
  it('caps every list and every item text', async () => {
    const facts = makeBigFacts();
    const page = makeFakePage(facts);
    const result = await readPage(page);

    expect(result.raw.anchors.length).toBe(RAW_LIST_CAP);
    for (const h of result.raw.headings) {
      expect(h.text.length).toBeLessThanOrEqual(RAW_ITEM_TEXT_CAP);
    }
    expect(result.content.links.length).toBeLessThanOrEqual(RAW_LIST_CAP);
  });

  it('keeps the text in the Page Content only', async () => {
    const facts = makeBigFacts();
    const page = makeFakePage(facts);
    const result = await readPage(page);

    expect(result.raw.textChunks).toEqual([]);
    expect(result.content.text.length).toBe(50000);
  });

  describe('capRawPage', () => {
    it('keeps RAW_LIST_CAP in total for a menu of 3 levels with 1,000 items', () => {
      // 10 level-1 items, each with 10 level-2 items, each with 9 level-3 items = 10 + 100 + 900 = 1010 items
      const menu: RawMenuItem[] = Array.from({ length: 10 }, (_, i) => ({
        text: `Menu L1 ${i}`,
        href: `/l1-${i}`,
        children: Array.from({ length: 10 }, (_, j) => ({
          text: `Menu L2 ${i}-${j}`,
          href: `/l1-${i}/l2-${j}`,
          children: Array.from({ length: 9 }, (_, k) => ({
            text: `Menu L3 ${i}-${j}-${k}`,
            href: `/l1-${i}/l2-${j}/l3-${k}`,
            children: [],
          })),
        })),
      }));

      expect(countMenuItems(menu)).toBe(1010);

      const raw: RawPage = {
        url: 'https://shop.example/',
        title: null,
        description: null,
        lang: null,
        textChunks: [],
        headings: [],
        images: [],
        anchors: [],
        contactLinks: [],
        forms: [],
        ctaCandidates: [],
        metaGenerator: null,
        scripts: [],
        stylesheets: [],
        iframes: [],
        jsonLd: [],
        socialMetaKeys: [],
        frameworkMarkers: [],
        addresses: [],
        menu,
        breadcrumb: [],
      };

      const capped = capRawPage(raw);
      expect(countMenuItems(capped.menu)).toBe(RAW_LIST_CAP);
    });

    it('does not split a heading ending in a surrogate pair at the cut', () => {
      // A surrogate pair (😀 = \uD83D\uDE00) placed right across the boundary at RAW_ITEM_TEXT_CAP (300)
      const prefix = 'x'.repeat(RAW_ITEM_TEXT_CAP - 1);
      const textWithSurrogate = `${prefix}\uD83D\uDE00`;
      expect(textWithSurrogate.length).toBe(RAW_ITEM_TEXT_CAP + 1);

      const raw: RawPage = {
        url: 'https://shop.example/',
        title: null,
        description: null,
        lang: null,
        textChunks: [],
        headings: [{ level: 1, text: textWithSurrogate, chunk: 0 }],
        images: [],
        anchors: [],
        contactLinks: [],
        forms: [],
        ctaCandidates: [],
        metaGenerator: null,
        scripts: [],
        stylesheets: [],
        iframes: [],
        jsonLd: [],
        socialMetaKeys: [],
        frameworkMarkers: [],
        addresses: [],
        menu: [],
        breadcrumb: [],
      };

      const capped = capRawPage(raw);
      expect(capped.headings[0].text).toBe(prefix);
      expect(capped.headings[0].text.length).toBe(RAW_ITEM_TEXT_CAP - 1);
      // Ensure the high surrogate \uD83D is not left dangling at the end
      expect(capped.headings[0].text.charCodeAt(capped.headings[0].text.length - 1)).not.toBe(0xd83d);
    });
  });
});
