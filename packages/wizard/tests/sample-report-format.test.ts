import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSingleFileHtmlReport } from '@qa/core';
import type { ReleaseReport } from '@qa/types';

/**
 * The landing page shows /sample-report.html as a real report. This keeps it in step with the report
 * the tool writes today: structure only (the markers and the graded areas), never dates, hosts, counts
 * or finding text, so a new sample with different content still passes.
 */

const SAMPLE = fileURLToPath(new URL('../public/sample-report.html', import.meta.url));
const OUT_OF_DATE =
  'sample-report.html is out of date with the report format: regenerate it (see landing spec section 11)';

const AREAS = ['Works', 'Accessible', 'Fast and mobile', 'Findable', 'Secure', 'Looks and reads well'] as const;

function fixture(withBlocker: boolean): ReleaseReport {
  return {
    runId: 'run-format-check',
    productId: 'format-check',
    targetUrl: 'http://localhost:3050',
    timestamp: '2026-01-02T03:04:05.000Z',
    durationMs: 4200,
    coverage: {
      totalTestPoints: 5,
      passed: withBlocker ? 4 : 5,
      failed: withBlocker ? 1 : 0,
      blocked: 0,
      skipped: 0,
      couldNotVerify: 0,
      completionRate: 100,
    },
    results: [],
    findings: withBlocker
      ? [
          {
            id: 'F-001',
            title: 'Missing Content-Security-Policy header',
            severity: 'Blocker',
            checker: 'security',
            where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
            expectedVsActual: { expected: 'CSP header set', actual: 'No CSP header' },
            stepsToReproduce: ['Visit /'],
            evidence: {},
            resolution: 'Add CSP header',
          },
        ]
      : [],
    grades: {
      aspects: Object.fromEntries(
        AREAS.map((a) => [a, { grade: 'A', score: 100, findings: withBlocker && a === 'Secure' ? ['F-001'] : [] }])
      ) as NonNullable<ReleaseReport['grades']>['aspects'],
      overallGrade: 'A',
      overallScore: 100,
    },
    recommendations: [],
  };
}

const classesOf = (html: string): Set<string> => {
  const body = html.slice(html.indexOf('<body'));
  const found = new Set<string>();
  for (const m of body.matchAll(/class="([^"]*)"/g)) for (const c of m[1]!.split(/\s+/)) if (c) found.add(c);
  return found;
};
const textOf = (html: string, re: RegExp): string | undefined => re.exec(html)?.[1]?.trim();
const titlesOf = (html: string): string[] =>
  [...html.matchAll(/class="aspect-title">([^<]*)</g)].map((m) => m[1]!.trim());
const stampOf = (html: string) => textOf(html, /class="overall-grade">([^<]*)</);
const headingOf = (html: string) => textOf(html, /<h2 class="section-title">(Every finding behind the)/);
const h1Of = (html: string) => textOf(html, /<h1>([^<]*)<\/h1>/);

interface Reference {
  /** Class names emitted whatever the findings are. */
  classes: string[];
  areas: string[];
  stamps: string[];
  h1: string | undefined;
  heading: string | undefined;
}

function referenceFrom(ready: string, notReady: string): Reference {
  const inBoth = [...classesOf(ready)].filter((c) => classesOf(notReady).has(c));
  return {
    classes: inBoth,
    areas: titlesOf(notReady),
    stamps: [stampOf(ready), stampOf(notReady)].filter((s): s is string => !!s),
    h1: h1Of(notReady),
    heading: headingOf(notReady),
  };
}

