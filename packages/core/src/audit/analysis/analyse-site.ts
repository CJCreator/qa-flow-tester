import type {
  AccessibilityBasics,
  AuditFinding,
  AuditMarketing,
  AuditPage,
  InternalLinking,
  PageContent,
  PageHierarchy,
  SectionSummary,
  TechnologyResult,
} from '@qa/types';
import type { FetchFn } from '@qa/checkers';
import type { AccessibilityBasicsResult } from './accessibility-basics.js';
import { checkLinks, type CheckLinksOptions } from './broken-links.js';
import { CONTENT_PROBLEM_RULES, contentProblems } from './content-problems.js';
import { createFindingIdAllocator, type FindingIdAllocator } from './finding-ids.js';
import { buildPageHierarchy, internalLinking } from './hierarchy.js';
import { auditMarketing, marketingSignals } from './marketing-signals.js';
import type { RawPage } from './raw-page.js';
import { seoBasics } from './seo-basics.js';
import { detectTechnology, type ResponseHeaders } from './technology.js';

/**
 * The analysis of one audit version (REQ-007...REQ-015, REQ-038): every fixed rule over the recorded pages,
 * in one call. Its input is its own type, so this module does not import the crawl. No clock, no randomness;
 * the only request it can make is through the injected FetchFn (broken links, ADR 0031).
 *
 * Finding ids: the sub-modules run on a scratch series; their findings are then put in a fixed order
 * (content problems, broken links, accessibility in page order), anything reported twice for the same rule,
 * page and target is dropped, and the final AF-NNN ids are handed out from `firstFindingNumber`. SEO basics
 * and marketing signals are built from the final findings; accessibility basics are re-pointed to them.
 */

/** One recorded page, as the crawl read it. */
export interface AnalysisPage {
  urlPath: string;
  /** Link steps from the start address (0 for the start page). */
  depth: number;
  raw: RawPage;
  content: PageContent;
}

/** The accessibility basics of one Sample Page (from `accessibilityBasics`), with the page's path. */
export type AnalysisAccessibility = AccessibilityBasicsResult & { urlPath: string };

export interface AnalysisInput {
  /** The audited site's origin ('https://example.com'): broken-link requests stay on it. */
  origin: string;
  /** The start page's path: the root of the hierarchy. */
  startPath: string;
  /** Recorded pages in crawl order. A path seen twice is the same page: the first wins. */
  pages: AnalysisPage[];
  /** Main-frame status per path from the crawl, 'http-error' skips included (their status is what counts). */
  statusByPath: CheckLinksOptions['statusByPath'];
  /**
   * Skipped Pages that must never be requested (sign-in, payment, robots, excluded, depth-limit). Leave
   * 'http-error' skips out: a path here wins over its status, so a crawl 404 would be lost.
   */
  skippedPaths: Iterable<string>;
  /** Per Sample Page; results for paths that were not recorded are ignored. */
  accessibility: AnalysisAccessibility[];
  /** From makeOutboundFetch: the only way to make a request. */
  fetch: FetchFn;
  /** The robots.txt policy the crawl followed: a link it disallows is never requested or reported. */
  robots?: CheckLinksOptions['robots'];
  /** The crawl's include/exclude limits and start path, re-applied to each link before it is requested. */
  pathLimits?: CheckLinksOptions['pathLimits'];
  /** Broken-link requests at most (default ANALYSIS_MAX_LINK_REQUESTS). */
  maxLinkRequests?: number;
  /** Extra response headers for technology detection (the start page's), merged with each page's own. */
  headers?: ResponseHeaders;
  /** The first free finding number: the first id is AF-<this>. */
  firstFindingNumber: number;
}

/** One recorded page of the analysis. */
export type AnalysedPage = Pick<AuditPage, 'urlPath' | 'title' | 'depth' | 'language' | 'sections' | 'seo'> & {
  /** Sample Pages whose checks ran only. */
  accessibility?: AccessibilityBasics;
};

export interface SiteAnalysis {
  technology: TechnologyResult;
  hierarchy: PageHierarchy;
  internalLinking: InternalLinking;
  /** Every recorded page once, in crawl order. */
  pages: AnalysedPage[];
  /** Content problems, broken links, accessibility (page order): unique AF-NNN ids from `firstFindingNumber`. */
  findings: AuditFinding[];
  marketing: AuditMarketing;
  /** One past the last id used: the AI findings (group G4) continue from here. */
  nextFindingNumber: number;
  /** Plain sentences, such as why a Sample Page's accessibility checks did not run. */
  notes: string[];
}

/** Default cap on broken-link requests per audit version. */
export const ANALYSIS_MAX_LINK_REQUESTS = 100;

