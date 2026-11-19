import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Breakpoint, Finding, ReleaseReport } from '@qa/types';
import { countSummary } from '@qa/types/src/browser.js';
import { mergeDuplicateFindings } from '../../core/src/finding-groups.js';
import { initialFeed, reduceFeed, type FeedState } from '../src/lib/translate';
import { summarizeReport } from '../src/lib/summary';
import { TestingScreen } from '../src/screens/TestingScreen';

const SIZES: Breakpoint[] = ['375px', '768px', '1440px'];

function raw(i: number, size: Breakpoint): Finding {
  return {
    id: `f-${i}-${size}`,
    testCaseId: `tc-${i}-${size}`,
    title: `Button ${i} is too small to tap`,
    severity: i % 10 === 0 ? 'Major' : 'Minor',
    checker: 'ux-quality',
    triageStatus: 'Open',
    needsConfirmation: false,
    where: { urlPath: `/page-${i % 5}`, role: 'visitor', breakpoint: size, cssSelector: `#b${i}` },
    expectedVsActual: { expected: '44px', actual: '20px' },
    evidence: {},
  } as unknown as Finding;
}

/** The runner's live events for 40 problems found at 3 sizes each: 120 raw findings, one Test point each. */
function liveEvents(): { events: Array<Record<string, unknown>>; all: Finding[] } {
  const all: Finding[] = [];
  const events: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 40; i++) {
    for (const size of SIZES) {
      const f = raw(i, size);
      all.push(f);
      events.push({
        type: 'FINDINGS_UPDATED',
        totalFindings: all.length,
        summary: countSummary(mergeDuplicateFindings(all)),
        latest: [
          {
            id: f.id,
            title: f.title,
            severity: f.severity,
            checker: f.checker,
            urlPath: f.where.urlPath,
            breakpoint: size,
          },
        ],
      });
    }
  }
  return { events, all };
}

const headlineOf = (feed: FeedState) =>
  renderToStaticMarkup(
    createElement(TestingScreen, { host: 'example.test', feed, onStop: () => {}, onBackToPlan: () => {} })
  );

describe('one count, live and final (T-389)', () => {
  it('120 findings at 3 sizes: the last live headline equals the report headline', () => {
    const { events, all } = liveEvents();
    let feed = initialFeed('product');
    for (const e of events) feed = reduceFeed(feed, e as never, 'product');

    const report = { findings: mergeDuplicateFindings(all) } as unknown as ReleaseReport;
    const summary = summarizeReport(report);
    expect(feed.summary?.raw).toBe(120);
    expect(feed.summary?.problems).toBe(summary.total);
    expect(summary.countSummary.problems).toBe(summary.total);
    expect(summary.total).toBe(40);

    const html = headlineOf(feed);
    expect(html).toContain(`Problems that count: ${summary.total}`);
    expect(html).toContain('120 raw → 40 merged → dismissed after the run, 0 AI notes, 0 to confirm → 40');
  });

  it('the headline never goes down when old items leave the list', () => {
    const { events } = liveEvents();
    let feed = initialFeed('product');
    let last = 0;
    for (const e of events) {
      feed = reduceFeed(feed, e as never, 'product');
      const now = feed.summary!.problems;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    // The list keeps only the newest 50 raw findings; the count still has all 40 problems.
    expect(feed.found.length).toBe(50);
    expect(headlineOf(feed)).toContain('Problems that count: 40');
  });

  it('the event after the access checks updates the count, not the test progress', () => {
    let feed: FeedState = { ...initialFeed('product'), progress: { done: 2, total: 5 } };
    feed = reduceFeed(
      feed,
      {
        type: 'FINDINGS_UPDATED',
        totalFindings: 7,
        afterTests: true,
        summary: { raw: 7, merged: 5, dismissed: 0, advisory: 1, toConfirm: 0, problems: 4, findings: 4 },
      },
      'product'
    );
    expect(feed.progress).toEqual({ done: 2, total: 5 });
    expect(feed.summary?.problems).toBe(4);
  });
});
