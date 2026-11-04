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
 *   7. Page Content, phone screenshots and the result saved through the audit store (ADR 0036), so deleting
 *      the audit deletes them ('saving').
 *
 * A stage that fails is recorded as not done (stage outcome, `onStage`, a plain note in the result, and
 * 'not-done' areas), never as a clean result; later stages still run on what exists. A stop (AbortError)
 * ends the pipeline at once and nothing is saved. Only a failed save throws (`AuditPipelineError`).
 * The pipeline runs under the RunSlot the caller already holds.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AreaAssessment,
  AssessmentNotDoneReason,
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
import { analyseSite, type AnalysisPage, type SiteAnalysis } from '../analysis/analyse-site.js';
import { auditMarketing } from '../analysis/marketing-signals.js';
import { seoBasics } from '../analysis/seo-basics.js';
import { measureSampleSpeeds, type PageSpeedDeps } from '../ai/pagespeed.js';
import { assessPages, assessSite, type AreaGrades } from '../ai/assessment.js';
import { recommendPages, ruleRecommendation } from '../ai/page-recommendation.js';
import {
  checkCitations,
  rankFindingsWithIdMap,
  scoreFindings,
  type CitationProblem,
  type UnscoredAuditFinding,
} from '../ai/ranking.js';
import { hasClaimWords } from '../ai/claim-words.js';
import type { AuditAiResolution } from '../ai/stage-ai.js';
import { buildRoadmap } from '../documents/roadmap.js';
import { areaGrades, labPerformanceScore, type CheckedAreas } from './grades.js';
import type { AuditPageRecorder, RecordedPage } from './page-recorder.js';

/** The site-level stage functions; the defaults are the real modules. Tests pass fakes. */
export interface SiteStages {
  analyseSite: typeof analyseSite;
  measureSampleSpeeds: typeof measureSampleSpeeds;
  assessPages: typeof assessPages;
  assessSite: typeof assessSite;
  recommendPages: typeof recommendPages;
  buildRoadmap: typeof buildRoadmap;
}

export const DEFAULT_SITE_STAGES: SiteStages = {
  analyseSite,
  measureSampleSpeeds,
  assessPages,
  assessSite,
  recommendPages,
  buildRoadmap,
};

export type PipelineStep =
  | 'reading'
  | 'analysis'
  | 'speed'
  | 'assessment'
  | 'recommendation'
  | 'ranking'
  | 'roadmap'
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
export type AuditPipelineStore = Pick<AuditStore, 'saveResult' | 'writeVersionJson' | 'putVersionFile' | 'updateVersion'>;

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
}

export interface AuditPipelineOutcome {
  result: AuditResult;
  steps: PipelineStepOutcome[];
  /** Findings whose page or Section citation does not hold (REQ-017 AC-2): recorded, never dropped. */
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
  constructor(code: 'save-failed' | 'status-not-updated' = 'save-failed') {
    super(
      code === 'save-failed'
        ? 'The audit could not be saved.'
        : 'The audit result is saved, but its status could not be updated.',
    );
    this.name = 'AuditPipelineError';
    this.code = code;
  }
}

/** The per-version Page Content object name of a page: `pages/<slug>-<sha256-8>`. */
export function pageContentName(urlPath: string): string {
  const slug =
    urlPath
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'home';
  const hash = createHash('sha256').update(urlPath).digest('hex').slice(0, 8);
  return `pages/${slug}-${hash}`;
}

const NOTES: Record<Exclude<PipelineStep, 'reading'>, string> = {
  analysis: 'The page checks did not finish, so content, link, search and marketing results are missing.',
  speed: 'The speed step did not finish, so speed was not measured.',
  assessment: 'The AI notes did not finish, so the areas have grades but no notes.',
  recommendation: 'The AI redesign-or-repair step did not finish, so a fixed rule decided.',
  ranking: 'The findings could not be ranked, so they are listed in the order found.',
  roadmap: 'The Improvement Roadmap could not be built.',
  saving: 'The audit could not be saved.',
};
const NO_AI_KEY_NOTE = 'AI notes need an AI key.';
const NOT_CHECKED_SIGNAL = 'Not checked: the page checks did not finish.';

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
    suggestion: hasClaimWords(f.resolution ?? '') || !f.resolution ? 'Fix the elements named in this finding.' : f.resolution,
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

