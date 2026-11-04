import type { AuditArea, AuditFinding, AuditFindingGroup, ContentHeading, PageContent } from '@qa/types';
import { sectionText } from '@qa/types';
import { IMPACT_EFFORT_BY_RULE } from '../ai/ranking.js';
import type { FindingIdAllocator } from './finding-ids.js';

/**
 * Content problems over the Page Content of every recorded page (REQ-014, Q-26): fixed rules, no AI, no
 * request. Missing and duplicate titles and descriptions, duplicate content (exact match of the main text
 * after whitespace normalisation), heading problems (no H1, more than one H1, a skipped heading level) and
 * images with no alt attribute. An empty alt marks a decorative image and is not reported; alt quality is
 * never judged (ADR 0018). Findings say what was seen on which page, never a claim about the whole site.
 */

/** The rules this module emits. SEO basics cite findings of these rules (REQ-038). */
export const CONTENT_PROBLEM_RULES = [
  'missing-title',
  'duplicate-title',
  'missing-description',
  'duplicate-description',
  'duplicate-content',
  'no-h1',
  'multiple-h1',
  'skipped-heading-level',
  'missing-alt',
] as const;

export type ContentProblemRule = (typeof CONTENT_PROBLEM_RULES)[number];

const PLACEMENT: Record<ContentProblemRule, { group: AuditFindingGroup; area: AuditArea }> = {
  'missing-title': { group: 'technical', area: 'search-ranking' },
  'duplicate-title': { group: 'technical', area: 'search-ranking' },
  'missing-description': { group: 'technical', area: 'search-ranking' },
  'duplicate-description': { group: 'technical', area: 'search-ranking' },
  'duplicate-content': { group: 'content', area: 'content' },
  'no-h1': { group: 'technical', area: 'search-ranking' },
  'multiple-h1': { group: 'technical', area: 'search-ranking' },
  'skipped-heading-level': { group: 'technical', area: 'search-ranking' },
  'missing-alt': { group: 'technical', area: 'accessibility' },
};

/** Longest quote of page text (a title, a description) inside a finding. */
const QUOTE_MAX = 120;

/** Trims and collapses every run of whitespace to one space. */
export function normaliseWhitespace(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/gu, ' ').trim();
}

/** The first heading that goes down more than one level from the heading before it, or null. */
export function firstSkippedLevel(headings: readonly ContentHeading[]): { from: number; to: number } | null {
  for (let i = 1; i < headings.length; i++) {
    const from = headings[i - 1].level;
    const to = headings[i].level;
    if (to > from + 1) return { from, to };
  }
  return null;
}

export function h1Count(headings: readonly ContentHeading[]): number {
  return headings.filter((h) => h.level === 1).length;
}

function quote(text: string): string {
  return text.length > QUOTE_MAX ? `"${text.slice(0, QUOTE_MAX)}…"` : `"${text}"`;
}

type FindingText = Pick<AuditFinding, 'title' | 'detail' | 'suggestion' | 'urlPath' | 'sectionId'> &
  Partial<Pick<AuditFinding, 'pages' | 'target'>>;

function finding(rule: ContentProblemRule, ids: FindingIdAllocator, text: FindingText): AuditFinding {
  const { impact, effort } = IMPACT_EFFORT_BY_RULE[rule];
  return {
    id: ids.next(),
    rule,
    ...PLACEMENT[rule],
    title: text.title,
    detail: text.detail,
    suggestion: text.suggestion,
    impact,
    effort,
    urlPath: text.urlPath,
    sectionId: text.sectionId,
    ...(text.pages ? { pages: text.pages } : {}),
    ...(text.target !== undefined ? { target: text.target } : {}),
    source: 'rule',
  };
}

/**
 * The main text of a page for duplicate content: its 'main' Sections, or else its whole text, after
 * whitespace normalisation. Null when it is empty, or when the per-page cut may have shortened it (two cut
 * texts can match while the pages differ further on).
 */
function mainText(page: PageContent): string | null {
  const main = page.sections.filter((s) => s.kind === 'main');
  const parts = main.length > 0 ? main : null;
  if (page.textTruncated) {
    if (!parts || parts.some((s) => s.end >= page.text.length)) return null;
  }
  const raw = parts ? parts.map((s) => sectionText(page, s)).join('\n') : page.text;
  const text = normaliseWhitespace(raw);
  return text === '' ? null : text;
}

/** Groups pages by a key, in page order; only groups with two pages or more. */
function duplicates(pages: readonly PageContent[], key: (p: PageContent) => string | null): Array<[string, PageContent[]]> {
  const groups = new Map<string, PageContent[]>();
  for (const page of pages) {
    const k = key(page);
    if (k === null || k === '') continue;
    const list = groups.get(k);
    if (list) list.push(page);
    else groups.set(k, [page]);
  }
  return [...groups].filter(([, list]) => list.length > 1);
}

