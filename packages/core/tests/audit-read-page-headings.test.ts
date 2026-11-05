import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { readPage } from '../src/audit/analysis/read-page.js';
import { contentProblems } from '../src/audit/analysis/content-problems.js';
import { createFindingIdAllocator } from '../src/audit/analysis/finding-ids.js';

/** Tiny fake DOM: just enough for readDom (no browser, no parser available). */
interface FakeEl {
  nodeType: 1;
  tagName: string;
  attrs: Record<string, string>;
  childNodes: Array<FakeEl | FakeText>;
  parentElement: FakeEl | null;
  textContent: string;
  [k: string]: unknown;
}
interface FakeText {
  nodeType: 3;
  data: string;
  textContent: string;
}

function el(tag: string, attrs: Record<string, string>, ...kids: Array<FakeEl | string>): FakeEl {
  const node: FakeEl = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs,
    childNodes: [],
    parentElement: null,
    textContent: '',
    getAttribute: (n: string) => attrs[n] ?? null,
    hasAttribute: (n: string) => n in attrs,
    closest: (sel: string) => {
      const tags = sel.split(',').map((s) => s.trim().toLowerCase());
      for (let p: FakeEl | null = node; p; p = p.parentElement) if (tags.includes(p.tagName.toLowerCase())) return p;
      return null;
    },
  };
  for (const k of kids) {
    if (typeof k === 'string') node.childNodes.push({ nodeType: 3, data: k, textContent: k });
    else {
      k.parentElement = node;
      node.childNodes.push(k);
    }
  }
  node.textContent = node.childNodes.map((c) => c.textContent).join('');
  return node;
}

function fakePage(body: FakeEl) {
  vi.stubGlobal('Node', { TEXT_NODE: 3, ELEMENT_NODE: 1 });
  vi.stubGlobal('document', {
    body,
    title: '',
    documentElement: { getAttribute: () => null },
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  vi.stubGlobal('getComputedStyle', (e: FakeEl) => ({
    display: 'hidden' in e.attrs || e.attrs.style === 'display:none' ? 'none' : 'block',
    visibility: 'visible',
  }));
  return {
    evaluate: async (fn: (a: unknown) => unknown, arg: unknown) => fn(arg),
    url: () => 'https://example.test/',
  } as unknown as Page;
}

afterEach(() => vi.unstubAllGlobals());

async function h1Findings(body: FakeEl) {
  const { raw, content } = await readPage(fakePage(body));
  const findings = contentProblems([{ ...content, title: 't', description: 'd' }], createFindingIdAllocator());
  return { raw, findings: findings.filter((f) => f.rule === 'no-h1' || f.rule === 'multiple-h1') };
}

describe('readPage headings and hidden subtrees', () => {
  it('counts a visible h1', async () => {
    const { raw, findings } = await h1Findings(el('body', {}, el('main', {}, el('h1', {}, 'Welcome'))));
    expect(raw.headings.map((h) => h.level)).toEqual([1]);
    expect(findings).toEqual([]);
  });

  it('does not count an h1 inside a hidden subtree', async () => {
    const hiddenMenu = el('div', { style: 'display:none' }, el('h1', {}, 'Menu'));
    const hiddenAttr = el('div', { hidden: '' }, el('h1', {}, 'Other'));
    const { raw, findings } = await h1Findings(el('body', {}, hiddenMenu, hiddenAttr, el('h2', {}, 'Section')));
    expect(raw.headings.map((h) => h.level)).toEqual([2]);
    expect(findings.map((f) => f.rule)).toEqual(['no-h1']);
  });
});
