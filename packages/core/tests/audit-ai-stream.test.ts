/**
 * T-429: a page's AI assessment starts during the crawl, once its own checks are done; the checks that need the
 * whole site still run after the crawl on every page; and the provider's reported limit reaches the audit.
 * Real analysis, fake page stages and a fake AI: no browser, no network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import type { AreaAssessment, AuditFinding, AuditRequest, PageContent } from '@qa/types';
import { AUDIT_AREAS } from '@qa/types';
import { HostPacer } from '../src/host-pacer.js';
import type { AuditCrawlPage, AuditCrawlResult } from '../src/audit/crawl/crawl.js';
import { analyseSite, type AnalysisInput } from '../src/audit/analysis/analyse-site.js';
import { pageOwnFindings } from '../src/audit/analysis/analyse-site.js';
import { EMPTY_RAW_LISTS } from '../src/audit/analysis/raw-page.js';
import { createFindingIdAllocator } from '../src/audit/analysis/finding-ids.js';
import type { AssessPagesInput, PageAssessment } from '../src/audit/ai/assessment.js';
import { resolveAuditAi, type AuditAi, type AuditAiResolution } from '../src/audit/ai/stage-ai.js';
import {
  createAuditAssessmentStream,
  createPageRecorder,
  runAuditPipeline,
  type AuditPageRecorder,
  type PageStages,
  type SiteStages,
} from '../src/audit/pipeline/index.js';

const ORIGIN = 'https://stream.example';
const REQUEST: AuditRequest = {
  url: `${ORIGIN}/`,
  limits: { maxPages: 20, maxDepth: 3, includePaths: [], excludePaths: [] },
  language: 'en',
};
/** Five pages; /a and /b share a title, so a site-wide check (duplicate-title) has something to find. */
const PAGES: Array<{ urlPath: string; title: string; depth: number }> = [
  { urlPath: '/', title: 'Home', depth: 0 },
  { urlPath: '/a', title: 'Same title', depth: 1 },
  { urlPath: '/b', title: 'Same title', depth: 1 },
  { urlPath: '/c', title: 'Page C', depth: 1 },
  { urlPath: '/d', title: 'Page D', depth: 1 },
];

function content(urlPath: string, title: string): PageContent {
  return {
    urlPath,
    title,
    description: null,
    text: `Some words about ${title}.`,
    headings: [{ level: 1, text: title, sectionId: 's1' } as PageContent['headings'][number]],
    images: [],
    links: [],
    forms: [],
    ctas: [],
    language: { primary: 'en', others: [], declared: 'en' },
    sections: [{ id: 's1', kind: 'main', heading: title, start: 0, end: 5 }],
  };
}

function a11yFinding(id: string, urlPath: string): AuditFinding {
  return {
    id,
    rule: 'color-contrast',
    group: 'technical',
    area: 'accessibility',
    title: 'Low contrast text',
    detail: `On ${urlPath}: text is hard to read.`,
    suggestion: 'Raise the contrast.',
    impact: 'high',
    effort: 'low',
    urlPath,
    sectionId: null,
    source: 'checker',
    severity: 'Major',
    target: '#lead',
  };
}

function pageStages(): Partial<PageStages> {
  return {
    readPage: (async (page: Page) => {
      const p = PAGES.find((x) => `${ORIGIN}${x.urlPath}` === page.url())!;
      const raw = {
        ...EMPTY_RAW_LISTS,
        url: page.url(),
        title: p.title,
        description: null,
        lang: 'en',
        metaGenerator: null,
        socialMetaKeys: [],
        frameworkMarkers: [],
        menu: [],
        breadcrumb: [],
      };
      return { raw: raw as never, content: content(p.urlPath, p.title) };
    }) as never,
    accessibilityBasics: (async (_page: Page, opts: { urlPath: string; ids: { next(): string } }) => {
      const f = a11yFinding(opts.ids.next(), opts.urlPath);
      return {
        basics: {
          standard: 'WCAG 2.2',
          level: 'AA',
          method: 'automatic checks only',
          violations: 1,
          findingIds: [f.id],
        },
        findings: [f],
      };
    }) as never,
    recordPhoneLayout: (async () => ({
      phone: { widthPx: 375, screenshotPath: null, overflow: false, findingIds: [] },
      findings: [],
    })) as never,
    measureBrowserTiming: (async () => ({ speed: { status: 'not-measured' }, raw: {} })) as never,
  };
}