function dedupeKey(f: AuditFinding): string {
  return [f.rule, f.urlPath, f.target ?? ''].join('\u0000');
}

function sectionSummaries(content: PageContent): SectionSummary[] {
  return content.sections.map((s) =>
    s.heading === undefined ? { id: s.id, kind: s.kind } : { id: s.id, kind: s.kind, heading: s.heading }
  );
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

export async function analyseSite(input: AnalysisInput): Promise<SiteAnalysis> {
  // Fails before any request when the number is not valid.
  const ids: FindingIdAllocator = createFindingIdAllocator(input.firstFindingNumber);

  // One entry per recorded path, the first wins; the page's path is authoritative.
  const seen = new Set<string>();
  const pages: AnalysisPage[] = [];
  for (const page of input.pages ?? []) {
    if (seen.has(page.urlPath)) continue;
    seen.add(page.urlPath);
    const content = page.content.urlPath === page.urlPath ? page.content : { ...page.content, urlPath: page.urlPath };
    pages.push({ ...page, content });
  }
  const paths = pages.map((p) => p.urlPath);
  const contents = pages.map((p) => p.content);

  const technology = detectTechnology(
    pages.map((p) => p.raw),
    input.headers
  );
  const hierarchy = buildPageHierarchy(
    pages.map((p) => ({ urlPath: p.urlPath, title: p.content.title, raw: p.raw, content: p.content })),
    input.startPath
  );
  const linking = internalLinking(hierarchy, paths);

  // Sub-module findings on a scratch series; final ids come after ordering and de-duplication.
  const scratch = createFindingIdAllocator();
  const content = contentProblems(contents, scratch);
  const links = await checkLinks(
    contents,
    {
      origin: input.origin,
      statusByPath: input.statusByPath,
      skippedPaths: input.skippedPaths,
      fetch: input.fetch,
      ...(input.robots ? { robots: input.robots } : {}),
      ...(input.pathLimits ? { pathLimits: input.pathLimits } : {}),
      maxRequests: input.maxLinkRequests ?? ANALYSIS_MAX_LINK_REQUESTS,
    },
    scratch
  );

  // Accessibility results by recorded path, the first per path; taken in page order.
  const a11yByPath = new Map<string, AnalysisAccessibility>();
  for (const result of input.accessibility ?? []) {
    if (seen.has(result.urlPath) && !a11yByPath.has(result.urlPath)) a11yByPath.set(result.urlPath, result);
  }

  const findings: AuditFinding[] = [];
  const byKey = new Map<string, AuditFinding>();
  /** Adds a finding with its final id; a repeat of the same rule, page and target maps to the first. */
  const add = (f: AuditFinding): string => {
    const key = dedupeKey(f);
    const existing = byKey.get(key);
    if (existing) return existing.id;
    const final: AuditFinding = { ...f, id: ids.next() };
    byKey.set(key, final);
    findings.push(final);
    return final.id;
  };
  for (const f of content) add(f);
  for (const f of links) add(f);

  const notes: string[] = [];
  const a11yBasics = new Map<string, AccessibilityBasics>();
  for (const path of paths) {
    const result = a11yByPath.get(path);
    if (!result) continue;
    // Old id (scoped to this result) to final id.
    const remap = new Map<string, string>();
    for (const f of result.findings ?? []) {
      remap.set(f.id, add({ ...f, urlPath: f.urlPath || path }));
    }
    if (!result.basics) {
      if (result.note) notes.push(result.note);
      continue;
    }
    const findingIds = uniqueIds(
      result.basics.findingIds.map((id) => remap.get(id)).filter((id): id is string => id !== undefined)
    );
    a11yBasics.set(path, { ...result.basics, violations: findingIds.length, findingIds });
  }

  const contentFindings = findings.filter((f) => (CONTENT_PROBLEM_RULES as readonly string[]).includes(f.rule));
  const analysed: AnalysedPage[] = pages.map((p) => {
    const entry: AnalysedPage = {
      urlPath: p.urlPath,
      title: p.content.title,
      depth: p.depth,
      language: p.content.language,
      sections: sectionSummaries(p.content),
      seo: seoBasics(p.content, contentFindings),
    };
    const basics = a11yBasics.get(p.urlPath);
    if (basics) entry.accessibility = basics;
    return entry;
  });

  const signals = marketingSignals({
    pages: pages.map((p) => ({ raw: p.raw, content: p.content })),
    internalLinking: linking,
    findings,
  });

  return {
    technology,
    hierarchy,
    internalLinking: linking,
    pages: analysed,
    findings,
    marketing: auditMarketing(paths, signals),
    nextFindingNumber: ids.nextNumber,
    notes,
  };
}
