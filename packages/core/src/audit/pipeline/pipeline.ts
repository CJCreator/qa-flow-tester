/**
 * The Website Audit pipeline (REQ-003, REQ-016, REQ-017, REQ-037): a finished crawl to a saved AuditResult.
 *
 * Stages, in order (stage 1 runs inside the crawl, see `page-recorder.ts`):
 *   1. readPage, accessibility basics and phone layout on each page while it is open ('crawling');
 *   2. analyseSite, its requests through `makeCheckerFetch` (makeOutboundFetch, no redirects) paced by the
 *      audit's HostPacer ('checking-pages');
 *   3. measureSampleSpeeds on the Sample Pages ('measuring-speed');
 *   4. the deterministic area grades, then assessPages, assessSite and recommendPages ('assessing');
 *   5. scoreFindings and rankFindings over every finding; phone findings continue the AF numbers from
 *      analyseSite.nextFindingNumber, and every list citing a finding follows the renumbering ('ranking');
 *   6. buildRoadmap ('ranking');
 *   7. writeAllDocuments for all 7 audit documents ('writing-documents');
 *   8. Page Content, phone screenshots and the result saved through the audit store (ADR 0036), so deleting
 *      the audit deletes them ('saving').
 *
 * A stage that fails is recorded as not done (stage outcome, `onStage`, a plain note in the result, and
 * 'not-done' areas), never as a clean result; later stages still run on what exists. A stop (AbortError)
 * ends the pipeline at once and nothing is saved. Only a failed save throws (`AuditPipelineError`).
 * The pipeline runs under the RunSlot the caller already holds.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AreaAssessment,
  AssessmentNotDoneReason,
  AuditAiStatus,
  AuditFinding,
  AuditPage,
  AuditProgressEvent,
  AuditRequest,
  AuditResult,
  AuditStage,
  Finding,
  HierarchyNode,
  MarketingSignal,
  PageRecommendation,
  PageSpeed,
  PhoneLayout,
  RoadmapItem,
  SpeedNotMeasuredReason,
} from '@qa/types';
import { AUDIT_AREAS, MARKETING_SIGNALS } from '@qa/types';
import { isAbortError, stopIfAborted } from '../../abort.js';
import { makeCheckerFetch } from '../../checker-fetch.js';
import type { HostPacer } from '../../host-pacer.js';
import type { NetDeps } from '../../safe-net.js';
import type { AuditStore } from '../store/audit-store.js';
import type { AuditCrawlResult } from '../crawl/crawl.js';
import { createFindingIdAllocator } from '../analysis/finding-ids.js';
import { EMPTY_RAW_LISTS } from '../analysis/raw-page.js';
import { skipKey } from '../analysis/broken-links.js';
import { analyseSite, type AnalysisPage, type SiteAnalysis } from '../analysis/analyse-site.js';
import { auditMarketing } from '../analysis/marketing-signals.js';
import { seoBasics } from '../analysis/seo-basics.js';
import { measureSampleSpeeds, type PageSpeedDeps } from '../ai/pagespeed.js';
import { assessPages, assessSite, AUDIT_AI_IN_FLIGHT, type AreaGrades } from '../ai/assessment.js';
import { pageContentName } from '../store/keys.js';
import { recommendPages, ruleRecommendation } from '../ai/page-recommendation.js';
import {
  checkCitations,
  rankFindingsWithIdMap,
  scoreFindings,
  type CitationProblem,
  type UnscoredAuditFinding,
} from '../ai/ranking.js';
import { hasClaimWords } from '../ai/claim-words.js';
import { classifyAiError, redactAiMessage, type AuditAiResolution } from '../ai/stage-ai.js';
import { buildRoadmap } from '../documents/roadmap.js';
import {
  writeAllDocuments,
  type StoredAuditDocument,
  type WriteAllDocumentsStore,
  type WriteAllSettings,
} from '../documents/write-all.js';
import { areaGrades, labPerformanceScore, type CheckedAreas } from './grades.js';
import type { AuditPageRecorder, RecordedPage } from './page-recorder.js';
import { createSkippedPageFindings, isSiteCausedSkip } from './skipped-findings.js';

/** The site-level stage functions; the defaults are the real modules. Tests pass fakes. */
export interface SiteStages {
  analyseSite: typeof analyseSite;
  measureSampleSpeeds: typeof measureSampleSpeeds;
  assessPages: typeof assessPages;
  assessSite: typeof assessSite;
  recommendPages: typeof recommendPages;
  buildRoadmap: typeof buildRoadmap;
  writeAllDocuments?: typeof writeAllDocuments;
}

export const DEFAULT_SITE_STAGES: SiteStages = {
  analyseSite,
  measureSampleSpeeds,
  assessPages,
  assessSite,
  recommendPages,
  buildRoadmap,
  writeAllDocuments,
};

export type PipelineStep =
  | 'reading'
  | 'analysis'
  | 'speed'
  | 'assessment'
  | 'recommendation'
  | 'ranking'
  | 'roadmap'
  | 'writing-documents'
  | 'saving';

