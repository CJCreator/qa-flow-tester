import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Finding, ReleaseReport } from '@qa/types';
import { countSummary, problemsThatCountLine, releaseVerdict } from '@qa/types';
import { ReportGenerator } from '../src/reporter.js';
import { generateSingleFileHtmlReport } from '../src/html-report.js';
import { summaryMarkdown } from '../../runner/src/checkup.js';

const finding = (id: string, title: string, extra: Partial<Finding> = {}): Finding => ({
  id,
  title,
  severity: 'Major',
  checker: 'bug-detection',
  where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
  expectedVsActual: { expected: 'works', actual: 'broken' },
  stepsToReproduce: ['Open /'],
  evidence: {},
  resolution: 'Fix it',
  ...extra,
});

const REPORT: ReleaseReport = {
  runId: 'run-export-counts',
  productId: 'export-counts',
  targetUrl: 'http://localhost:3050',
  timestamp: '2026-11-19T10:00:00.000Z',
  durationMs: 1000,
  coverage: { totalTestPoints: 4, passed: 2, failed: 2, blocked: 0, skipped: 0, couldNotVerify: 0, completionRate: 50 },
  results: [],
  findings: [
    finding('F-1', 'Step failed: "Sign in"', { severity: 'Blocker', issueKey: 'k1', occurrences: 3 }),
    finding('F-2', 'Step failed: "Sign in"', {
      issueKey: 'k1',
      where: { urlPath: '/a', role: 'visitor', breakpoint: '375px' },
    }),
    finding('F-3', 'Dead End Page', { severity: 'Minor', issueKey: 'k2' }),
    finding('F-4', 'Console Error', { issueKey: 'k3', triageStatus: 'Intended' }),
    finding('F-5', 'Spacing looks off', { checker: 'design-standards', advisory: true, issueKey: 'k4' }),
    finding('F-6', 'Expected a cart total', { needsConfirmation: true, issueKey: 'k5' }),
  ],
} as unknown as ReleaseReport;

describe('every export prints the same count (T-391)', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    dir = undefined;
  });

  it('report.md, report.html, issues.md, issues.html, findings.json and the CI summary agree', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'export-counts-'));
    const summary = countSummary(REPORT.findings);
    const line = problemsThatCountLine(summary);
    expect(summary.problems).toBe(releaseVerdict(REPORT.findings).total);
    expect(summary.problems).toBe(2);
    expect(line).toBe('Problems that count: 2 (8 raw → 6 merged → 1 dismissed, 1 AI note, 1 to confirm → 2)');

    const out = await new ReportGenerator(dir).generate(REPORT);
    const htmlPath = await generateSingleFileHtmlReport(REPORT, { outputDir: dir });
    const read = (p: string) => fs.readFile(p, 'utf8');
    const decode = (s: string) => s.replace(/&gt;/g, '>').replace(/&#x2192;|&rarr;/g, '→');

    expect(await read(out.mdPath)).toContain(line);
    expect(await read(out.issuesMdPath)).toContain(line);
    expect(decode(await read(out.issuesHtmlPath))).toContain(line);
    expect(decode(await read(htmlPath))).toContain(line);
    expect(summaryMarkdown(REPORT, { url: REPORT.targetUrl, failOn: 'blocker' } as never)).toContain(line);
    const json = JSON.parse(await read(out.jsonPath));
    expect(json.summary).toEqual(summary);
    expect(json.findings).toHaveLength(REPORT.findings.length);
  });
});
