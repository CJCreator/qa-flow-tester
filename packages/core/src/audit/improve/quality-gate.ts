/**
 * The quality gate of a design variant (T-414, ADR 0049): automatic checks only, chosen by the owner on
 * 2026-11-19. A variant is shown only when all five pass:
 * 1. sanitizer: the AI's answer held nothing the sanitizer had to remove that breaks the page (a script, a
 *    form, an off-site frame);
 * 2. menu-links: every menu link of the original page is in the variant and stays on the same site;
 * 3. claim-words: no claim word is left (ADR 0018);
 * 4. accessibility: an axe scan of the variant, rendered with setContent in the lab browser, finds no Blocker;
 * 5. citations: every data-finding and data-section marker names an id of this audit version, and there is
 *    at least one.
 */
import { chromium, type Browser } from 'playwright';
import { UXQualityChecker } from '@qa/checkers';
import { VARIANT_CHECKS, type AuditResult, type VariantCheck, type VariantGateResult } from '@qa/types';
import { sameSiteUrl } from '../../safe-net.js';
import { LAB_CHROMIUM_ARGS } from '../lab-browser.js';
import { findClaimWords } from '../ai/claim-words.js';
import { previewNodesText, type PreviewNode } from '../preview/sanitize.js';
import type { PreviewFacts } from '../preview/prompt.js';

/** Counts the Blockers an axe scan finds in a page. */
export type VariantAxeScan = (html: string) => Promise<{ blockers: number }>;

export interface VariantGateInput {
  /** The AI's answer as it came. */
  answer: string;
  /** The page body as stored: sanitised, menu links added, images inlined. */
  nodes: readonly PreviewNode[];
  /** The whole stored page. */
  html: string;
  facts: Pick<PreviewFacts, 'siteUrl' | 'menu'>;
  result: Pick<AuditResult, 'findings' | 'pages'>;
  /** The page the variant improves. */
  urlPath: string;
}

export const GATE_REASONS: Readonly<Record<VariantCheck, string>> = {
  sanitizer: 'The AI wrote a script, a form or a frame from another site, which had to be removed.',
  'menu-links': 'A menu link of the page is missing, or leads off the site.',
  'claim-words': 'The page uses words that claim more than the audit shows.',
  accessibility: 'An automatic accessibility check found a Blocker in the page.',
  citations: 'A change does not name a finding or Section of this audit version.',
};

/** Said when the lab browser could not scan the variant: it is not shown, but no Blocker was found either. */
export const NOT_SCANNED = 'The automatic accessibility check could not run on this variant. Try again.';