/** How one step ended. 'not-done' is never shown as a clean result. */
export interface PipelineStepOutcome {
  step: PipelineStep;
  /** The progress stage the step belongs to. */
  stage: AuditStage;
  status: 'done' | 'not-done';
  /** Fixed wording: never page text or an error message. */
  note?: string;
}

/** What the pipeline uses from the audit store. */
export type AuditPipelineStore = Pick<
  AuditStore,
  'saveResult' | 'writeVersionJson' | 'putVersionFile' | 'updateVersion'
> &
  Partial<Pick<AuditStore, 'saveAuditDocument' | 'readVersionJson' | 'writeVersionEntries'>>;

export interface AuditPipelineDeps {
  auditId: string;
  version: number;
  request: AuditRequest;
  /** When the audit started (ISO time). */
  startedAt: string;
  /** The recorder whose `onRenderedPage` the crawl ran with. Its `workDir` holds the phone screenshots. */
  recorder: AuditPageRecorder;
  /** The version must already exist in the store (createAudit / addVersion). */
  store: AuditPipelineStore;
  /** The local working folder the recorder wrote phone screenshots under. */
  workDir: string;
  /** Resolved by the caller (resolveAuditAi). Default: no AI key, so notes are 'not-done'. */
  ai?: AuditAiResolution;
  /** Test override only. Default: `crawl.pacer`, the pacer the crawl used (it carries robots Crawl-delay). */
  pacer?: HostPacer;
  /** Network seam (tests). Default: the real pinned lookup and connect, public addresses only. */
  netDeps?: NetDeps;
  /** PageSpeed key resolver and seams. */
  pageSpeed?: PageSpeedDeps;
  signal?: AbortSignal;
  /** Per AI request. */
  aiTimeoutMs?: number;
  onProgress?: (event: AuditProgressEvent) => void;
  /** Called as each step ends, 'done' or 'not-done'. */
  onStep?: (outcome: PipelineStepOutcome) => void;
  now?: () => Date;
  stages?: Partial<SiteStages>;
  /** Settings for writing documents (company, proposal template, optOutText). */
  settings?: WriteAllSettings;
}

export interface AuditPipelineOutcome {
  result: AuditResult;
  steps: PipelineStepOutcome[];
  /** Findings whose page or Section citation does not hold (REQ-017 AC-2): returned to the caller, not stored. */
  citationProblems: CitationProblem[];
}

/**
 * The save failed. Fixed wording, never internals.
 *  - 'save-failed': nothing is stored; the caller marks the version 'failed'.
 *  - 'status-not-updated': the result IS stored but the version status could not be set to 'done' (after one
 *    retry); the caller must not mark the version 'failed' and may retry the status update.
 */
export class AuditPipelineError extends Error {
  readonly code: 'save-failed' | 'status-not-updated';
  readonly errorCode = 'ERR_PIPELINE' as const;
  constructor(code: 'save-failed' | 'status-not-updated' = 'save-failed') {
    super(
      code === 'status-not-updated'
        ? 'The audit result is saved, but its status could not be updated.'
        : 'The audit could not be saved.'
    );
    this.name = 'AuditPipelineError';
    this.code = code;
  }
}

const NOTES: Record<Exclude<PipelineStep, 'reading'>, string> = {
  analysis: 'The page checks did not finish, so content, link, search and marketing results are missing.',
  speed: 'The speed step did not finish, so speed was not measured.',
  assessment: 'The AI notes did not finish, so the areas have grades but no notes.',
  recommendation: 'The AI redesign-or-repair step did not finish, so a fixed rule decided.',
  ranking: 'The findings could not be ranked, so they are listed in the order found.',
  roadmap: 'The Improvement Roadmap could not be built.',
  'writing-documents': 'The Audit Documents could not be written.',
  saving: 'The audit could not be saved.',
};
const NOT_CHECKED_SIGNAL = 'Not checked: the page checks did not finish.';

/** "Only 1 page was read" note text (T-84, T-88, ADR 0042). */
export function onlyOnePageNoteText(): string {
  return 'Only 1 page was read.';
}

/** "The site stopped answering after N pages" note text (T-84, T-88, ADR 0042). */
export function siteStoppedAnsweringNoteText(pages: number): string {
  return `The site stopped answering after ${pages} ${pages === 1 ? 'page' : 'pages'}.`;
}

/** Speed source note text (T-84, T-88, ADR 0042). */
export function speedSourceNoteText(source: 'pagespeed-insights' | 'this-tool' | 'not-measured'): string {
  if (source === 'pagespeed-insights') return 'Speed was measured by Google PageSpeed Insights.';
  if (source === 'this-tool') {
    return 'Speed was measured by this tool. The speed area has no grade: a grade needs a Google PageSpeed Insights score.';
  }
  return 'Speed was not measured.';
}