/** The fake AI cites the page's accessibility findings only: they exist with or without streaming. */
function fakeAssessPages(log: string[]) {
  return vi.fn(async (input: AssessPagesInput): Promise<PageAssessment[]> => {
    log.push(`assess:${input.pages.map((p) => p.urlPath).join(',')}`);
    return input.pages.map((p) => ({
      urlPath: p.urlPath,
      areas: AUDIT_AREAS.map((area): AreaAssessment => ({
        area,
        grade: null,
        status: 'done',
        note: `Note on ${area}`,
        evidence: p.findings.filter((f) => f.rule === 'color-contrast').map((f) => f.id),
      })),
    }));
  });
}

const AI: AuditAiResolution = { ok: true, ai: { provider: 'gemini', ask: vi.fn() } as unknown as AuditAi };

function siteStages(assess: SiteStages['assessPages'], analyse = vi.fn(analyseSite)): Partial<SiteStages> {
  return {
    analyseSite: analyse,
    measureSampleSpeeds: vi.fn(async () => []),
    assessPages: assess,
    assessSite: vi.fn(async () => []),
    recommendPages: vi.fn(async () => []),
    buildRoadmap: vi.fn(() => []),
    writeAllDocuments: vi.fn(async () => []),
  };
}

function store() {
  return {
    saveResult: vi.fn(async () => {}),
    writeVersionJson: vi.fn(async () => {}),
    putVersionFile: vi.fn(async () => {}),
    updateVersion: vi.fn(async () => ({}) as never),
  };
}

function crawlResult(): AuditCrawlResult {
  const pages: AuditCrawlPage[] = PAGES.map((p) => ({ urlPath: p.urlPath, title: p.title, depth: p.depth, links: [] }));
  return {
    startUrl: REQUEST.url,
    finalUrl: REQUEST.url,
    pages,
    coverage: { found: pages.length, reached: pages.length, skipped: [] },
    leavingSite: [],
    signInWalls: [],
    paymentAreas: [],
    pacer: new HostPacer({ minGapMs: 0 }),
    crawlDelayMs: null,
  };
}

/** The crawl: each page recorded, and (when streaming) handed to the stream once its own work has ended. */
async function crawl(recorder: AuditPageRecorder, onDone?: (urlPath: string) => void): Promise<void> {
  for (const p of PAGES) {
    const page = { url: () => `${ORIGIN}${p.urlPath}` } as unknown as Page;
    await recorder.onRenderedPage(page, { urlPath: p.urlPath, title: p.title, depth: p.depth, links: [] });
    onDone?.(p.urlPath);
  }
}

let workDir: string;
beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-ai-stream-'));
});
afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
});

