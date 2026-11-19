/**
 * T-414: the quality gate of a design variant. One fixture variant per check, each made to fail that check,
 * and one that passes. The axe scan is a stand-in here (unit tier); the real lab-browser scan is in
 * audit-variant-axe.test.ts (browser tier).
 */
import { describe, expect, it } from 'vitest';
import type { AIMessage } from '@qa/types';
import { VARIANT_CHECKS } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { resolveAuditAi } from '../src/audit/ai/stage-ai.js';
import { emptyOverlay } from '../src/audit/documents/edits.js';
import { previewFacts } from '../src/audit/preview/prompt.js';
import { renderPreviewDocument, sanitizePreviewHtml } from '../src/audit/preview/sanitize.js';
import {
  GATE_REASONS,
  gateVariant,
  improvePages,
  makeVariants,
  variantFileName,
  type ImproveIo,
  type VariantAxeScan,
} from '../src/audit/improve/index.js';
import { NOT_SCANNED } from '../src/audit/improve/quality-gate.js';
import { auditDocContents, auditDocResult, PATHS } from './helpers/audit-doc-fixture.js';

const result = auditDocResult();
const services = auditDocContents().find((c) => c.urlPath === PATHS.services)!;
const facts = previewFacts({ result, home: services, urlPath: PATHS.services, edits: emptyOverlay(), language: 'en' });
const MENU = facts.menu.map((l) => `<a href="${l.href}">${l.text}</a>`).join('');
const GOOD = `<nav>${MENU}</nav><main><h1 data-section="s2">Services</h1><p data-finding="AF-003">Home delivery and gift hampers.</p></main>`;

const clean: VariantAxeScan = async () => ({ blockers: 0 });
const blocked: VariantAxeScan = async () => ({ blockers: 2 });

async function gate(answer: string, options: { scan?: VariantAxeScan; mutate?: (html: string) => string } = {}) {
  const body = sanitizePreviewHtml(answer, facts.siteUrl);
  const nodes = options.mutate ? sanitizePreviewHtml(options.mutate(answer), facts.siteUrl).nodes : body.nodes;
  const html = renderPreviewDocument({ nodes, css: body.css, language: 'en', host: facts.host });
  return gateVariant({ answer, nodes, html, facts, result, urlPath: PATHS.services }, options.scan ?? clean);
}

describe('variant quality gate (T-414)', () => {
  it('passes a variant that keeps the menu, cites real ids and has no Blocker', async () => {
    expect(facts.menu.length).toBeGreaterThan(0);
    expect(await gate(GOOD)).toEqual({ passed: true, failed: [], reasons: [] });
  });

  it('1. sanitizer: a script, a form or an off-site frame fails', async () => {
    for (const bad of [
      '<script>steal()</script>',
      '<form action="/x"><input name="q"></form>',
      '<iframe src="https://elsewhere.example.com/ad"></iframe>',
    ]) {
      const out = await gate(GOOD + bad);
      expect(out.failed, bad).toEqual(['sanitizer']);
    }
    // A frame of the same site is removed too, but does not break the page.
    expect((await gate(`${GOOD}<iframe src="${facts.siteUrl}map"></iframe>`)).passed).toBe(true);
  });

  it('2. menu links: a missing menu link fails', async () => {
    const out = await gate(GOOD, { mutate: (html) => html.replace(/<nav>[\s\S]*?<\/nav>/, '<nav></nav>') });
    expect(out.failed).toEqual(['menu-links']);
    expect(out.reasons).toEqual([GATE_REASONS['menu-links']]);
  });

  it('3. claim words: a claim word left in the page fails', async () => {
    const out = await gate(GOOD.replace('gift hampers.', 'gift hampers. Fully compliant and certified.'));
    expect(out.failed).toEqual(['claim-words']);
  });

  it('4. accessibility: a Blocker from the axe scan fails; a scan that cannot run fails too', async () => {
    expect((await gate(GOOD, { scan: blocked })).failed).toEqual(['accessibility']);
    const broken: VariantAxeScan = async () => {
      throw new Error('no browser');
    };
    const notRun = await gate(GOOD, { scan: broken });
    expect(notRun.failed).toEqual(['accessibility']);
    expect(notRun.reasons).toEqual([NOT_SCANNED]);
  });

  it('5. citations: an id not in this audit version fails, and so does a page with no marker', async () => {
    expect((await gate(GOOD.replace('AF-003', 'AF-999'))).failed).toEqual(['citations']);
    expect((await gate(GOOD.replace('data-section="s2"', 'data-section="s9"'))).failed).toEqual(['citations']);
    // Ids written with commas are read too.
    expect((await gate(GOOD.replace('data-finding="AF-003"', 'data-finding="AF-003, AF-001"'))).passed).toBe(true);
    const unmarked = GOOD.replace(/ data-(finding|section)="[^"]+"/g, '');
    expect((await gate(unmarked)).failed).toEqual(['citations']);
  });

  it('lists every failed check in order, and skips the axe scan when another check failed', async () => {
    let scanned = 0;
    const out = await gate(`${GOOD.replace('AF-003', 'AF-999')}<script>x()</script>`, {
      scan: async () => (scanned++, { blockers: 0 }),
    });
    expect(out.failed).toEqual(['sanitizer', 'citations']);
    expect(VARIANT_CHECKS.filter((c) => out.failed.includes(c))).toEqual(out.failed);
    expect(scanned).toBe(0);
  });
});

