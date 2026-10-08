import { describe, it, expect } from 'vitest';
import type { Finding, PageSpeedMap, PageSpeedSample } from '@qa/types';
import { releaseVerdict } from '@qa/types';
import { calculateSiteAspectGrades } from '../src/scoring.js';
import { findSlowerPages, isSlowerThanLastTime, pageSpeedKey } from '../src/speed-change.js';

const sample = (ms: number, over: Partial<PageSpeedSample> = {}): PageSpeedSample => ({
  metric: 'lcp',
  ms,
  loads: 3,
  throttled: true,
  profile: 'p1',
  ...over,
});
const key = pageSpeedKey('visitor', '375px', '/pricing');
const compare = (prev: number, cur: number) =>
  findSlowerPages({ [key]: sample(prev) }, { [key]: sample(cur) }, { previousRunId: 'run-1' });

describe('slower than last check-up', () => {
  it('slower: not flagged at +299 ms even when over 20%', () => {
    expect(compare(1000, 1299)).toHaveLength(0);
  });

  it('slower: not flagged at +19% when over 300 ms', () => {
    // +950 ms on 5000 is +19%
    expect(compare(5000, 5950)).toHaveLength(0);
  });

  it('slower: not flagged just under 20% (2000 -> 2399)', () => {
    expect(compare(2000, 2399)).toHaveLength(0);
  });

  it('slower: not flagged at +299 ms and +19.9%', () => {
    // 1500 -> 1799 is +299 ms and +19.93%
    expect(compare(1500, 1799)).toHaveLength(0);
  });

  it('slower: flagged at +300 ms and +30% (1000 -> 1300)', () => {
    expect(compare(1000, 1300)).toHaveLength(1);
  });

  it('slower: flagged at exactly +20% and +400 ms (2000 -> 2400)', () => {
    expect(compare(2000, 2400)).toHaveLength(1);
  });

  it('slower: flagged at +301 ms and +21% (1400 -> 1701)', () => {
    expect(compare(1400, 1701)).toHaveLength(1);
  });

  it('slower: flagged at 5000 -> 6000 (+1000, exactly 20%), not at 5999', () => {
    expect(compare(5000, 6000)).toHaveLength(1);
    expect(compare(5000, 5999)).toHaveLength(0);
  });

  it('slower: finding text names previous and current seconds, ms and percent', () => {
    const [s] = findSlowerPages(
      { [key]: sample(2000) },
      { [key]: sample(2600) },
      { previousRunId: 'run-1', previousTimestamp: '2026-10-01T10:00:00.000Z' }
    );
    expect(s).toMatchObject({
      urlPath: '/pricing',
      role: 'visitor',
      breakpoint: '375px',
      aspect: 'Fast and mobile',
      checker: 'performance',
      previousMs: 2000,
      currentMs: 2600,
      increaseMs: 600,
      increasePercent: 30,
      previousRunId: 'run-1',
    });
    expect(s.summary).toContain('2.0 s');
    expect(s.summary).toContain('2.6 s');
    expect(s.summary).toContain('+600 ms');
    expect(s.summary).toContain('+30%');
    expect(s.summary).toContain('2026-10-01');
  });

  it('slower: no flag without previous check-up', () => {
    expect(findSlowerPages(undefined, { [key]: sample(9000) })).toEqual([]);
  });

  it('slower: no flag when old history entry has no speeds', () => {
    expect(findSlowerPages({}, { [key]: sample(9000) })).toEqual([]);
  });

  it('slower: no flag for a page absent before', () => {
    const other = pageSpeedKey('visitor', '375px', '/other');
    expect(findSlowerPages({ [other]: sample(1000) }, { [key]: sample(9000) })).toEqual([]);
  });

  it('slower: previous of 0 or negative never flags', () => {
    expect(compare(0, 5000)).toHaveLength(0);
    expect(compare(-100, 5000)).toHaveLength(0);
    expect(isSlowerThanLastTime(sample(1000), sample(0))).toBe(false);
  });

  it('slower: page absent now is ignored', () => {
    expect(findSlowerPages({ [key]: sample(1000) }, {})).toEqual([]);
  });

  it('slower: not compared when metric differs (lcp vs domReady)', () => {
    expect(isSlowerThanLastTime(sample(1000), sample(5000, { metric: 'domReady' }))).toBe(false);
  });

  it('slower: not compared when throttled differs', () => {
    expect(isSlowerThanLastTime(sample(1000), sample(5000, { throttled: false }))).toBe(false);
  });

  it('slower: not compared when profile differs', () => {
    expect(isSlowerThanLastTime(sample(1000), sample(5000, { profile: 'p2' }))).toBe(false);
  });

  it('slower: loads 3 vs 5 still compared', () => {
    expect(isSlowerThanLastTime(sample(1000, { loads: 3 }), sample(2000, { loads: 5 }))).toBe(true);
  });

  it('slower: same inputs give same list, sorted by increase', () => {
    const a = pageSpeedKey('visitor', '375px', '/a');
    const b = pageSpeedKey('visitor', '375px', '/b');
    const c = pageSpeedKey('visitor', '375px', '/c');
    const prev: PageSpeedMap = { [a]: sample(1000), [b]: sample(1000), [c]: sample(1000) };
    const cur: PageSpeedMap = { [c]: sample(2000), [a]: sample(3000), [b]: sample(2000) };
    const first = findSlowerPages(prev, cur);
    expect(first.map((s) => s.urlPath)).toEqual(['/a', '/b', '/c']);
    expect(findSlowerPages(prev, cur)).toEqual(first);
  });

  it('slower: summary says test browser, median of N loads, phone/network profile, not real visitors', () => {
    const [s] = compare(1000, 2000);
    expect(s.summary).toContain('test browser');
    expect(s.summary).toContain('not by real visitors');
    expect(s.summary).toContain('median of 3 loads');
    expect(s.summary).toContain('simulated mid-range phone on slow 4G');
    expect(s.summary).toContain('check-up');
    expect(s.summary).not.toMatch(/secure|compliant|\bsafe\b|\brun\b|\bscan\b/i);
    const [u] = findSlowerPages(
      { [key]: sample(1000, { throttled: false }) },
      { [key]: sample(2000, { throttled: false }) }
    );
    expect(u.summary).toContain('not slowed down');
  });

  it('slower: grades and verdict identical with and without a slower page', () => {
    const findings: Finding[] = Object.freeze([
      {
        id: 'F-1',
        title: 'Slow Largest Contentful Paint (4.2s)',
        severity: 'Major',
        checker: 'performance',
        where: { urlPath: '/pricing', role: 'visitor', breakpoint: '375px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
      {
        id: 'F-2',
        title: 'Console error on load',
        severity: 'Minor',
        checker: 'bug-detection',
        where: { urlPath: '/', role: 'visitor', breakpoint: '1440px' },
        expectedVsActual: { expected: '', actual: '' },
        stepsToReproduce: [],
        evidence: {},
        resolution: '',
      },
    ]) as unknown as Finding[];
    const gradesBefore = calculateSiteAspectGrades(findings);
    const verdictBefore = releaseVerdict(findings);

    const slower = compare(1000, 5000);
    expect(slower).toHaveLength(1);

    expect(calculateSiteAspectGrades(findings)).toEqual(gradesBefore);
    expect(releaseVerdict(findings)).toEqual(verdictBefore);
    expect(findings).toHaveLength(2);
    expect(gradesBefore.aspects['Fast and mobile'].findings).toContain('F-1');
  });
});