export async function runAuditPipeline(crawl: AuditCrawlResult, deps: AuditPipelineDeps): Promise<AuditPipelineOutcome> {
  const stages: SiteStages = { ...DEFAULT_SITE_STAGES, ...(deps.stages ?? {}) };
  const signal = deps.signal;
  const now = deps.now ?? (() => new Date());
  const ai: AuditAiResolution = deps.ai ?? { ok: false, reason: 'no-ai-key' };
  const language = deps.request.language;
  const notes: string[] = [];
  const steps: PipelineStepOutcome[] = [];

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
      pages: readable.map(
        (p): AnalysisPage => ({ urlPath: p.info.urlPath, depth: p.info.depth, raw: p.read!.raw, content: p.read!.content })
      ),
      statusByPath,
      skippedPaths,
      accessibility: readable
        .filter((p) => p.coverage === 'sample' && p.accessibility)
        .map((p) => ({ ...p.accessibility!, urlPath: p.info.urlPath })),
      // Public addresses only, no redirect followed (a redirect could land on a Skipped Page), paced with the crawl.
      fetch: makeCheckerFetch({ allowPrivate: false, pacer, deps: deps.netDeps }),
      firstFindingNumber: 1,
    });
    analysed = true;
    notes.push(...analysis.notes);
    record('analysis', 'checking-pages', true);
  } catch (err) {
    rethrowIfStopped(err, signal);
    analysis = fallbackAnalysis(readable, startPath);
    record('analysis', 'checking-pages', false, NOTES.analysis);
  }

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
  try {
    const urls = samples.map((p) => new URL(p.urlPath, origin).toString());
    const speeds = urls.length > 0 ? await stages.measureSampleSpeeds(urls, deps.pageSpeed) : [];
    samples.forEach((p, i) => {
      p.speed = speeds[i]?.speed ?? notMeasured('failed');
    });
    record('speed', 'measuring-speed', true);
  } catch (err) {
    rethrowIfStopped(err, signal);
    for (const p of samples) p.speed = notMeasured('failed');
    record('speed', 'measuring-speed', false, NOTES.speed);
  }

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
  const findingsOf = (urlPath: string) => aiOrdered.filter((f) => f.urlPath === urlPath);

  const pageGrades = new Map<string, Required<AreaGrades>>();
  for (const p of samples) {
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

  if (!ai.ok && ai.reason === 'no-ai-key') notes.push(NO_AI_KEY_NOTE);
  const run = { language, signal, ...(deps.aiTimeoutMs !== undefined ? { timeoutMs: deps.aiTimeoutMs } : {}) };

  let siteAreas: AreaAssessment[];
  let assessed = true;
  try {
    const pageAreas = await stages.assessPages(
      {
        ...run,
        pages: samples
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
    for (const p of samples) {
      const grades = pageGrades.get(p.urlPath)!;
      const areas = byPath.get(p.urlPath);
      p.areas = areas ? withGrades(areas, grades) : notDoneAreas(grades, 'ai-failed');
    }
  } catch (err) {
    rethrowIfStopped(err, signal);
    assessed = false;
    for (const p of samples) p.areas = notDoneAreas(pageGrades.get(p.urlPath)!, 'ai-failed');
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
    siteAreas = notDoneAreas(siteGrades, 'ai-failed');
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
    record('recommendation', 'assessing', true);
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
    checks: analysis.marketing.checks.map((c) => (c.findingId ? { ...c, findingId: idMap.get(c.findingId) ?? c.findingId } : c)),
    signals: analysis.marketing.signals.map((s) => (s.findingIds ? { ...s, findingIds: re(s.findingIds) } : s)),
  };
  const citationProblems = checkCitations(findings, pages);

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

  // ---- 7. Save --------------------------------------------------------------------------------------
  stopIfAborted(signal);
  emit('saving');
  const { auditId, version, store } = deps;
  const saveNotes: string[] = [];
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
  // A finding pointing at a screenshot that was not saved loses the pointer.
  const savedShots = new Set(samples.map((p) => p.phone?.screenshotPath).filter((s): s is string => !!s));
  findings = findings.map((f) => {
    if (!f.screenshotPath || savedShots.has(f.screenshotPath)) return f;
    const { screenshotPath: _dropped, ...rest } = f;
    return rest;
  });
  notes.push(...saveNotes);

  const finishedAt = now().toISOString();
  const result: AuditResult = {
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

  try {
    await store.saveResult(auditId, version, result);
  } catch {
    record('saving', 'saving', false, NOTES.saving);
    throw new AuditPipelineError('save-failed');
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