describe('the gate in makeVariants', () => {
  function io(): ImproveIo & { files: Map<string, Uint8Array> } {
    const files = new Map<string, Uint8Array>();
    const json = new Map<string, unknown>();
    const contents = new Map(auditDocContents().map((c) => [c.urlPath, c]));
    return {
      files,
      readContent: async (p) => contents.get(p) ?? null,
      readFile: async (n) => files.get(n) ?? null,
      writeFile: async (n, d) => void files.set(n, d),
      readJson: async (n) => json.get(n) ?? null,
      writeJson: async (n, v) => void json.set(n, JSON.parse(JSON.stringify(v))),
    };
  }

  async function ai(answers: string[]) {
    const calls: AIMessage[][] = [];
    const provider: AIProvider = {
      providerType: 'mock',
      async generateText(messages) {
        calls.push(messages);
        return answers[Math.min(calls.length - 1, answers.length - 1)]!;
      },
    };
    const resolved = await resolveAuditAi({
      setup: { provider: 'mock' },
      keys: { resolveKey: async () => ({ provider: 'mock', apiKey: 'mock-key', source: 'keychain' }) },
      createProvider: () => provider,
    });
    if (!resolved.ok) throw new Error('no ai');
    return { calls, ai: resolved.ai };
  }

  it('records the failed check; Try again makes one request and the new variant replaces it', async () => {
    const store = io();
    const page = improvePages(result).find((p) => p.urlPath === PATHS.services)!;
    const first = await ai([`${GOOD}<script>x()</script>`]);
    const made = await makeVariants(
      { result, edits: emptyOverlay(), language: 'en', pages: [page], variants: 1 },
      { io: store, ai: first.ai, scanAxe: clean }
    );
    expect(made.variants[0]!.gate).toEqual({ passed: false, failed: ['sanitizer'], reasons: [GATE_REASONS.sanitizer] });
    expect(store.files.has(variantFileName(page.key, 1))).toBe(true);

    const again = await ai([GOOD]);
    const retried = await makeVariants(
      { result, edits: emptyOverlay(), language: 'en', pages: [page], variants: 1, only: 1 },
      { io: store, ai: again.ai, scanAxe: clean }
    );
    expect(again.calls).toHaveLength(1);
    expect(retried.index.variants).toHaveLength(1);
    expect(retried.index.variants[0]!.gate?.passed).toBe(true);
  });
});