const BREAKING = /<\s*(script|form)\b/i;
const FRAME = /<\s*(iframe|frame|embed|object)\b[^>]*?\b(?:src|data)\s*=\s*["']?([^"'\s>]+)/gi;

/** 1. The answer held a script, a form, or a frame that loads another site. */
export function breaksWhenSanitized(answer: string, siteUrl: string): boolean {
  if (BREAKING.test(answer)) return true;
  for (const match of answer.matchAll(FRAME)) {
    try {
      if (!sameSiteUrl(new URL(match[2], siteUrl).href, siteUrl)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function hrefs(nodes: readonly PreviewNode[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind !== 'open' || node.name !== 'a') continue;
    const href = node.attrs.find(([name]) => name === 'href')?.[1];
    if (href) out.push(href);
  }
  return out;
}

function withoutHash(href: string): string {
  try {
    const url = new URL(href);
    url.hash = '';
    return url.href;
  } catch {
    return href;
  }
}

/** 2. Every menu link of the original page is present, on the same site. */
export function keepsMenuLinks(nodes: readonly PreviewNode[], facts: Pick<PreviewFacts, 'siteUrl' | 'menu'>): boolean {
  const present = new Set(hrefs(nodes).map(withoutHash));
  return facts.menu.every((link) => present.has(withoutHash(link.href)) && sameSiteUrl(link.href, facts.siteUrl));
}

/** The ids every data-finding and data-section marker names. */
export function markers(nodes: readonly PreviewNode[]): { findings: string[]; sections: string[] } {
  const findings: string[] = [];
  const sections: string[] = [];
  for (const node of nodes) {
    if (node.kind !== 'open') continue;
    for (const [name, value] of node.attrs) {
      const ids = value.split(' ').filter(Boolean);
      if (name === 'data-finding') findings.push(...ids);
      if (name === 'data-section') sections.push(...ids);
    }
  }
  return { findings, sections };
}

/** 5. At least one marker, and each names a finding of this version or a Section of the page. */
export function citationsResolve(
  nodes: readonly PreviewNode[],
  result: Pick<AuditResult, 'findings' | 'pages'>,
  urlPath: string
): boolean {
  const { findings, sections } = markers(nodes);
  if (findings.length + sections.length === 0) return false;
  const findingIds = new Set(result.findings.map((f) => f.id));
  const sectionIds = new Set(result.pages.find((p) => p.urlPath === urlPath)?.sections.map((s) => s.id) ?? []);
  return findings.every((id) => findingIds.has(id)) && sections.every((id) => sectionIds.has(id));
}

/** Runs the five checks; the axe scan only when the cheaper four pass, since a failed variant is not shown. */
export async function gateVariant(input: VariantGateInput, scan: VariantAxeScan): Promise<VariantGateResult> {
  const failed = new Set<VariantCheck>();
  if (breaksWhenSanitized(input.answer, input.facts.siteUrl)) failed.add('sanitizer');
  if (!keepsMenuLinks(input.nodes, input.facts)) failed.add('menu-links');
  if (findClaimWords(previewNodesText([...input.nodes])).length > 0) failed.add('claim-words');
  if (!citationsResolve(input.nodes, input.result, input.urlPath)) failed.add('citations');
  let notScanned = false;
  if (failed.size === 0) {
    try {
      if ((await scan(input.html)).blockers > 0) failed.add('accessibility');
    } catch {
      failed.add('accessibility'); // not scanned: not shown
      notScanned = true;
    }
  }
  const list = VARIANT_CHECKS.filter((c) => failed.has(c));
  const reason = (c: VariantCheck) => (c === 'accessibility' && notScanned ? NOT_SCANNED : GATE_REASONS[c]);
  return { passed: list.length === 0, failed: list, reasons: list.map(reason) };
}

const SCAN_TIMEOUT_MS = 30_000;

/**
 * An axe scan in a lab browser: the page is put in with setContent, every request is blocked (the variant's
 * images are inlined), and the axe violations of 'critical' impact count as Blockers. One browser per call
 * unless `browser` is given.
 */
export function labAxeScan(options: { browser?: Browser } = {}): VariantAxeScan {
  return async (html) => {
    const browser =
      options.browser ??
      (await chromium.launch({ headless: true, timeout: SCAN_TIMEOUT_MS, args: [...LAB_CHROMIUM_ARGS] }));
    try {
      // The variant's own CSP blocks scripts; axe is put in by the browser tools, so the CSP is bypassed.
      const context = await browser.newContext({ bypassCSP: true, offline: true, serviceWorkers: 'block' });
      try {
        await context.route('**/*', (route) =>
          route.request().url().startsWith('data:') ? route.continue() : route.abort('blockedbyclient')
        );
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: 'load', timeout: SCAN_TIMEOUT_MS });
        const found = await new UXQualityChecker().check(page, {
          role: 'visitor',
          breakpoint: '1440px',
          urlPath: '/',
          enableAxe: true,
        });
        if (found.some((f) => f.id.startsWith('F-A11Y-SCAN-FAILED-'))) throw new Error('not scanned');
        const axe = found.filter((f) => f.id.startsWith('F-A11Y-') && !f.id.startsWith('F-A11Y-REVIEW-'));
        return { blockers: axe.filter((f) => f.severity === 'Blocker').length };
      } finally {
        await context.close().catch(() => undefined);
      }
    } finally {
      if (!options.browser) await browser.close().catch(() => undefined);
    }
  };
}
