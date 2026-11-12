/**
 * Website Audit pipeline: a finished crawl to a saved AuditResult. Node only. Named exports, so the core
 * barrel can re-export it without name clashes.
 */
export {
  runAuditPipeline,
  AuditPipelineError,
  DEFAULT_SITE_STAGES,
  onlyOnePageNoteText,
  siteStoppedAnsweringNoteText,
  speedSourceNoteText,
  aiStatusNoteText,
} from './pipeline.js';
export type {
  AuditPipelineDeps,
  AuditPipelineOutcome,
  AuditPipelineStore,
  PipelineStep,
  PipelineStepOutcome,
  SiteStages,
} from './pipeline.js';
export {
  SITE_CAUSED_SKIP_REASONS,
  isSiteCausedSkip,
  formatWaitTime,
  createSkippedPageFinding,
  createSkippedPageFindings,
} from './skipped-findings.js';
export { AuditPageRecorder, createPageRecorder, DEFAULT_PAGE_STAGES } from './page-recorder.js';
export type { PageRecorderOptions, PageStages, RecordedPage } from './page-recorder.js';
export { AREA_ASPECT, areaGrades, labPerformanceScore } from './grades.js';
export type { CheckedAreas } from './grades.js';
