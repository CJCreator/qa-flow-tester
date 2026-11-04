/**
 * BE-192: the Website Audit pipeline, crawl to saved AuditResult. Every stage is a fake; no browser, no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import type {
  AreaAssessment,
  AuditFinding,
  AuditProgressEvent,
  AuditRequest,
  AuditResult,
  Finding,
  PageContent,
  PageRecommendation,
  PageSpeed,
  RoadmapItem,
} from '@qa/types';
import { AUDIT_AREAS, MARKETING_SIGNALS } from '@qa/types';

const { fakeFetch } = vi.hoisted(() => ({ fakeFetch: vi.fn() }));
vi.mock('../src/checker-fetch.js', () => ({
  makeCheckerFetch: vi.fn(() => fakeFetch),
}));

import { makeCheckerFetch } from '../src/checker-fetch.js';
import { HostPacer } from '../src/host-pacer.js';
import { abortError } from '../src/abort.js';
import type { AuditCrawlPage, AuditCrawlResult } from '../src/audit/crawl/crawl.js';
import type { AnalysisInput, SiteAnalysis } from '../src/audit/analysis/analyse-site.js';
import type { AccessibilityBasicsResult } from '../src/audit/analysis/accessibility-basics.js';
import type { RawPage } from '../src/audit/analysis/raw-page.js';
import type { PhoneLayoutRecord } from '../src/audit/phone-layout.js';
import type { AssessPagesInput, AssessSiteInput, PageAssessment } from '../src/audit/ai/assessment.js';
import type { RecommendPagesInput } from '../src/audit/ai/page-recommendation.js';
import {
  AuditPipelineError,
  areaGrades,
  createPageRecorder,
  pageContentName,
  runAuditPipeline,
  type AuditPipelineDeps,
  type AuditPipelineStore,
  type PageStages,
  type PipelineStepOutcome,
  type SiteStages,
} from '../src/audit/pipeline/index.js';

const AUDIT_ID = 'audit_test_0001';
const ORIGIN = 'https://shop.example';
const REQUEST: AuditRequest = {
  url: `${ORIGIN}/`,
  limits: { maxPages: 20, maxDepth: 3, includePaths: [], excludePaths: [] },
  language: 'en',
};

function content(urlPath: string, title: string): PageContent {
  return {
    urlPath,
    title,
    description: null,
    text: 'Hello there',
    headings: [{ level: 1, text: title, sectionId: 's1' } as PageContent['headings'][number]],
    images: [],
    links: [],
    forms: [],
    ctas: [],
    language: { primary: 'en', others: [], declared: 'en' },
    sections: [
      { id: 's1', kind: 'main', heading: title, start: 0, end: 5 },
      { id: 's2', kind: 'footer', start: 5, end: 11 },
    ],
  };
}

function crawlPage(urlPath: string, depth: number, layoutGroup?: string): AuditCrawlPage {
  return { urlPath, title: urlPath, depth, links: [], ...(layoutGroup ? { layoutGroup } : {}) };
}

/** Home, /about, then five product pages from one template: the 4th and 5th are covered. */
const CRAWL_PAGES: AuditCrawlPage[] = [
  crawlPage('/', 0),
  crawlPage('/about', 1),
  crawlPage('/products/item-1', 1, 'layout-2'),
  crawlPage('/products/item-2', 1, 'layout-2'),
  crawlPage('/products/item-3', 1, 'layout-2'),
  crawlPage('/products/item-4', 1, 'layout-2'),
];
const SAMPLE_PATHS = ['/', '/about', '/products/item-1', '/products/item-2', '/products/item-3'];

function crawlResult(): AuditCrawlResult {
  return {
    startUrl: REQUEST.url,
    finalUrl: `${ORIGIN}/`,
    pages: CRAWL_PAGES,
    coverage: {
      found: CRAWL_PAGES.length + 2,
      reached: CRAWL_PAGES.length,
      skipped: [
        { urlPath: '/login', why: 'sign-in' } as AuditCrawlResult['coverage']['skipped'][number],
        { urlPath: '/gone', why: 'http-error', status: 404 } as AuditCrawlResult['coverage']['skipped'][number],
      ],
    },
    leavingSite: [{ to: 'https://other.example/', from: ['/'] }],
    signInWalls: ['/login'],
    paymentAreas: [],
    pacer: new HostPacer({ minGapMs: 0 }),
    crawlDelayMs: null,
  };
}