describe('T-429: AI assessment starts during the crawl', () => {
  it('AI requests start before the crawl ends', async () => {
    const log: string[] = [];
    const assess = fakeAssessPages(log);
    const recorder = createPageRecorder({ workDir, stages: pageStages() });
    const stream = createAuditAssessmentStream({ ai: AI, language: 'en', assessPages: assess });
    await crawl(recorder, (urlPath) => {
      stream.add(recorder.pages.find((e) => e.info.urlPath === urlPath)!);
      log.push(`recorded:${urlPath}`);
    });
    log.push('crawl-ended');
    // Four small pages make a batch: their request went out while the crawl was still recording the fifth.
    expect(log.indexOf('assess:/,/a,/b,/c')).toBeGreaterThan(-1);
    expect(log.indexOf('assess:/,/a,/b,/c')).toBeLessThan(log.indexOf('recorded:/d'));
    await stream.settle();
    expect(log.slice(log.indexOf('crawl-ended'))).toContain('assess:/d');
    expect([...stream.answers().keys()].sort()).toEqual(['/', '/a', '/b', '/c', '/d']);
  });

  it('the site-wide checks still see every page, and page findings match a run where nothing streams', async () => {
    const run = async (streaming: boolean) => {
      const log: string[] = [];
      const assess = fakeAssessPages(log);
      const analyse = vi.fn(analyseSite);
      const recorder = createPageRecorder({ workDir, stages: pageStages() });
      const stream = streaming
        ? createAuditAssessmentStream({ ai: AI, language: 'en', assessPages: assess })
        : undefined;
      await crawl(recorder, (urlPath) => stream?.add(recorder.pages.find((e) => e.info.urlPath === urlPath)!));
      const outcome = await runAuditPipeline(crawlResult(), {
        auditId: 'audit_stream_01',
        version: 1,
        request: REQUEST,
        startedAt: '2026-11-19T00:00:00.000Z',
        recorder,
        store: store() as never,
        workDir,
        ai: AI,
        stages: siteStages(assess, analyse),
        now: () => new Date('2026-11-19T01:00:00.000Z'),
        ...(stream ? { stream } : {}),
      });
      return { outcome, assess, analyse };
    };

    const streamed = await run(true);
    const plain = await run(false);

    // The site-wide checks ran once, after the crawl, on all five pages.
    expect(streamed.analyse).toHaveBeenCalledTimes(1);
    const input = streamed.analyse.mock.calls[0][0] as AnalysisInput;
    expect(input.pages.map((p) => p.urlPath)).toEqual(PAGES.map((p) => p.urlPath));
    const duplicates = streamed.outcome.result.findings.filter((f) => f.rule === 'duplicate-title');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].pages).toEqual(['/a', '/b']);
    // Every page was assessed during the crawl: none was asked again after it.
    const askedAfter = streamed.assess.mock.calls.filter(([i]) => i.limiter && i.aiInFlight !== undefined);
    expect(askedAfter.flatMap(([i]) => i.pages)).toEqual([]);

    // Same findings, same ids; each page's notes cite the same final findings as without streaming.
    const summary = (f: AuditFinding) => [f.id, f.rule, f.urlPath, f.target ?? ''].join('|');
    expect(streamed.outcome.result.findings.map(summary)).toEqual(plain.outcome.result.findings.map(summary));
    for (const page of plain.outcome.result.pages) {
      const other = streamed.outcome.result.pages.find((p) => p.urlPath === page.urlPath)!;
      expect(other.areas, page.urlPath).toEqual(page.areas);
      const cited = page.areas!.flatMap((a) => (a.status === 'done' ? a.evidence : []));
      expect(cited.length, page.urlPath).toBeGreaterThan(0);
    }
  });

  it("a page's own checks are the per-page rules and its accessibility findings, never the site-wide ones", () => {
    const own = pageOwnFindings(
      { urlPath: '/a', content: content('/a', 'Same title') },
      { basics: null, findings: [a11yFinding('AF-009', '/a')] },
      createFindingIdAllocator()
    );
    expect(own.map((f) => f.rule).sort()).toEqual(['color-contrast', 'missing-description']);
    expect(own.map((f) => f.id)).toEqual(['AF-001', 'AF-002']);
  });
});

describe("T-429: the provider's reported limit", () => {
  const keys = { resolveKey: async () => ({ provider: 'openrouter' as const, apiKey: 'test-key' }) } as never;
  const createProvider = () => ({}) as never;

  it('a reported limit reaches the audit, at most 8; without one, 4', async () => {
    const reported = await resolveAuditAi({
      setup: { provider: 'openrouter' },
      keys,
      createProvider,
      providerLimits: async () => ({ requestsPerInterval: 20, intervalMs: 10_000 }),
    });
    const none = await resolveAuditAi({ setup: { provider: 'openrouter' }, keys, createProvider });
    expect(reported.ok && reported.ai.reportedLimit).toBe(20);
    expect(none.ok && none.ai.reportedLimit).toBeUndefined();

    const inFlight = async (ai: AuditAiResolution) => {
      const assess = vi.fn(async (input: AssessPagesInput) =>
        input.pages.map((p) => ({ urlPath: p.urlPath, areas: [] as AreaAssessment[] }))
      );
      const recorder = createPageRecorder({ workDir, stages: pageStages() });
      await crawl(recorder);
      await runAuditPipeline(crawlResult(), {
        auditId: 'audit_stream_02',
        version: 1,
        request: REQUEST,
        startedAt: '2026-11-19T00:00:00.000Z',
        recorder,
        store: store() as never,
        workDir,
        ai,
        stages: siteStages(assess as never),
      });
      return assess.mock.calls[0][0].aiInFlight;
    };
    expect(await inFlight(reported)).toBe(8);
    expect(await inFlight(none)).toBe(4);
  });
});
