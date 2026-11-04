/**
 * The Website Audit analysis: public API of every analysis module. Core only: nothing here imports the
 * runner or the wizard.
 */

export { readPage, READ_PAGE_MAX_TEXT_CHARS, type ReadPageOptions, type ReadPageResult } from './read-page.js';
export { buildPageContent, type PageContentOptions } from './page-content.js';
export { detectPageLanguage } from './language.js';
export { detectTechnology, type ResponseHeaders } from './technology.js';
export { buildPageHierarchy, internalLinking, type HierarchyPage } from './hierarchy.js';
export { contentProblems, CONTENT_PROBLEM_RULES, type ContentProblemRule } from './content-problems.js';
export { checkLinks, type CheckLinksOptions, type LinkPathLimits } from './broken-links.js';
export { seoBasics } from './seo-basics.js';
export { marketingSignals, auditMarketing, type MarketingPage, type MarketingSignalsInput } from './marketing-signals.js';
export {
  accessibilityBasics,
  type AccessibilityBasicsOptions,
  type AccessibilityBasicsResult,
} from './accessibility-basics.js';
export {
  analyseSite,
  ANALYSIS_MAX_LINK_REQUESTS,
  type AnalysisInput,
  type AnalysisPage,
  type AnalysisAccessibility,
  type AnalysedPage,
  type SiteAnalysis,
} from './analyse-site.js';
export { createFindingIdAllocator, formatFindingId, type FindingIdAllocator } from './finding-ids.js';
export type { RawPage } from './raw-page.js';