function finding(id: string, urlPath: string, over: Partial<AuditFinding> = {}): AuditFinding {
  return {
    id,
    rule: 'missing-alt',
    group: 'technical',
    area: 'content',
    title: `Finding ${id}`,
    detail: 'An image has no alt text.',
    suggestion: 'Add alt text.',
    impact: 'low',
    effort: 'low',
    urlPath,
    sectionId: 's1',
    source: 'rule',
    ...over,
  };
}

function phoneCheckerFinding(urlPath: string): Finding {
  return {
    id: `F-UX-TARGET-${urlPath}-1`,
    severity: 'Major',
    checker: 'ux-quality',
    title: 'Touch target too small: "Buy" (20x20px)',
    where: { urlPath, role: 'visitor', breakpoint: '375px', cssSelector: '#buy' },
    expectedVsActual: { expected: '44x44', actual: 'The "Buy" button is 20x20px.' },
    stepsToReproduce: [],
    evidence: {},
    resolution: 'Make the button at least 44px.',
  };
}

const MEASURED: PageSpeed = {
  lab: {
    status: 'measured',
    source: 'pagespeed-insights',
    method: 'lab',
    strategy: 'mobile',
    values: [{ metric: 'performance-score', value: 95, unit: 'score' }],
    measuredAt: '2026-11-03T00:00:00.000Z',
  },
  field: { status: 'not-measured', source: 'pagespeed-insights', method: 'field', reason: 'no-field-data' },
};

/** A call log shared by every fake, to check the order of the stages. */
let calls: string[];
let workDir: string;

function pageStages(over: Partial<PageStages> = {}): Partial<PageStages> {
  return {
    readPage: vi.fn(async (page: Page) => {
      const urlPath = (page as unknown as { urlPath: string }).urlPath;
      calls.push(`read:${urlPath}`);
      return { raw: { url: `${ORIGIN}${urlPath}` } as RawPage, content: content(urlPath, `Title ${urlPath}`) };
    }),
    accessibilityBasics: vi.fn(async (_page: Page, opts): Promise<AccessibilityBasicsResult> => {
      calls.push(`a11y:${opts.urlPath}`);
      const id = opts.ids.next();
      const f = finding(id, opts.urlPath, {
        rule: 'color-contrast',
        area: 'accessibility',
        source: 'checker',
        sectionId: null,
        severity: 'Major',
        impact: 'high',
      });
      return {
        basics: { standard: 'WCAG 2.2', level: 'AA', method: 'automatic checks only', violations: 1, findingIds: [id] },
        findings: [f],
      };
    }),
    recordPhoneLayout: vi.fn(async (_page: Page, opts): Promise<PhoneLayoutRecord> => {
      calls.push(`phone:${opts.urlPath}`);
      const rel = `phone/${opts.urlPath.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}.png`;
      await fs.mkdir(path.join(opts.versionDir, 'phone'), { recursive: true });
      await fs.writeFile(path.join(opts.versionDir, rel), Buffer.from('png'));
      const f = phoneCheckerFinding(opts.urlPath);
      return { phone: { widthPx: 375, screenshotPath: rel, overflow: false, findingIds: [f.id] }, findings: [f] };
    }),
    ...over,
  };
}

