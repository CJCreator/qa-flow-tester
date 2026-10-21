import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Finding, SiteAspectGrades, DiscoveryDraft } from '@qa/types';
import { SiteHistoryManager, MAX_HISTORY_RUNS, MAX_FINGERPRINTS_PER_RUN } from '../src/site-history.js';
import { emptySiteMemory, rememberRun } from '../src/site-memory.js';
import { SafePublicCrawler } from '../src/competitive/safe-crawler.js';

const { browser } = vi.hoisted(() => ({
  browser: { newContext: vi.fn(), close: vi.fn(async () => {}) },
}));

vi.mock('playwright', async (importOriginal) => ({
  ...(await importOriginal<typeof import('playwright')>()),
  chromium: { launch: vi.fn(async () => browser) },
}));

const grades: SiteAspectGrades = {
  aspects: {
    Works: { grade: 'B', score: 85, findings: [] },
    Accessible: { grade: 'A', score: 95, findings: [] },
    'Fast and mobile': { grade: 'A', score: 95, findings: [] },
    Findable: { grade: 'A', score: 95, findings: [] },
    Secure: { grade: 'B', score: 85, findings: [] },
    'Looks and reads well': { grade: 'A', score: 100, findings: [] },
  },
  overallGrade: 'B',
  overallScore: 89,
};

function manyFindings(count: number): Finding[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `F-${i}`,
    title: `Issue ${i}`,
    severity: 'Minor',
    checker: 'bug-detection',
    where: { urlPath: `/page-${i}`, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected: '', actual: '' },
    stepsToReproduce: [],
    evidence: {},
    resolution: '',
  })) as Finding[];
}

describe('T-60 resource growth: bounded site history', () => {
  let tempDir: string;
  let history: SiteHistoryManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-test-t60-history-'));
    history = new SiteHistoryManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('keeps at most MAX_HISTORY_RUNS entries after 50 check-ups, dropping the oldest', async () => {
    for (let i = 1; i <= 55; i++) {
      await history.recordRun('bounded.test', `run-${String(i).padStart(3, '0')}`, grades, [], 'p');
    }
    const data = await history.loadHistory('bounded.test');
    expect(data.runs).toHaveLength(MAX_HISTORY_RUNS);
    expect(data.runs[0].runId).toBe('run-006');
    expect(data.runs[data.runs.length - 1].runId).toBe('run-055');
  });

  it('stores at most MAX_FINGERPRINTS_PER_RUN fingerprints, while this run diff uses all of them', async () => {
    const diff = await history.recordRun('caps.test', 'run-001', grades, manyFindings(250), 'p');
    expect(diff.newFindingFingerprints).toHaveLength(250);
    const data = await history.loadHistory('caps.test');
    expect(data.runs[0].findingFingerprints).toHaveLength(MAX_FINGERPRINTS_PER_RUN);
  });
});

describe('T-60 resource growth: stale answers are pruned on save', () => {
  it('keeps only answers to questions the run asks', () => {
    const memory = { ...emptySiteMemory('shop.example.com'), answers: { old: 'x', q1: 'b' } };
    const draft = {
      pages: [],
      flows: [],
      ambiguityQuestions: [{ key: 'q1', options: ['a', 'b'] }],
    } as unknown as DiscoveryDraft;

    const next = rememberRun(memory, 'shop.example.com', draft, {
      reviewed: true,
      answeredByOwner: { q1: 'a' },
    });

    expect(next.answers).toEqual({ q1: 'a' });
  });
});

describe('T-60 resource growth: contexts closed when the crawl throws', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-test-t60-crawler-'));
    browser.close.mockClear();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('closes the browser when a step throws during setup', async () => {
    browser.newContext.mockResolvedValueOnce({
      addInitScript: vi.fn(async () => {}),
      newPage: vi.fn(async () => {
        throw new Error('page could not open');
      }),
    });

    const crawler = new SafePublicCrawler();
    await expect(
      crawler.crawl({
        entryUrl: 'https://example.com/',
        outputDir: tempDir,
        respectRobots: false,
      })
    ).rejects.toThrow('page could not open');
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
