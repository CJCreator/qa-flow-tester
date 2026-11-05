/**
 * Public API of the Website Audit AI stages. Named exports only, so `export * from './audit/ai/index.js'`
 * in the core barrel cannot collide with other core exports. The ADR 0018 word lists stay with
 * `documents/wording.ts`; only the matchers are exported here.
 */
export { AITimeoutError } from '../../ai/timeout.js';

export { resolveAuditAi, auditAiRequestBudget, isKeyRefused, classifyAiError, redactAiMessage } from './stage-ai.js';
export type {
  AuditAi,
  AuditAiAnswer,
  AuditAiAskOptions,
  AuditAiRequestBudget,
  AuditAiResolution,
  AuditAiSetup,
  ResolveAuditAiDeps,
} from './stage-ai.js';

export { preflightAuditAi } from './preflight.js';
export type {
  PreflightAuditAiOptions,
  PreflightKeyResolver,
  PreflightAiResolver,
  PreflightTarget,
} from './preflight.js';

export { AuditAiModelsStore, AUDIT_AI_MODELS_FILE } from './stage-models-store.js';
export type { AuditAiModelsSave } from './stage-models-store.js';

export { findClaimWords, hasClaimWords } from './claim-words.js';

export {
  IMPACT_EFFORT_BY_RULE,
  IMPACT_EFFORT_BY_SEVERITY,
  DEFAULT_IMPACT_EFFORT,
  WHOLE_PAGE_RULES,
  defaultImpactEffort,
  scoreFindings,
  rankFindings,
  rankFindingsWithIdMap,
  checkCitations,
} from './ranking.js';
export type {
  ImpactEffort,
  UnscoredAuditFinding,
  RankOptions,
  RankedFindings,
  CitationProblem,
  CitationProblemKind,
  CitablePage,
} from './ranking.js';

export {
  measurePageSpeed,
  measureSampleSpeeds,
  mapPsiResponse,
  isQuotaAnswer,
  psiRequestUrl,
  psiNotMeasuredReason,
  PSI_ENDPOINT,
  PSI_TIMEOUT_MS,
  PSI_MAX_BYTES,
} from './pagespeed.js';
export type { PageSpeedDeps, SampleSpeed, PageSpeedMeasurement, PageSpeedNotMeasuredReason } from './pagespeed.js';

export { assessPages, assessSite } from './assessment.js';
export type {
  AreaGrades,
  AssessmentPageInput,
  AssessmentRunOptions,
  AssessPagesInput,
  AssessSiteInput,
  PageAssessment,
} from './assessment.js';

export {
  recommendPages,
  recommendationFor,
  ruleRecommendation,
  REDESIGN_MIN_HIGH_IMPACT,
  REDESIGN_MIN_GROUPS,
  REDESIGN_LOW_AREAS,
  NO_FINDINGS_REASON,
} from './page-recommendation.js';
export type { RecommendationPageInput, RecommendPagesInput } from './page-recommendation.js';

export { findOverlaps, overlapThreshold, overlapWords, writeRewrite, rewriteMessages } from './rewrite.js';
export type { WriteRewriteInput, RewriteAiProblem, WrittenRewrite } from './rewrite.js';

export { RewriteStore, REWRITES_FILE } from './rewrite-store.js';
export type {
  RewriteSection,
  RewriteRefusalCode,
  RewriteFailure,
  RewriteResult,
  RewriteAcceptResult,
  RewriteRunInput,
  RewriteRunDeps,
  RewriteAcceptInput,
  RewriteAcceptDeps,
} from './rewrite-store.js';