/** A fake analysis: one rule finding per page (AF-001...), SEO basics citing it, accessibility re-pointed. */
function fakeAnalyse(input: AnalysisInput): SiteAnalysis {
  let n = input.firstFindingNumber;
  const next = () => `AF-${String(n++).padStart(3, '0')}`;
  const findings: AuditFinding[] = [];
  const pages = input.pages.map((p) => {
    const own = finding(next(), p.urlPath);
    findings.push(own);
    const a11y = input.accessibility.find((a) => a.urlPath === p.urlPath);
    let accessibility;
    if (a11y?.basics) {
      const ids = a11y.findings.map((f) => {
        const id = next();
        findings.push({ ...f, id });
        return id;
      });
      accessibility = { ...a11y.basics, violations: ids.length, findingIds: ids };
    }
    return {
      urlPath: p.urlPath,
      title: p.content.title,
      depth: p.depth,
      language: p.content.language,
      sections: p.content.sections.map((s) => ({ id: s.id, kind: s.kind })),
      seo: {
        hasTitle: true,
        hasDescription: false,
        h1Count: 1,
        skippedHeadingLevel: false,
        imagesWithoutAlt: 1,
        htmlLang: 'en',
        findingIds: [own.id],
      },
      ...(accessibility ? { accessibility } : {}),
    };
  });
  return {
    technology: { status: 'not-identified' },
    hierarchy: { root: { urlPath: '/', title: 'Home', placedBy: 'start', children: [] }, links: [] },
    internalLinking: { inboundCounts: {}, unlinkedPages: [] },
    pages,
    findings,
    marketing: {
      readPages: input.pages.map((p) => p.urlPath),
      checks: [],
      signals: MARKETING_SIGNALS.map((s) => ({
        key: s.key,
        label: s.label,
        status: 'found',
        pages: ['/'],
        detail: 'x',
        findingIds: [findings[0].id],
      })),
    },
    nextFindingNumber: n,
    notes: [],
  };
}

function aiAreas(findings: AuditFinding[]): AreaAssessment[] {
  return AUDIT_AREAS.map((area) => ({
    area,
    grade: 'A',
    status: 'done',
    note: `Note for ${area}`,
    evidence: findings.slice(0, 1).map((f) => f.id),
  }));
}

function siteStages(over: Partial<SiteStages> = {}): Partial<SiteStages> {
  return {
    analyseSite: vi.fn(async (input: AnalysisInput) => {
      calls.push('analyse');
      return fakeAnalyse(input);
    }),
    measureSampleSpeeds: vi.fn(async (urls: readonly string[]) => {
      calls.push('speed');
      return urls.map((url) => ({ url, speed: MEASURED }));
    }),
    assessPages: vi.fn(async (input: AssessPagesInput): Promise<PageAssessment[]> => {
      calls.push('assessPages');
      return input.pages.map((p) => ({ urlPath: p.urlPath, areas: aiAreas(p.findings) }));
    }),
    assessSite: vi.fn(async (input: AssessSiteInput) => {
      calls.push('assessSite');
      return aiAreas(input.findings);
    }),
    recommendPages: vi.fn(async (input: RecommendPagesInput): Promise<PageRecommendation[]> => {
      calls.push('recommend');
      return input.pages.map((p) => ({
        urlPath: p.urlPath,
        action: 'repair',
        reason: 'Small fixes.',
        findingIds: p.findings.map((f) => f.id),
        decidedBy: 'ai',
      }));
    }),
    buildRoadmap: vi.fn((findings: readonly AuditFinding[]): RoadmapItem[] => {
      calls.push('roadmap');
      return [
        {
          id: 'R1',
          title: 'Fix',
          priority: 'high',
          phase: 1,
          effort: 'low',
          findingIds: findings.map((f) => f.id),
          pages: ['/'],
        },
      ];
    }),
    ...over,
  };
}

function memoryStore() {
  const json = new Map<string, unknown>();
  const files = new Map<string, Uint8Array>();
  const results: AuditResult[] = [];
  const store = {
    saveResult: vi.fn(async (_id: string, _v: number, result: AuditResult) => {
      calls.push('save');
      results.push(JSON.parse(JSON.stringify(result)));
    }),
    writeVersionJson: vi.fn(async (_id: string, _v: number, name: string, value: unknown) => {
      json.set(name, value);
    }),
    putVersionFile: vi.fn(async (_id: string, _v: number, name: string, data: Uint8Array) => {
      files.set(name, data);
    }),
    updateVersion: vi.fn(async () => ({}) as never),
  };
  return { store: store as unknown as AuditPipelineStore & typeof store, json, files, results };
}