/** What is wrong with `sample` against the format the generator writes now; [] when nothing. */
function problemsWith(sample: string, ref: Reference): string[] {
  const problems: string[] = [];
  const have = classesOf(sample);
  for (const c of ref.classes) if (!have.has(c)) problems.push(`missing class "${c}"`);
  if (ref.h1 && h1Of(sample) !== ref.h1) problems.push(`heading <h1> is not "${ref.h1}"`);
  if (ref.heading && headingOf(sample) !== ref.heading) problems.push(`section heading "${ref.heading}…" is missing`);
  const titles = titlesOf(sample);
  if (JSON.stringify([...titles].sort()) !== JSON.stringify([...ref.areas].sort())) {
    problems.push(`graded areas differ: sample has [${titles.join(', ')}], generator has [${ref.areas.join(', ')}]`);
  }
  const stamp = stampOf(sample);
  if (!stamp || !ref.stamps.includes(stamp))
    problems.push(`verdict stamp "${stamp}" is not one of [${ref.stamps.join(', ')}]`);
  return problems;
}

describe('sample report format', () => {
  let dir: string;
  let ready = '';
  let notReady = '';
  let ref: Reference;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'qa-sample-format-'));
    ready = await readFile(
      await generateSingleFileHtmlReport(fixture(false), { outputDir: path.join(dir, 'ready') }),
      'utf8'
    );
    notReady = await readFile(
      await generateSingleFileHtmlReport(fixture(true), { outputDir: path.join(dir, 'not-ready') }),
      'utf8'
    );
    ref = referenceFrom(ready, notReady);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('the generator still writes the structure this test relies on', () => {
    for (const c of [
      'header-banner',
      'overall-badge',
      'overall-grade',
      'overall-label',
      'aspects-grid',
      'aspect-card',
    ]) {
      expect(ref.classes).toContain(c);
    }
    expect(ref.areas).toHaveLength(6);
    expect(ref.stamps).toHaveLength(2);
    expect(ref.stamps[0]).not.toBe(ref.stamps[1]);
    expect(ref.h1).toBe('Release check-up');
    expect(ref.heading).toBe('Every finding behind the');
  });

  it('sample report has every structural marker the generator emits', async () => {
    const sample = await readFile(SAMPLE, 'utf8');
    const problems = problemsWith(sample, ref).filter(
      (p) => p.startsWith('missing class') || p.startsWith('heading') || p.startsWith('section heading')
    );
    expect(problems, `${OUT_OF_DATE}\n${problems.join('\n')}`).toEqual([]);
  });

  it('sample report grades the same areas as the generator', async () => {
    const sample = await readFile(SAMPLE, 'utf8');
    expect(titlesOf(sample).sort(), OUT_OF_DATE).toEqual([...ref.areas].sort());
  });

  it('sample report verdict is a verdict the generator can produce', async () => {
    const sample = await readFile(SAMPLE, 'utf8');
    expect(ref.stamps, OUT_OF_DATE).toContain(stampOf(sample));
  });

  it('a sample missing a marker fails', () => {
    expect(problemsWith(ready, ref)).toEqual([]);
    expect(problemsWith(ready.replaceAll('aspects-grid', 'x-grid'), ref)).not.toEqual([]);
    expect(problemsWith(ready.replace('<span class="aspect-title">Works</span>', ''), ref)).not.toEqual([]);
    expect(problemsWith(ready.replace('class="aspect-title">Secure<', 'class="aspect-title">Safe<'), ref)).not.toEqual(
      []
    );
    expect(
      problemsWith(ready.replace(/class="overall-grade">[^<]*</, 'class="overall-grade">Maybe<'), ref)
    ).not.toEqual([]);
  });

  it('changing the date, host and counts in the sample does not change the result', () => {
    const changed = notReady
      .replaceAll('localhost:3050', 'demo.example.org')
      .replaceAll('run-format-check', 'run-another-one')
      .replace(/Checked on: [^|]*/, 'Checked on: 9/9/2030, 9:09:09 AM ')
      .replace(/Problems found: \d+/, 'Problems found: 42')
      .replace(/Score: \d+\/100/g, 'Score: 12/100')
      .replace(/Missing Content-Security-Policy header/g, 'A different finding');
    expect(problemsWith(changed, ref)).toEqual([]);
  });
});
