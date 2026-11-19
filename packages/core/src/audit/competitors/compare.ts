/**
 * Competitors, the comparison (T-416, ADR 0049). Deterministic: no AI, no I/O.
 *
 * Per page type (home, pricing, services, product, about, contact) the audited site's page sits beside each
 * competitor's: Sections, calls to action, trust signals, contact options and speed. Only what was seen on
 * each page is listed; nothing is scored and nothing is said about a whole site (ADR 0018).
 */
import {
  COMPETITOR_PAGE_TYPES,
  type AuditResult,
  type CompetitorComparisonRow,
  type CompetitorContactOption,
  type CompetitorPageFacts,
  type CompetitorSite,
  type PageContent,
} from '@qa/types';
import { pageTypeOf, trustSignalsIn } from './light-crawl.js';

/** The audited pages to compare: one per page type, the first recorded (the version stores them in crawl order). */
export function auditedPagesByType(result: Pick<AuditResult, 'pages'>): Map<CompetitorPageFacts['pageType'], string> {
  const out = new Map<CompetitorPageFacts['pageType'], string>();
  for (const page of result.pages) {
    const type = pageTypeOf(page.urlPath, page.title ?? '');
    if (type !== 'other' && !out.has(type)) out.set(type, page.urlPath);
  }
  return out;
}

/** The same facts as a competitor page, read from the audited page's stored Page Content. */
export function pageFactsFromContent(content: PageContent, speedMs: number | null = null): CompetitorPageFacts {
  const contact = new Set<CompetitorContactOption>();
  for (const link of content.links) {
    if (/^tel:/i.test(link.to)) contact.add('phone');
    if (/^mailto:/i.test(link.to)) contact.add('email');
    if (/wa\.me\/|api\.whatsapp\.com|whatsapp:\/\//i.test(link.to)) contact.add('whatsapp');
  }
  if (content.forms.some((f) => f.fields.some((field) => ['email', 'tel', 'textarea'].includes(field.type)))) {
    contact.add('form');
  }
  const seen = new Set<string>();
  const ctas = content.ctas
    .map((c) => c.text.trim())
    .filter((t) => t && t.length <= 60 && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, 10);
  return {
    urlPath: content.urlPath,
    pageType: pageTypeOf(content.urlPath, content.title ?? ''),
    title: content.title,
    sections: content.headings
      .filter((h) => h.level <= 3)
      .map((h) => h.text.trim())
      .filter(Boolean)
      .slice(0, 12),
    ctas,
    trustSignals: trustSignalsIn(content.text),
    contactOptions: [...contact],
    speedMs,
  };
}

/**
 * The side-by-side rows: one per page type that the audited site or a read competitor has. A competitor that was
 * not read has no pages, so it shows as "none" on every row.
 */
export function compareSites(
  audited: readonly CompetitorPageFacts[],
  sites: readonly CompetitorSite[]
): CompetitorComparisonRow[] {
  const rows: CompetitorComparisonRow[] = [];
  for (const pageType of COMPETITOR_PAGE_TYPES) {
    const mine = audited.find((p) => p.pageType === pageType) ?? null;
    const theirs = sites.map((site) => ({
      host: site.host,
      page: site.pages.find((p) => p.pageType === pageType) ?? null,
    }));
    if (!mine && theirs.every((t) => t.page === null)) continue;
    rows.push({ pageType, audited: mine, competitors: theirs });
  }
  return rows;
}