/** Runs the recorder over the crawl's pages as runAuditCrawl's onRenderedPage would. */
async function recordCrawl(stages: Partial<PageStages> = pageStages()) {
  const recorder = createPageRecorder({ workDir, stages });
  for (const p of CRAWL_PAGES) await recorder.onRenderedPage({ urlPath: p.urlPath } as unknown as Page, p);
  return recorder;
}

async function run(
  over: Partial<AuditPipelineDeps> = {},
  stages: Partial<SiteStages> = siteStages(),
  crawl: AuditCrawlResult = crawlResult()
) {
  const recorder = over.recorder ?? (await recordCrawl());
  const mem = memoryStore();
  const events: AuditProgressEvent[] = [];
  const steps: PipelineStepOutcome[] = [];
  const pacer = new HostPacer({ minGapMs: 0 });
  const outcome = runAuditPipeline(crawl, {
    auditId: AUDIT_ID,
    version: 1,
    request: REQUEST,
    startedAt: '2026-11-03T00:00:00.000Z',
    recorder,
    store: mem.store,
    workDir,
    pacer,
    ai: { ok: false, reason: 'no-ai-key' },
    now: () => new Date('2026-11-03T00:05:00.000Z'),
    onProgress: (e) => events.push(e),
    onStep: (s) => steps.push(s),
    stages,
    ...over,
  });
  return { outcome, mem, events, steps, pacer, stages };
}

beforeEach(async () => {
  calls = [];
  vi.mocked(makeCheckerFetch).mockClear();
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-pipeline-'));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('audit pipeline: page recorder (stage 1, inside the crawl hook)', () => {
  it('reads every page once and runs accessibility then phone layout on Sample Pages only', async () => {
    const stages = pageStages();
    const recorder = await recordCrawl(stages);
    // Same page again (the crawl reporting it twice) is not visited again.
    await recorder.onRenderedPage({ urlPath: '/' } as unknown as Page, CRAWL_PAGES[0]);

    expect(stages.readPage).toHaveBeenCalledTimes(CRAWL_PAGES.length);
    expect(calls.filter((c) => c.startsWith('read:'))).toEqual(CRAWL_PAGES.map((p) => `read:${p.urlPath}`));
    expect(calls.filter((c) => c.startsWith('a11y:'))).toEqual(SAMPLE_PATHS.map((p) => `a11y:${p}`));
    expect(calls.filter((c) => c.startsWith('phone:'))).toEqual(SAMPLE_PATHS.map((p) => `phone:${p}`));
    // Per page: read, then accessibility, then phone layout (it resizes the page).
    expect(calls.slice(0, 3)).toEqual(['read:/', 'a11y:/', 'phone:/']);

    const covered = recorder.pages.find((p) => p.info.urlPath === '/products/item-4')!;
    expect(covered.coverage).toBe('covered');
    expect(covered.sampleUrlPath).toBe('/products/item-1');
    expect(covered.accessibility).toBeUndefined();
    expect(covered.phone).toBeUndefined();
    expect(recorder.layoutGroups().get('/products/item-4')).toBe('group-1');

    // Unique testCaseId per page so checker ids never collide.
    const ids = vi.mocked(stages.recordPhoneLayout!).mock.calls.map((c) => c[1].testCaseId);
    expect(new Set(ids).size).toBe(SAMPLE_PATHS.length);
  });

  it('never throws: a page that cannot be read is kept as unread and the crawl goes on', async () => {
    const stages = pageStages({
      readPage: vi.fn(async (page: Page) => {
        const urlPath = (page as unknown as { urlPath: string }).urlPath;
        if (urlPath === '/about') throw new Error('page closed');
        return { raw: {} as RawPage, content: content(urlPath, 'T') };
      }),
      accessibilityBasics: vi.fn(async () => {
        throw new Error('axe failed');
      }),
    });
    const recorder = await recordCrawl(stages);
    expect(recorder.pages).toHaveLength(CRAWL_PAGES.length);
    expect(recorder.pages.find((p) => p.info.urlPath === '/about')!.read).toBeNull();
    expect(recorder.pages[0].accessibility).toBeNull();
  });
});

