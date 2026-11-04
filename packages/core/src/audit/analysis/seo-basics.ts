import type { AuditFinding, PageContent, SeoBasics } from '@qa/types';
import { CONTENT_PROBLEM_RULES, firstSkippedLevel, h1Count, normaliseWhitespace } from './content-problems.js';

/**
 * SEO basics of one page from its Page Content (REQ-038): facts only, never "compliant". The problems
 * themselves are content findings (REQ-014); `findingIds` points at the ones involving this page instead
 * of repeating them.
 */

const CONTENT_RULES: ReadonlySet<string> = new Set(CONTENT_PROBLEM_RULES);

export function seoBasics(content: PageContent, findings: readonly AuditFinding[]): SeoBasics {
  const at = content.urlPath;
  return {
    hasTitle: normaliseWhitespace(content.title) !== '',
    hasDescription: normaliseWhitespace(content.description) !== '',
    h1Count: h1Count(content.headings),
    skippedHeadingLevel: firstSkippedLevel(content.headings) !== null,
    imagesWithoutAlt: content.images.filter((img) => img.alt === null).length,
    htmlLang: content.language.declared,
    findingIds: findings
      .filter((f) => CONTENT_RULES.has(f.rule) && (f.urlPath === at || (f.pages ?? []).includes(at)))
      .map((f) => f.id),
  };
}