export function contentProblems(pages: readonly PageContent[], ids: FindingIdAllocator): AuditFinding[] {
  // One entry per page path: a path seen twice is the same page.
  const seen = new Set<string>();
  const unique = pages.filter((p) => (seen.has(p.urlPath) ? false : (seen.add(p.urlPath), true)));
  const out: AuditFinding[] = [];

  for (const page of unique) {
    const at = page.urlPath;

    if (normaliseWhitespace(page.title) === '') {
      out.push(
        finding('missing-title', ids, {
          title: 'Page has no title',
          detail: `${at} has no page title, so search results and browser tabs show no name for it.`,
          suggestion: 'Add a short title that names the page and the business.',
          urlPath: at,
          sectionId: null,
        })
      );
    }

    if (normaliseWhitespace(page.description) === '') {
      out.push(
        finding('missing-description', ids, {
          title: 'Page has no meta description',
          detail: `${at} has no meta description, so search engines pick a snippet from the page text.`,
          suggestion: 'Add a meta description of one or two sentences that says what the page offers.',
          urlPath: at,
          sectionId: null,
        })
      );
    }

    const ones = h1Count(page.headings);
    if (ones === 0) {
      out.push(
        finding('no-h1', ids, {
          title: 'Page has no main heading (H1)',
          detail: `${at} has no H1 heading.`,
          suggestion: 'Give the page one H1 heading that says what the page is about.',
          urlPath: at,
          sectionId: null,
        })
      );
    } else if (ones > 1) {
      out.push(
        finding('multiple-h1', ids, {
          title: 'Page has more than one main heading (H1)',
          detail: `${at} has ${ones} H1 headings.`,
          suggestion: 'Keep one H1 heading for the page topic and make the others H2 or lower.',
          urlPath: at,
          sectionId: null,
        })
      );
    }

    const skip = firstSkippedLevel(page.headings);
    if (skip) {
      out.push(
        finding('skipped-heading-level', ids, {
          title: 'Heading levels skip a step',
          detail: `On ${at} an H${skip.from} heading is followed by an H${skip.to} heading, with no H${skip.from + 1} between them.`,
          suggestion: `Use H${skip.from + 1} for the heading after the H${skip.from}, so the outline goes down one level at a time.`,
          urlPath: at,
          sectionId: null,
        })
      );
    }

    for (const image of page.images) {
      if (image.alt !== null) continue;
      out.push(
        finding('missing-alt', ids, {
          title: 'Image has no alt attribute',
          detail: `An image on ${at} has no alt attribute, so screen readers and search engines get no text for it.`,
          suggestion: 'Add alt text that describes the image, or alt="" when the image is only decoration.',
          urlPath: at,
          sectionId: image.sectionId ?? page.sections[0]?.id ?? null,
          target: image.src,
        })
      );
    }
  }

  for (const [title, group] of duplicates(unique, (p) => normaliseWhitespace(p.title))) {
    const paths = group.map((p) => p.urlPath);
    out.push(
      finding('duplicate-title', ids, {
        title: 'Pages share the same title',
        detail: `${paths.length} pages have the title ${quote(title)}: ${paths.join(', ')}.`,
        suggestion: 'Give each page its own title that names what is on that page.',
        urlPath: paths[0],
        sectionId: null,
        pages: paths,
      })
    );
  }

  for (const [description, group] of duplicates(unique, (p) => normaliseWhitespace(p.description))) {
    const paths = group.map((p) => p.urlPath);
    out.push(
      finding('duplicate-description', ids, {
        title: 'Pages share the same meta description',
        detail: `${paths.length} pages have the meta description ${quote(description)}: ${paths.join(', ')}.`,
        suggestion: 'Write a meta description for each page that says what that page offers.',
        urlPath: paths[0],
        sectionId: null,
        pages: paths,
      })
    );
  }

  for (const [, group] of duplicates(unique, mainText)) {
    const paths = group.map((p) => p.urlPath);
    out.push(
      finding('duplicate-content', ids, {
        title: 'Pages have the same main text',
        detail: `${paths.length} pages have the same main text, word for word: ${paths.join(', ')}.`,
        suggestion: 'Write distinct text for each page, or point the copies to one page with a canonical link.',
        urlPath: paths[0],
        // The first page's main Section (or its first Section when the whole text was compared).
        sectionId: (group[0].sections.find((s) => s.kind === 'main') ?? group[0].sections[0])?.id ?? null,
        pages: paths,
      })
    );
  }

  return out;
}