describe('audit pipeline: runAuditPipeline', () => {
  it('runs the stages in order and builds a ranked, cited, graded and saved AuditResult', async () => {
    const { outcome, mem, events, steps, pacer, stages } = await run();
    const { result, citationProblems } = await outcome;

    // Stage order (calls after the crawl hook) and progress events.
    const after = calls.filter((c) => !/^(read|a11y|phone):/.test(c));
    expect(after).toEqual(['analyse', 'speed', 'assessPages', 'assessSite', 'recommend', 'roadmap', 'save']);
    expect(events.map((e) => (e.type === 'progress' ? e.stage : e.type))).toEqual([
      'checking-pages',
      'measuring-speed',
      'assessing',
      'ranking',
      'saving',
    ]);
    expect(events[0]).toMatchObject({
      auditId: AUDIT_ID,
      version: 1,
      pagesFound: 8,
      pagesRecorded: 6,
      pagesSkipped: 2,
    });
    expect(steps.every((s) => s.status === 'done')).toBe(true);
    expect(steps.map((s) => s.step)).toEqual([
      'reading',
      'analysis',
      'speed',
      'assessment',
      'recommendation',
      'ranking',
      'roadmap',
      'saving',
    ]);

    // Analysis requests: makeCheckerFetch, public only, no redirects (default), the audit's pacer.
    expect(makeCheckerFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(makeCheckerFetch).mock.calls[0][0]).toMatchObject({ allowPrivate: false, pacer });
    expect(vi.mocked(makeCheckerFetch).mock.calls[0][0]).not.toHaveProperty('maxRedirects');
    const analysisInput = vi.mocked(stages.analyseSite!).mock.calls[0][0];
    expect(analysisInput.fetch).toBe(fakeFetch);
    expect(analysisInput.origin).toBe(ORIGIN);
    expect(analysisInput.startPath).toBe('/');
    expect(analysisInput.skippedPaths).toEqual(['/login']);
    expect(analysisInput.statusByPath).toEqual({ '/gone': 404 });
    expect(analysisInput.accessibility.map((a) => a.urlPath)).toEqual(SAMPLE_PATHS);

    // Speed for Sample Pages only, by absolute address.
    expect(vi.mocked(stages.measureSampleSpeeds!).mock.calls[0][0]).toEqual(SAMPLE_PATHS.map((p) => `${ORIGIN}${p}`));

    // Pages: sample/covered, layout group, phone, speed, areas and recommendation on Sample Pages only.
    expect(result.pages.map((p) => p.urlPath)).toEqual(CRAWL_PAGES.map((p) => p.urlPath));
    const covered = result.pages.find((p) => p.urlPath === '/products/item-4')!;
    expect(covered).toMatchObject({ coverage: 'covered', sampleUrlPath: '/products/item-1', layoutGroup: 'group-1' });
    expect(covered.areas).toBeUndefined();
    expect(covered.recommendation).toBeUndefined();
    for (const p of result.pages.filter((x) => x.coverage === 'sample')) {
      expect(p.speed).toEqual(MEASURED);
      expect(p.areas!.map((a) => a.area)).toEqual([...AUDIT_AREAS]);
      expect(p.recommendation!.urlPath).toBe(p.urlPath);
      expect(p.phone!.screenshotPath).toMatch(/^phone\//);
    }

    // Findings: 6 rule + 5 accessibility from the analysis, then 5 phone findings continuing the numbers.
    expect(result.findings).toHaveLength(16);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toEqual(ids.map((_, i) => `AF-${String(i + 1).padStart(3, '0')}`));
    // Ranked: impact high first, then lower effort.
    const order = { high: 0, medium: 1, low: 2 } as const;
    const ranks = result.findings.map((f) => order[f.impact]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const phoneFindings = result.findings.filter((f) => f.area === 'usability');
    expect(phoneFindings).toHaveLength(5);
    expect(phoneFindings[0]).toMatchObject({
      rule: 'tap-target',
      source: 'checker',
      severity: 'Major',
      target: '#buy',
    });
    expect(phoneFindings.every((f) => f.findingId?.startsWith('F-UX-TARGET-'))).toBe(true);

    // Every list citing a finding follows the renumbering: each cited id exists and is on that page.
    const byId = new Map(result.findings.map((f) => [f.id, f]));
    for (const p of result.pages) {
      for (const id of p.seo.findingIds) expect(byId.get(id)!.urlPath).toBe(p.urlPath);
      for (const id of p.accessibility?.findingIds ?? []) expect(byId.get(id)!.area).toBe('accessibility');
      for (const id of p.phone?.findingIds ?? []) expect(byId.get(id)!.area).toBe('usability');
      for (const id of p.recommendation?.findingIds ?? []) expect(byId.get(id)!.urlPath).toBe(p.urlPath);
      for (const a of p.areas ?? [])
        if (a.status === 'done') for (const id of a.evidence) expect(byId.get(id)!.urlPath).toBe(p.urlPath);
      expect(p.recommendation?.findingIds.length ?? 0).toBe(p.coverage === 'sample' ? 3 : 0);
    }
    for (const s of result.marketing.signals) for (const id of s.findingIds ?? []) expect(byId.has(id)).toBe(true);

    // Grades are the deterministic ones, whatever the AI said ('A' in the fake).
    const home = result.pages[0];
    const homeA11y = home.areas!.find((a) => a.area === 'accessibility')!;
    expect(homeA11y.grade).toBe('B'); // one Major
    expect(home.areas!.find((a) => a.area === 'speed')!.grade).toBe('A'); // lab score 95
    expect(result.siteAreas.map((a) => a.area)).toEqual([...AUDIT_AREAS]);
    expect(result.siteAreas.find((a) => a.area === 'usability')!.grade).not.toBeNull();

    // Roadmap from the ranked findings.
    expect(vi.mocked(stages.buildRoadmap!).mock.calls[0][0].map((f) => f.id)).toEqual(ids);
    expect(result.roadmap[0].findingIds).toEqual(ids);

    // Citations: rule findings cite real Sections; whole-page checker findings are reported, never dropped.
    expect(citationProblems.every((c) => c.kind === 'missing-section')).toBe(true);
    expect(result.findings).toHaveLength(16);

    // Saved through the store: Page Content per page, phone screenshots, the result, then the version.
    expect(mem.results).toHaveLength(1);
    expect(mem.results[0]).toEqual(JSON.parse(JSON.stringify(result)));
    for (const p of CRAWL_PAGES) expect(mem.json.has(pageContentName(p.urlPath))).toBe(true);
    expect(mem.json.get('stages')).toBeDefined();
    expect([...mem.files.keys()].sort()).toEqual(
      result.pages
        .filter((p) => p.phone)
        .map((p) => p.phone!.screenshotPath)
        .sort()
    );
    expect(mem.store.updateVersion).toHaveBeenCalledWith(AUDIT_ID, 1, {
      status: 'done',
      finishedAt: '2026-11-03T00:05:00.000Z',
      pagesRecorded: 6,
      pagesSkipped: 2,
      findings: 16,
    });
    expect(result).toMatchObject({
      auditId: AUDIT_ID,
      version: 1,
      url: REQUEST.url,
      language: 'en',
      startedAt: '2026-11-03T00:00:00.000Z',
      finishedAt: '2026-11-03T00:05:00.000Z',
      leavingSite: [{ to: 'https://other.example/', from: ['/'] }],
    });
    expect(result.notes).toContain('AI notes need an AI key.');
  });

  it('records a failed analysis as not done and still runs the later stages', async () => {
    const stages = siteStages({
      analyseSite: vi.fn(async () => {
        throw new Error('boom: internal detail');
      }),
    });
    const { outcome, steps, mem } = await run({}, stages);
    const { result } = await outcome;

    expect(steps.find((s) => s.step === 'analysis')).toMatchObject({ status: 'not-done', stage: 'checking-pages' });
    expect(result.notes.some((n) => n.includes('page checks did not finish'))).toBe(true);
    expect(result.notes.join(' ')).not.toContain('internal detail');
    expect(calls.filter((c) => !/^(read|a11y|phone):/.test(c))).toEqual([
      'speed',
      'assessPages',
      'assessSite',
      'recommend',
      'roadmap',
      'save',
    ]);
    // Never a clean result: unchecked areas have no grade, marketing signals are 'not-checked'.
    expect(result.siteAreas.find((a) => a.area === 'search-ranking')!.grade).toBeNull();
    expect(result.siteAreas.find((a) => a.area === 'content')!.grade).toBeNull();
    expect(result.marketing.signals.every((s) => s.status === 'not-checked')).toBe(true);
    expect(result.pages).toHaveLength(CRAWL_PAGES.length);
    // Phone findings still numbered from AF-001.
    expect(result.findings.map((f) => f.area)).toEqual(Array(5).fill('usability'));
    expect(mem.results).toHaveLength(1);
  });

  it('records failed AI stages as not done: areas not-done with grades, recommendation by the fixed rule', async () => {
    const stages = siteStages({
      assessPages: vi.fn(async () => {
        throw new Error('AI down');
      }),
      assessSite: vi.fn(async () => {
        throw new Error('AI down');
      }),
      recommendPages: vi.fn(async () => {
        throw new Error('AI down');
      }),
    });
    const { outcome, steps } = await run({}, stages);
    const { result } = await outcome;

    expect(steps.find((s) => s.step === 'assessment')!.status).toBe('not-done');
    expect(steps.find((s) => s.step === 'recommendation')!.status).toBe('not-done');
    const home = result.pages[0];
    for (const a of home.areas!) expect(a).toMatchObject({ status: 'not-done', reason: 'ai-failed' });
    expect(home.areas!.find((a) => a.area === 'accessibility')!.grade).toBe('B');
    expect(result.siteAreas.every((a) => a.status === 'not-done')).toBe(true);
    expect(home.recommendation!.decidedBy).toBe('rule');
    expect(steps.find((s) => s.step === 'ranking')!.status).toBe('done');
  });

  it('records failed speed and roadmap steps as not done; speed is never shown as measured', async () => {
    const stages = siteStages({
      measureSampleSpeeds: vi.fn(async () => {
        throw new Error('no network');
      }),
      buildRoadmap: vi.fn(() => {
        throw new Error('bad');
      }),
    });
    const { outcome, steps, mem } = await run({}, stages);
    const { result } = await outcome;

    expect(steps.find((s) => s.step === 'speed')!.status).toBe('not-done');
    expect(steps.find((s) => s.step === 'roadmap')!.status).toBe('not-done');
    for (const p of result.pages.filter((x) => x.coverage === 'sample')) {
      expect(p.speed!.lab.status).toBe('not-measured');
      expect(p.areas!.find((a) => a.area === 'speed')!.grade).toBeNull();
    }
    expect(result.roadmap).toEqual([]);
    expect(mem.results).toHaveLength(1);
  });

  it('records unread pages and failed accessibility as not done in the reading step', async () => {
    const recorder = await recordCrawl(
      pageStages({
        readPage: vi.fn(async (page: Page) => {
          const urlPath = (page as unknown as { urlPath: string }).urlPath;
          if (urlPath === '/about') throw new Error('closed');
          return { raw: {} as RawPage, content: content(urlPath, 'T') };
        }),
        accessibilityBasics: vi.fn(async (_page: Page, opts) => {
          if (opts.urlPath === '/') throw new Error('axe');
          return { basics: null, findings: [], note: 'not run' };
        }),
      })
    );
    const { outcome, steps } = await run({ recorder });
    const { result } = await outcome;
    expect(steps[0]).toMatchObject({ step: 'reading', status: 'not-done' });
    expect(result.pages.map((p) => p.urlPath)).not.toContain('/about');
    expect(result.notes.some((n) => n.includes('could not be read'))).toBe(true);
    expect(result.notes).toContain('The accessibility checks did not run on /, so this page has not been checked.');
    expect(result.pages[0].areas!.find((a) => a.area === 'accessibility')!.grade).toBeNull();
  });

  it('throws AuditPipelineError when the result cannot be saved, and records the save as not done', async () => {
    const { outcome, mem, steps } = await run();
    mem.store.saveResult.mockRejectedValueOnce(new Error('disk full'));
    await expect(outcome).rejects.toBeInstanceOf(AuditPipelineError);
    await expect(outcome).rejects.toThrow('The audit could not be saved.');
    expect(steps.at(-1)).toMatchObject({ step: 'saving', status: 'not-done' });
    expect(mem.store.updateVersion).not.toHaveBeenCalled();
    await expect(outcome).rejects.toMatchObject({ code: 'save-failed' });
  });

  it('retries updateVersion once: a passing blip after a stored result still completes', async () => {
    const { outcome, mem } = await run();
    mem.store.updateVersion.mockRejectedValueOnce(new Error('blip'));
    await expect(outcome).resolves.toBeDefined();
    expect(mem.results).toHaveLength(1);
    expect(mem.store.updateVersion).toHaveBeenCalledTimes(2);
  });

  it("throws a distinct 'status-not-updated' error when the result is stored but updateVersion fails twice", async () => {
    const { outcome, mem } = await run();
    mem.store.updateVersion.mockRejectedValue(new Error('db down'));
    await expect(outcome).rejects.toBeInstanceOf(AuditPipelineError);
    await expect(outcome).rejects.toMatchObject({ code: 'status-not-updated' });
    await expect(outcome).rejects.toThrow('saved, but its status could not be updated');
    expect(mem.results).toHaveLength(1);
    expect(mem.store.updateVersion).toHaveBeenCalledTimes(2);
  });

  it("analysis uses the crawl's own pacer when no override is given", async () => {
    const crawl = crawlResult();
    crawl.crawlDelayMs = 2000;
    const { outcome } = await run({ pacer: undefined }, siteStages(), crawl);
    await outcome;
    expect(vi.mocked(makeCheckerFetch).mock.calls.at(-1)![0]).toMatchObject({
      allowPrivate: false,
      pacer: crawl.pacer,
    });
  });

  it('a lost phone screenshot is not cited: the page and its findings drop the path', async () => {
    const { outcome, mem } = await run();
    mem.store.putVersionFile.mockRejectedValueOnce(new Error('denied'));
    const { result, steps } = await outcome;
    const home = result.pages[0];
    expect(home.phone!.screenshotPath).toBeNull();
    expect(
      result.findings.filter((f) => f.urlPath === '/' && f.area === 'usability').every((f) => !f.screenshotPath)
    ).toBe(true);
    expect(steps.find((s) => s.step === 'saving')!.status).toBe('not-done');
  });

  it('stops at once on abort: nothing is saved', async () => {
    const controller = new AbortController();
    const stages = siteStages({
      analyseSite: vi.fn(async () => {
        controller.abort();
        throw abortError();
      }),
    });
    const { outcome, mem } = await run({ signal: controller.signal }, stages);
    await expect(outcome).rejects.toMatchObject({ name: 'AbortError' });
    expect(mem.store.saveResult).not.toHaveBeenCalled();
    expect(stages.measureSampleSpeeds).not.toHaveBeenCalled();
  });
});

describe('audit pipeline: area grades', () => {
  const none = {
    'search-ranking': false,
    marketing: false,
    usability: false,
    content: false,
    accessibility: false,
    speed: false,
  };

  it('leaves an area nothing checked without a grade, never an A', () => {
    expect(Object.values(areaGrades([], none, null))).toEqual(Array(6).fill(null));
  });

  it('grades a checked area from its findings and speed from the lab score', () => {
    const grades = areaGrades(
      [finding('AF-001', '/', { area: 'accessibility', severity: 'Blocker', impact: 'high' })],
      { ...none, accessibility: true, content: true },
      30
    );
    expect(grades.accessibility).toBe('D');
    expect(grades.content).toBe('A');
    expect(grades.speed).toBe('F');
    expect(grades.marketing).toBeNull();
  });

  it('ignores AI findings in grades (ADR 0009)', () => {
    const grades = areaGrades(
      [finding('AF-001', '/', { area: 'content', source: 'ai', advisory: true, impact: 'high' })],
      { ...none, content: true },
      null
    );
    expect(grades.content).toBe('A');
  });
});
