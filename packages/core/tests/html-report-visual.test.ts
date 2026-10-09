import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { Finding, ReleaseReport } from '@qa/types';
import { generateSingleFileHtmlReport } from '../src/html-report.js';

// 1x1 PNG
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('visual finding report', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-visual-html-'));
    await fs.mkdir(path.join(dir, 'evidence'), { recursive: true });
    for (const n of ['b', 'c', 'd']) await fs.writeFile(path.join(dir, 'evidence', `${n}.png`), PNG_BYTES);
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const visualFinding = (evidence: Finding['evidence'], extra: Partial<Finding> = {}): Finding => ({
    id: 'F-VISUAL-TC-1-1440px',
    title: 'Visual regression against baseline at 1440px',
    severity: 'Minor',
    checker: 'design-standards',
    where: { urlPath: '/', role: 'guest', breakpoint: '1440px' },
    expectedVsActual: { expected: 'Matches approved baseline', actual: '5% of pixels differ' },
    stepsToReproduce: [],
    evidence,
    resolution: 'Approve or fix',
    ...extra,
  });
  const reportWith = (findings: Finding[]): ReleaseReport =>
    ({
      runId: 'r1',
      productId: 'p',
      targetUrl: 'http://localhost:1',
      timestamp: new Date().toISOString(),
      durationMs: 1,
      coverage: {
        totalTestPoints: 1,
        passed: 1,
        failed: 0,
        blocked: 0,
        skipped: 0,
        couldNotVerify: 0,
        completionRate: 100,
      },
      results: [],
      findings,
    }) as unknown as ReleaseReport;
  const render = async (findings: Finding[], maxSizeBytes?: number) =>
    fs.readFile(await generateSingleFileHtmlReport(reportWith(findings), { outputDir: dir, maxSizeBytes }), 'utf8');
  const all = {
    baselineScreenshotPath: 'evidence/b.png',
    currentScreenshotPath: 'evidence/c.png',
    screenshotPath: 'evidence/d.png',
  };

  it('visual finding: report shows old, new and difference, in order, embedded, no src="http / file:', async () => {
    const html = await render([visualFinding(all)]);
    expect(html).toContain('Perceptual Visual Diff: old, new and difference');
    const old = html.indexOf('Old (approved baseline)');
    const now = html.indexOf('New (this check-up)');
    const diff = html.indexOf('>Difference<');
    expect(old).toBeGreaterThan(-1);
    expect(now).toBeGreaterThan(old);
    expect(diff).toBeGreaterThan(now);
    expect(html.match(/<figure>/g)).toHaveLength(3);
    expect(html.match(/src="data:image\/png;base64,/g)).toHaveLength(3);
    expect(html).not.toContain('src="http');
    expect(html).not.toContain('src="file:');
  });

  it('visual finding: report without one has no Perceptual Visual Diff, no <figure, no visual-compare', async () => {
    const html = await render([visualFinding({}, { checker: 'security' })]);
    expect(html).not.toContain('Perceptual Visual Diff');
    expect(html).not.toContain('<figure');
    expect(html).not.toContain('visual-compare');
  });

  it('visual finding: size mismatch shows old and new and says there is no difference image', async () => {
    const html = await render([
      visualFinding({
        baselineScreenshotPath: all.baselineScreenshotPath,
        currentScreenshotPath: all.currentScreenshotPath,
      }),
    ]);
    expect(html.match(/<figure>/g)).toHaveLength(2);
    expect(html).toContain('There is no difference image');
  });

  it('visual finding: paths outside the report folder, non-PNG and missing files are not embedded', async () => {
    await fs.writeFile(path.join(dir, 'evidence', 'x.txt'), 'secret');
    const outside = path.join(os.tmpdir(), 'qa-outside.png');
    await fs.writeFile(outside, PNG_BYTES);
    try {
      const html = await render([
        visualFinding({
          baselineScreenshotPath: '../qa-outside.png',
          currentScreenshotPath: outside,
          screenshotPath: 'evidence/x.txt',
        }),
      ]);
      expect(html).not.toContain('data:image/png');
      expect(html).not.toContain('<img');
      expect(html.match(/Image not available/g)).toHaveLength(3);
      const missing = await render([visualFinding({ ...all, screenshotPath: 'evidence/missing.png' })]);
      expect(missing.match(/Image not available/g)).toHaveLength(1);
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it('visual finding: over the size budget falls back to relative links', async () => {
    const html = await render([visualFinding(all)], PNG_BYTES.length + 1);
    expect(html.match(/src="data:image\/png;base64,/g)).toHaveLength(1);
    expect(html).toContain('src="evidence/c.png"');
    expect(html).toContain('src="evidence/d.png"');
  });

  it('visual finding: a finding with only a difference image renders as before', async () => {
    const html = await render([visualFinding({ screenshotPath: 'evidence/d.png' })]);
    expect(html).not.toContain('<figure');
    expect(html).not.toContain('Perceptual Visual Diff: old');
  });

  it('visual finding: path and caption text is HTML-escaped', async () => {
    // ' and & are valid in Windows file names (" is not); they still must not reach the HTML raw.
    await fs.writeFile(path.join(dir, 'evidence', "a'b&c.png"), PNG_BYTES);
    const html = await render(
      [visualFinding({ baselineScreenshotPath: "evidence/a'b&c.png" }, { title: '<script>alert(1)</script>' })],
      1
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('src="evidence/a&#039;b%26c.png"');
    expect(html).not.toContain("a'b&c.png");
  });
});
