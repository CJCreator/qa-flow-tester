/** Competitors (T-416, ADR 0049): discovery, the light crawl and the comparison. Node only. */
export {
  competitorSummary,
  discoverCompetitors,
  discoverMessages,
  parseCompetitorAnswer,
  type CompetitorSummary,
  type DiscoverOptions,
  type DiscoverOutcome,
} from './discover.js';
export {
  COMPETITOR_PAGE_MAX_BYTES,
  NOT_READ as COMPETITOR_NOT_READ,
  keyPages,
  lightCrawlSite,
  lightCrawlSites,
  menuLinks,
  pageFactsFromHtml,
  pageTypeOf,
  trustSignalsIn,
  type LightCrawlOptions,
  type PageLinkFact,
} from './light-crawl.js';
export { auditedPagesByType, compareSites, pageFactsFromContent } from './compare.js';
export {
  competitorExamples,
  competitorIdeas,
  competitorTexts,
  copiesCompetitor,
  type CompetitorExample,
} from './examples.js';

/** The stored competitors of a version: `audits/<id>/v<n>/competitors.json`. */
export const COMPETITORS_NAME = 'competitors';