/** AI status note text with its reason (T-84, T-88, ADR 0042). */
export function aiStatusNoteText(status: AuditAiStatus, reason?: string): string {
  if (status === 'ready') return 'AI: ready.';
  if (status === 'no-key') return 'AI notes need an AI key.';
  if (status === 'key-expired') return 'The AI key expired. Update it in Settings.';
  if (status === 'quota') return 'The AI quota was reached.';
  if (status === 'timeout') return 'The AI did not answer in time.';
  if (status === 'provider-error') {
    return reason ? `The AI provider returned an error: ${reason}.` : 'The AI provider returned an error.';
  }
  return 'AI status: not available.';
}

function notMeasured(reason: SpeedNotMeasuredReason): PageSpeed {
  return {
    lab: { status: 'not-measured', source: 'pagespeed-insights', method: 'lab', reason },
    field: { status: 'not-measured', source: 'pagespeed-insights', method: 'field', reason },
  };
}

function notDoneAreas(grades: AreaGrades, reason: AssessmentNotDoneReason): AreaAssessment[] {
  return AUDIT_AREAS.map((area) => ({ area, grade: grades[area] ?? null, status: 'not-done', reason }));
}

/** The deterministic grade always wins over whatever came back. */
function withGrades(areas: readonly AreaAssessment[], grades: AreaGrades): AreaAssessment[] {
  return areas.map((a) => ({ ...a, grade: grades[a.area] ?? null }));
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function rethrowIfStopped(err: unknown, signal: AbortSignal | undefined): void {
  if (isAbortError(err) || signal?.aborted) throw err;
}

/** The phone layout rule a checker finding came from. */
function phoneRule(f: Finding): string {
  return f.id.startsWith('F-UX-OVERFLOW-') ? 'horizontal-overflow' : 'tap-target';
}

function phoneFinding(f: Finding, urlPath: string, id: string, screenshotPath: string | null): UnscoredAuditFinding {
  const rule = phoneRule(f);
  const detail = `On ${urlPath} at phone width: ${f.expectedVsActual?.actual ?? ''}`.trim();
  const finding: UnscoredAuditFinding = {
    id,
    rule,
    group: 'technical',
    area: 'usability',
    title: hasClaimWords(f.title) ? 'Phone layout problem found' : f.title,
    detail: hasClaimWords(detail) ? `On ${urlPath} at phone width: the check "${rule}" found a problem.` : detail,
    suggestion:
      hasClaimWords(f.resolution ?? '') || !f.resolution ? 'Fix the elements named in this finding.' : f.resolution,
    urlPath,
    sectionId: null,
    source: 'checker',
    severity: f.severity,
    findingId: f.id,
  };
  if (f.where?.cssSelector) finding.target = f.where.cssSelector;
  if (screenshotPath) finding.screenshotPath = screenshotPath;
  return finding;
}

/** A hierarchy with every recorded page once, by path only: used when the analysis did not finish. */
function flatHierarchy(pages: readonly RecordedPage[], startPath: string): HierarchyNode {
  const start = pages.find((p) => p.info.depth === 0) ?? pages[0];
  const rootPath = start?.info.urlPath ?? startPath;
  return {
    urlPath: rootPath,
    title: start?.read?.content.title ?? null,
    placedBy: 'start',
    children: pages
      .filter((p) => p.info.urlPath !== rootPath)
      .map((p) => ({ urlPath: p.info.urlPath, title: p.read?.content.title ?? null, placedBy: 'path', children: [] })),
  };
}

/** What stands in for the analysis when it did not finish: facts only, no findings, nothing graded as clean. */
function fallbackAnalysis(pages: readonly RecordedPage[], startPath: string): SiteAnalysis {
  const readable = pages.filter((p) => p.read);
  const signals: MarketingSignal[] = MARKETING_SIGNALS.map((s) => ({
    key: s.key,
    label: s.label,
    status: 'not-checked',
    pages: [],
    detail: NOT_CHECKED_SIGNAL,
  }));
  return {
    technology: { status: 'not-identified' },
    hierarchy: { root: flatHierarchy(readable, startPath), links: [] },
    internalLinking: { inboundCounts: {}, unlinkedPages: [] },
    pages: readable.map((p) => {
      const content = p.read!.content;
      return {
        urlPath: p.info.urlPath,
        title: content.title,
        depth: p.info.depth,
        language: content.language,
        sections: content.sections.map((s) =>
          s.heading === undefined ? { id: s.id, kind: s.kind } : { id: s.id, kind: s.kind, heading: s.heading }
        ),
        seo: seoBasics(content, []),
      };
    }),
    findings: [],
    marketing: auditMarketing(
      readable.map((p) => p.info.urlPath),
      signals
    ),
    nextFindingNumber: 1,
    notes: [],
  };
}

function startPathOf(crawl: AuditCrawlResult): string {
  const start = crawl.pages.find((p) => p.depth === 0);
  if (start) return start.urlPath;
  try {
    return new URL(crawl.finalUrl).pathname;
  } catch {
    return '/';
  }
}

export async function runAuditPipeline(
  crawl: AuditCrawlResult,
  deps: AuditPipelineDeps
): Promise<AuditPipelineOutcome> {
  const { auditId, version, store } = deps;
  const stages: SiteStages = { ...DEFAULT_SITE_STAGES, ...(deps.stages ?? {}) };
  const signal = deps.signal;
  const now = deps.now ?? (() => new Date());
  const ai: AuditAiResolution = deps.ai ?? { ok: false, reason: 'no-ai-key' };
  const language = deps.request.language;
  const notes: string[] = [];
  const steps: PipelineStepOutcome[] = [];

  // Note for only 1 page recorded but more found, or links to other pages of the same site (T-84, ADR 0042)
  const onlyPage = crawl.pages.length === 1 ? crawl.pages[0] : undefined;
  const linksToOtherPages =
    !!onlyPage && (onlyPage.links ?? []).some((l) => !l.leavesSite && skipKey(l.to) !== skipKey(onlyPage.urlPath));
  if (onlyPage && (crawl.coverage.found > 1 || linksToOtherPages)) {
    const note = onlyOnePageNoteText();
    if (!notes.includes(note)) notes.push(note);
  }

  // Note for site stopped answering during crawl outage (T-84, ADR 0042)
  if (typeof crawl.stoppedAnsweringAfter === 'number') {
    const note = siteStoppedAnsweringNoteText(crawl.stoppedAnsweringAfter);
    if (!notes.includes(note)) notes.push(note);
  }

  const counts = {
    pagesFound: crawl.coverage.found,
    pagesRecorded: crawl.pages.length,
    pagesSkipped: crawl.coverage.skipped.length,
  };
  const emit = (stage: AuditStage) =>
    deps.onProgress?.({ type: 'progress', auditId: deps.auditId, version: deps.version, stage, ...counts });
  const record = (step: PipelineStep, stage: AuditStage, done: boolean, note?: string) => {
    const outcome: PipelineStepOutcome = { step, stage, status: done ? 'done' : 'not-done', ...(note ? { note } : {}) };
    steps.push(outcome);
    if (note && !notes.includes(note)) notes.push(note);
    deps.onStep?.(outcome);
  };

  const origin = new URL(crawl.finalUrl || deps.request.url).origin;
  const startPath = startPathOf(crawl);

  // ---- 1. What the crawl hook recorded -------------------------------------------------------------
  stopIfAborted(signal);
  const recordedPages = deps.recorder.pages;
  const readable = recordedPages.filter((p) => p.read !== null);
  const pageNotes: string[] = [];
  const unread = recordedPages.length - readable.length;
  if (unread > 0) pageNotes.push(`${unread} recorded page(s) could not be read, so they are left out of the checks.`);
  for (const p of readable) {
    if (p.coverage !== 'sample') continue;
    if (p.accessibility === null) {
      pageNotes.push(`The accessibility checks did not run on ${p.info.urlPath}, so this page has not been checked.`);
    }
    if (p.phone === null) pageNotes.push(`The phone layout was not recorded on ${p.info.urlPath}.`);
  }
  if (pageNotes.length > 0) {
    notes.push(...pageNotes);
    record('reading', 'crawling', false);
  } else {
    record('reading', 'crawling', true);
  }

  // ---- 2. Analysis --------------------------------------------------------------------------------
  stopIfAborted(signal);
  emit('checking-pages');
  // The crawl's own pacer (shared host turns, robots Crawl-delay honoured, ADR 0015); `deps.pacer` is a test override.
  const pacer = deps.pacer ?? crawl.pacer;
  const statusByPath: Record<string, number> = {};
  const skippedPaths: string[] = [];
  for (const s of crawl.coverage.skipped) {
    if (s.why === 'http-error') {
      if (typeof s.status === 'number') statusByPath[s.urlPath] = s.status;
    } else {
      skippedPaths.push(s.urlPath);
    }
  }
  let analysis: SiteAnalysis;
  let analysed = false;
  try {
    analysis = await stages.analyseSite({
      origin,
      startPath,
      pages: readable.map((p): AnalysisPage => ({
        urlPath: p.info.urlPath,
        depth: p.info.depth,
        raw: p.read!.raw,
        content: p.read!.content,
      })),
      statusByPath,
      skippedPaths,
      accessibility: readable
        .filter((p) => p.coverage === 'sample' && p.accessibility)
        .map((p) => ({ ...p.accessibility!, urlPath: p.info.urlPath })),
      // Public addresses only (private too when the crawl ran on a local runner, ADR 0042), no redirect followed
      // (a redirect could land on a Skipped Page), paced with the crawl.
      fetch: makeCheckerFetch({ allowPrivate: crawl.allowPrivateAddresses === true, pacer, deps: deps.netDeps }),
      // The link check follows the crawl's own rules: robots.txt and the include/exclude limits (ADR 0015).
      ...(crawl.robots ? { robots: crawl.robots } : {}),
      pathLimits: {
        includePaths: deps.request.limits.includePaths,
        excludePaths: deps.request.limits.excludePaths,
        startPath: new URL(deps.request.url).pathname,
      },
      firstFindingNumber: 1,
      signal,
    });
    analysed = true;
    notes.push(...analysis.notes);
    record('analysis', 'checking-pages', true);
  } catch (err) {
    rethrowIfStopped(err, signal);
    analysis = fallbackAnalysis(readable, startPath);
    record('analysis', 'checking-pages', false, NOTES.analysis);
  }

  // The raw facts are read by the analysis only; drop them so 200 pages do not stay in memory twice.
  for (const p of readable) p.read!.raw = { ...p.read!.raw, ...EMPTY_RAW_LISTS };

  // Phone layout findings continue the analysis's AF numbers.
  const ids = createFindingIdAllocator(analysis.nextFindingNumber);
  const unscored: UnscoredAuditFinding[] = [...analysis.findings];
  const phoneByPath = new Map<string, PhoneLayout>();
  for (const p of readable) {
    if (p.coverage !== 'sample' || !p.phone) continue;
    const remap = new Map<string, string>();
    for (const f of p.phone.findings) {
      const id = ids.next();
      remap.set(f.id, id);
      unscored.push(phoneFinding(f, p.info.urlPath, id, p.phone.phone.screenshotPath));
    }
    phoneByPath.set(p.info.urlPath, {
      ...p.phone.phone,
      findingIds: unique(p.phone.phone.findingIds.map((id) => remap.get(id)).filter((id): id is string => !!id)),
    });
  }

  // Site-caused Skipped Pages become findings (T-84, ADR 0018)
  unscored.push(...createSkippedPageFindings(crawl.coverage.skipped, ids));

  const recordedByPath = new Map(readable.map((p) => [p.info.urlPath, p]));
  const groups = deps.recorder.layoutGroups();
  const pages: AuditPage[] = analysis.pages.map((a) => {
    const rec = recordedByPath.get(a.urlPath);
    const page: AuditPage = {
      urlPath: a.urlPath,
      title: a.title,
      depth: a.depth,
      coverage: rec?.coverage ?? 'sample',
      language: a.language,
      sections: a.sections,
      seo: a.seo,
    };
    const group = groups.get(a.urlPath);
    if (group) page.layoutGroup = group;
    if (rec?.coverage === 'covered' && rec.sampleUrlPath) page.sampleUrlPath = rec.sampleUrlPath;
    if (a.accessibility) page.accessibility = a.accessibility;
    const phone = phoneByPath.get(a.urlPath);
    if (phone) page.phone = phone;
    return page;
  });
  const samples = pages.filter((p) => p.coverage === 'sample');

  // ---- 3. Speed -----------------------------------------------------------------------------------
  stopIfAborted(signal);
  emit('measuring-speed');
  let speedSource: 'pagespeed-insights' | 'this-tool' | 'not-measured' = 'not-measured';
  try {
    const urls = samples.map((p) => new URL(p.urlPath, origin).toString());
    const speeds = urls.length > 0 ? await stages.measureSampleSpeeds(urls, { ...deps.pageSpeed, signal }) : [];
    samples.forEach((p, i) => {
      const psiResult = speeds[i];
      const psiMeasured = psiResult?.speed?.lab.status === 'measured';
      if (psiMeasured) {
        p.speed = psiResult.speed;
      } else {
        const rec = recordedByPath.get(p.urlPath);
        if (rec?.timing?.speed && rec.timing.speed.status === 'measured') {
          p.speed = {
            lab: rec.timing.speed,
            field: { status: 'not-measured', source: 'this-tool', method: 'field', reason: 'failed' },
          };
        } else {
          p.speed = psiResult?.speed ?? notMeasured('failed');
        }
      }
    });
    const anyPsi = samples.some(
      (p) => p.speed?.lab.status === 'measured' && p.speed.lab.source === 'pagespeed-insights'
    );
    const anyTool = samples.some((p) => p.speed?.lab.status === 'measured' && p.speed.lab.source === 'this-tool');
    if (anyPsi) speedSource = 'pagespeed-insights';
    else if (anyTool) speedSource = 'this-tool';
    else speedSource = 'not-measured';

    // The step ran to its end: when nothing could be measured, the "Speed was not measured." note below says so.
    record('speed', 'measuring-speed', speedSource !== 'not-measured');
  } catch (err) {
    rethrowIfStopped(err, signal);
    for (const p of samples) {
      const rec = recordedByPath.get(p.urlPath);
      if (rec?.timing?.speed && rec.timing.speed.status === 'measured') {
        p.speed = {
          lab: rec.timing.speed,
          field: { status: 'not-measured', source: 'this-tool', method: 'field', reason: 'failed' },
        };
      } else {
        p.speed = notMeasured('failed');
      }
    }
    const anyTool = samples.some((p) => p.speed?.lab.status === 'measured' && p.speed.lab.source === 'this-tool');
    speedSource = anyTool ? 'this-tool' : 'not-measured';
    record(
      'speed',
      'measuring-speed',
      speedSource !== 'not-measured',
      speedSource === 'not-measured' ? NOTES.speed : undefined
    );
  }
  const speedNote = speedSourceNoteText(speedSource);
  if (!notes.includes(speedNote)) notes.push(speedNote);

  // ---- 4. Grades, then the AI notes and redesign or repair ------------------------------------------
  stopIfAborted(signal);
  emit('assessing');
  const scored = scoreFindings(unscored);
  // The AI sees findings in ranked order, under the ids they have now; step 5 renumbers everything at once.
  let aiOrdered: AuditFinding[] = scored;
  try {
    const preview = rankFindingsWithIdMap(scored, { start: 1 });
    const back = new Map([...preview.idMap].map(([oldId, newId]) => [newId, oldId]));
    aiOrdered = preview.findings.map((f) => ({ ...f, id: back.get(f.id) ?? f.id }));
  } catch {
    aiOrdered = scored;
  }
  const findingsByPath = new Map<string, AuditFinding[]>();
  for (const f of aiOrdered) {
    const list = findingsByPath.get(f.urlPath);
    if (list) list.push(f);
    else findingsByPath.set(f.urlPath, [f]);
  }
  const findingsOf = (urlPath: string): AuditFinding[] => [...(findingsByPath.get(urlPath) ?? [])];

  const pageGrades = new Map<string, Required<AreaGrades>>();
  for (const p of pages) {
    const own = findingsOf(p.urlPath);
    const checked: CheckedAreas = {
      'search-ranking': analysed,
      marketing: analysed,
      content: analysed,
      accessibility: !!p.accessibility,
      usability: !!p.phone && (p.phone.overflow !== null || p.phone.findingIds.length > 0),
      speed: false,
    };
    pageGrades.set(p.urlPath, areaGrades(own, checked, labPerformanceScore(p.speed)));
  }
  const scores = samples.map((p) => labPerformanceScore(p.speed)).filter((s): s is number => s !== null);
  const siteGrades = areaGrades(
    aiOrdered,
    {
      'search-ranking': analysed,
      marketing: analysed,
      content: analysed,
      accessibility: samples.some((p) => !!p.accessibility),
      usability: samples.some((p) => !!p.phone && (p.phone.overflow !== null || p.phone.findingIds.length > 0)),
      speed: false,
    },
    scores.length > 0 ? Math.min(...scores) : null
  );

  if (!ai.ok) {
    const aiNote = aiStatusNoteText('no-key');
    if (!notes.includes(aiNote)) notes.push(aiNote);
  }
  // The first provider failure of the audit is kept with its reason (ADR 0042).
  let aiFailure: { status: AuditAiStatus; error: string } | null = null;
  const run = {
    language,
    signal,
    ...(deps.aiTimeoutMs !== undefined ? { timeoutMs: deps.aiTimeoutMs } : {}),
    onAiFailure: (status: AuditAiStatus, error: string) => {
      if (!aiFailure) aiFailure = { status, error };
    },
  };

  let siteAreas: AreaAssessment[];
  let assessed = true;
  try {
    const pageAreas = await stages.assessPages(
      {
        ...run,
        aiInFlight: AUDIT_AI_IN_FLIGHT,
        onPageAiProgress: (path, status) => {
          deps.onProgress?.({
            type: 'page',
            auditId: deps.auditId,
            version: deps.version,
            path,
            state: 'recorded',
            ai: status,
          });
        },
        pages: pages
          .filter((p) => recordedByPath.has(p.urlPath))
          .map((p) => ({
            urlPath: p.urlPath,
            content: recordedByPath.get(p.urlPath)!.read!.content,
            findings: findingsOf(p.urlPath),
            grades: pageGrades.get(p.urlPath)!,
            ...(p.speed ? { speed: p.speed } : {}),
          })),
      },
      ai
    );
    const byPath = new Map(pageAreas.map((a) => [a.urlPath, a.areas]));
    for (const p of pages) {
      const grades = pageGrades.get(p.urlPath)!;
      const areas = byPath.get(p.urlPath);
      p.areas = areas ? withGrades(areas, grades) : notDoneAreas(grades, 'ai-failed');
    }
  } catch (err) {
    rethrowIfStopped(err, signal);
    assessed = false;
    const status = classifyAiError(err);
    const reason = redactAiMessage(err);
    const aiNote = aiStatusNoteText(status, reason);
    if (!notes.includes(aiNote)) notes.push(aiNote);
    for (const p of pages) p.areas = notDoneAreas(pageGrades.get(p.urlPath)!, 'ai-failed');
  }
  try {
    siteAreas = withGrades(
      await stages.assessSite(
        {
          ...run,
          url: deps.request.url,
          pages: samples.map((p) => ({ urlPath: p.urlPath, title: p.title, ...(p.speed ? { speed: p.speed } : {}) })),
          findings: aiOrdered,
          grades: siteGrades,
        },
        ai
      ),
      siteGrades
    );
  } catch (err) {
    rethrowIfStopped(err, signal);
    assessed = false;
    const status = classifyAiError(err);
    const reason = redactAiMessage(err);
    const aiNote = aiStatusNoteText(status, reason);
    if (!notes.includes(aiNote)) notes.push(aiNote);
    siteAreas = notDoneAreas(siteGrades, 'ai-failed');
  }
  if (aiFailure) {
    const failed = aiFailure as { status: AuditAiStatus; error: string };
    const aiNote = aiStatusNoteText(failed.status, failed.error);
    if (!notes.includes(aiNote)) notes.push(aiNote);
    // Nothing came back at all: the step did not finish.
    const anyDone =
      pages.some((p) => p.areas?.some((a) => a.status === 'done')) || siteAreas.some((a) => a.status === 'done');
    if (!anyDone) assessed = false;
  }
  record('assessment', 'assessing', assessed, assessed ? undefined : NOTES.assessment);

  let recommendations: PageRecommendation[];
  const recommendationInputs = samples.map((p) => ({
    urlPath: p.urlPath,
    title: p.title,
    coverage: 'sample' as const,
    findings: findingsOf(p.urlPath),
    grades: pageGrades.get(p.urlPath)!,
  }));
  try {
    recommendations = await stages.recommendPages({ ...run, pages: recommendationInputs }, ai);
    const allByRule = recommendations.length > 0 && recommendations.every((r) => r.decidedBy === 'rule');
    const recommended = !(aiFailure && ai.ok && allByRule);
    record('recommendation', 'assessing', recommended, recommended ? undefined : NOTES.recommendation);
  } catch (err) {
    rethrowIfStopped(err, signal);
    recommendations = recommendationInputs.map((p) => ruleRecommendation(p));
    record('recommendation', 'assessing', false, NOTES.recommendation);
  }
  const recommendationByPath = new Map(recommendations.map((r) => [r.urlPath, r]));
  for (const p of samples) {
    const r = recommendationByPath.get(p.urlPath);
    if (r) p.recommendation = r;
  }

  // ---- 5. Ranking ---------------------------------------------------------------------------------
  stopIfAborted(signal);
  emit('ranking');
  let findings: AuditFinding[];
  let idMap = new Map<string, string>();
  try {
    const ranked = rankFindingsWithIdMap(scored, { start: 1 });
    findings = ranked.findings;
    idMap = ranked.idMap;
    record('ranking', 'ranking', true);
  } catch (err) {
    rethrowIfStopped(err, signal);
    findings = scored;
    record('ranking', 'ranking', false, NOTES.ranking);
  }
  const re = (list: readonly string[]) => unique(list.map((id) => idMap.get(id) ?? id));
  for (const p of pages) {
    p.seo = { ...p.seo, findingIds: re(p.seo.findingIds) };
    if (p.accessibility) p.accessibility = { ...p.accessibility, findingIds: re(p.accessibility.findingIds) };
    if (p.phone) p.phone = { ...p.phone, findingIds: re(p.phone.findingIds) };
    if (p.areas) p.areas = p.areas.map((a) => (a.status === 'done' ? { ...a, evidence: re(a.evidence) } : a));
    if (p.recommendation) p.recommendation = { ...p.recommendation, findingIds: re(p.recommendation.findingIds) };
  }
  siteAreas = siteAreas.map((a) => (a.status === 'done' ? { ...a, evidence: re(a.evidence) } : a));
  const marketing = {
    ...analysis.marketing,
    checks: analysis.marketing.checks.map((c) =>
      c.findingId ? { ...c, findingId: idMap.get(c.findingId) ?? c.findingId } : c
    ),
    signals: analysis.marketing.signals.map((s) => (s.findingIds ? { ...s, findingIds: re(s.findingIds) } : s)),
  };
  const citationProblems = checkCitations(
    findings.filter((f) => !isSiteCausedSkip(f.rule as any)),
    pages
  );

  // ---- 6. Improvement Roadmap ---------------------------------------------------------------------
  let roadmap: RoadmapItem[];
  try {
    roadmap = stages.buildRoadmap(findings);
    record('roadmap', 'ranking', true);
  } catch (err) {
    rethrowIfStopped(err, signal);
    roadmap = [];
    record('roadmap', 'ranking', false, NOTES.roadmap);
  }

  const finishedAt = now().toISOString();
  let result: AuditResult = {
    auditId,
    version,
    url: deps.request.url,
    limits: deps.request.limits,
    language,
    startedAt: deps.startedAt,
    finishedAt,
    technology: analysis.technology,
    pages,
    coverage: crawl.coverage,
    leavingSite: crawl.leavingSite.map((l) => ({ to: l.to, from: [...l.from] })),
    hierarchy: analysis.hierarchy,
    internalLinking: analysis.internalLinking,
    findings,
    roadmap,
    marketing,
    siteAreas,
    notes: [...new Set(notes)],
  };

  let storedDocuments: StoredAuditDocument[] | undefined;
  // ---- 7. Write documents --------------------------------------------------------------------------
  stopIfAborted(signal);
  emit('writing-documents');
  try {
    const writeDocs = stages.writeAllDocuments ?? writeAllDocuments;
    const docStore: WriteAllDocumentsStore = {
      saveAuditDocument:
        typeof store.saveAuditDocument === 'function' ? store.saveAuditDocument.bind(store) : async () => {},
      readVersionJson: typeof store.readVersionJson === 'function' ? store.readVersionJson.bind(store) : undefined,
    };
    storedDocuments = await writeDocs(result, deps.settings ?? {}, docStore, {
      contents: readable.map((p) => p.read!.content),
      language,
      now: now(),
    });
    record('writing-documents', 'writing-documents', true);
  } catch (err) {
    rethrowIfStopped(err, signal);
    record('writing-documents', 'writing-documents', false, NOTES['writing-documents']);
  }

  // ---- 8. Save --------------------------------------------------------------------------------------
  stopIfAborted(signal);
  emit('saving');
  const saveNotes: string[] = [];
  if (typeof store.writeVersionEntries === 'function') {
    // One lock and one version check for all of them, a few at a time.
    const shots: Array<{ page: AuditPage; rel: string; data: Uint8Array | null }> = [];
    for (const p of samples) {
      const rel = p.phone?.screenshotPath;
      if (!p.phone || !rel) continue;
      let data: Uint8Array | null = null;
      try {
        data = new Uint8Array(await fs.readFile(path.join(deps.workDir, ...rel.split('/'))));
      } catch {
        data = null;
      }
      shots.push({ page: p, rel, data });
    }
    const readableShots = shots.filter((s) => s.data !== null);
    let saved: boolean[];
    try {
      saved = await store.writeVersionEntries(auditId, version, [
        ...readable.map((p) => ({
          kind: 'json' as const,
          name: pageContentName(p.info.urlPath),
          value: p.read!.content,
        })),
        ...readableShots.map((s) => ({ kind: 'file' as const, name: s.rel, data: s.data! })),
      ]);
    } catch {
      saved = new Array(readable.length + readableShots.length).fill(false);
    }
    readable.forEach((p, i) => {
      if (!saved[i]) saveNotes.push(`The Page Content of ${p.info.urlPath} could not be saved.`);
    });
    const shotSaved = new Map(readableShots.map((s, i) => [s.rel, saved[readable.length + i]]));
    for (const s of shots) {
      if (s.data !== null && shotSaved.get(s.rel)) continue;
      s.page.phone = { ...s.page.phone!, screenshotPath: null };
      saveNotes.push(`The phone screenshot of ${s.page.urlPath} could not be saved.`);
    }
  } else {
    for (const p of readable) {
      try {
        await store.writeVersionJson(auditId, version, pageContentName(p.info.urlPath), p.read!.content);
      } catch {
        saveNotes.push(`The Page Content of ${p.info.urlPath} could not be saved.`);
      }
    }
    for (const p of samples) {
      const rel = p.phone?.screenshotPath;
      if (!p.phone || !rel) continue;
      try {
        const data = await fs.readFile(path.join(deps.workDir, ...rel.split('/')));
        await store.putVersionFile(auditId, version, rel, new Uint8Array(data));
      } catch {
        p.phone = { ...p.phone, screenshotPath: null };
        saveNotes.push(`The phone screenshot of ${p.urlPath} could not be saved.`);
      }
    }
  }
  // A finding pointing at a screenshot that was not saved loses the pointer.
  const savedShots = new Set(samples.map((p) => p.phone?.screenshotPath).filter((s): s is string => !!s));
  findings = findings.map((f) => {
    if (!f.screenshotPath || savedShots.has(f.screenshotPath)) return f;
    const { screenshotPath: _dropped, ...rest } = f;
    return rest;
  });
  if (saveNotes.length > 0) {
    notes.push(...saveNotes);
  }
  result = {
    ...result,
    findings,
    notes: [...new Set(notes)],
  };

  try {
    await store.saveResult(auditId, version, result);
  } catch {
    // One retry: a passing blip should not throw away the whole crawl.
    try {
      await store.saveResult(auditId, version, result);
    } catch {
      record('saving', 'saving', false, NOTES.saving);
      throw new AuditPipelineError('save-failed');
    }
  }
  record('saving', 'saving', saveNotes.length === 0);
  try {
    await store.writeVersionJson(auditId, version, 'stages', steps);
  } catch {
    // The result is saved; the step list is a convenience copy of what the notes already say.
  }
  const done = {
    status: 'done' as const,
    finishedAt,
    pagesRecorded: crawl.pages.length,
    pagesSkipped: crawl.coverage.skipped.length,
    findings: findings.length,
    ...(storedDocuments ? { documents: storedDocuments } : {}),
  };
  try {
    await store.updateVersion(auditId, version, done);
  } catch {
    // One retry: the result is already stored, so a passing blip should not cost the caller its status.
    try {
      await store.updateVersion(auditId, version, done);
    } catch {
      throw new AuditPipelineError('status-not-updated');
    }
  }

  return { result, steps, citationProblems };
}
