import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReleaseReport } from '@qa/types';
import { skipReasonText } from '../src/lib/coverage-text';
import { mergeSameRecommendation, Report, reportHeadline } from '../src/screens/ReportScreen';

describe('mergeSameRecommendation', () => {
  it('shows the same advice for the same area once, with every page, in first-seen order', () => {
    const merged = mergeSameRecommendation([
      { title: 'Missing header', aspect: 'Secure', affectedPages: ['/'] },
      { title: 'No way back', aspect: 'Accessible', affectedPages: ['/a'] },
      { title: 'Missing header', aspect: 'Secure', affectedPages: ['/b', '/'] },
      { title: 'Missing header', aspect: 'Works', affectedPages: ['/c'] },
    ]);
    expect(merged.map((r) => [r.title, r.aspect, r.affectedPages])).toEqual([
      ['Missing header', 'Secure', ['/', '/b']],
      ['No way back', 'Accessible', ['/a']],
      ['Missing header', 'Works', ['/c']],
    ]);
  });
});

function makeReport(partial?: Partial<ReleaseReport>): ReleaseReport {
  return {
    runId: 'run-cov-1',
    productId: 'prod-cov-1',
    targetUrl: 'https://example.com',
    timestamp: '2026-01-01T00:00:00.000Z',
    durationMs: 5000,
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
    findings: [],
    ...partial,
  };
}

const mockActions = {
  onTestAgain: () => {},
  onGoDeeper: () => {},
  starting: false,
  actionError: null,
};

describe('T-109: skipReasonText helper', () => {
  it('maps every known skip reason to plain English text', () => {
    expect(skipReasonText('sign-in')).toBe('Needs a sign-in');
    expect(skipReasonText('robots')).toBe('Blocked by robots.txt');
    expect(skipReasonText('did-not-load')).toBe('Did not load');
    expect(skipReasonText('http-error')).toBe('The site answered with an error');
    expect(skipReasonText('timeout')).toBe('Took too long');
    expect(skipReasonText('off-site-redirect')).toBe('Sent to another site');
    expect(skipReasonText('time-limit')).toBe('Stopped to avoid an endless crawl');
    expect(skipReasonText('trap-limit')).toBe('Stopped to avoid an endless crawl');
    expect(skipReasonText('session-lost')).toBe('Signed-out part-way');
    expect(skipReasonText('page-limit')).toBe('Over the page limit');
    expect(skipReasonText('duplicate')).toBe('Same page as another');
  });

  it('falls back gracefully on unknown reasons', () => {
    expect(skipReasonText('unknown-reason')).toBe('Skipped');
  });
});

describe('T-109: Crawl coverage in ReportScreen', () => {
  it('renders "6 of 10" and "/a ... Needs a sign-in" when pageCoverage is present', () => {
    const report = makeReport({
      pageCoverage: {
        found: 10,
        reached: 6,
        skipped: [{ urlPath: '/a', why: 'sign-in' }],
      },
    });

    const html = renderToStaticMarkup(
      createElement(Report, {
        report,
        actions: mockActions,
        onReportChanged: () => {},
      })
    );

    expect(html).toContain('Pages checked');
    expect(html).toContain('Pages reached 6 of 10');
    expect(html).toContain('/a');
    expect(html).toContain('Needs a sign-in');
  });

  it('renders no coverage block and no error when pageCoverage is absent', () => {
    const report = makeReport({
      pageCoverage: undefined,
    });

    const html = renderToStaticMarkup(
      createElement(Report, {
        report,
        actions: mockActions,
        onReportChanged: () => {},
      })
    );

    expect(html).not.toContain('Pages checked');
    expect(html).not.toContain('Pages reached');
  });
});

describe('T-109: rolesNotTested rendering', () => {
  it('renders rolesNotTested under its own heading "Roles not tested, and why", not inside "Living Spec Conformance"', () => {
    const report = makeReport({
      rolesNotTested: [
        { role: 'admin', reason: 'no-form', text: 'No sign-in details given' },
        { role: 'billing', reason: 'wrong-details', text: 'Sign-in failed' },
      ],
    });

    const html = renderToStaticMarkup(
      createElement(Report, {
        report,
        actions: mockActions,
        onReportChanged: () => {},
      })
    );

    expect(html).toContain('Roles not tested, and why');
    expect(html).toContain('admin');
    expect(html).toContain('No sign-in details given');
    expect(html).toContain('billing');
    expect(html).toContain('Sign-in failed');

    // Make sure it is not inside the spec section
    expect(html).not.toContain('How the site matches its requirements');
  });
});

describe('Report redesign: verdict tag, headline, order and grouped problems', () => {
  const finding = (id: string, urlPath: string) =>
    ({
      id,
      title: 'Missing Content-Security-Policy header',
      severity: 'Blocker',
      checker: 'security',
      issueKey: `security|csp|${urlPath}`,
      where: { urlPath, breakpoint: '1440px', role: 'anonymous' },
      expectedVsActual: { expected: 'A CSP header', actual: 'None' },
      evidence: {},
      stepsToReproduce: [],
    }) as unknown as ReleaseReport['findings'][number];

  const render = (report: ReleaseReport) =>
    renderToStaticMarkup(createElement(Report, { report, actions: mockActions, onReportChanged: () => {} }));

  it('shows the same problem on several pages as one row that says on how many pages', () => {
    const html = render(
      makeReport({ findings: [finding('f1', '/'), finding('f2', '/about'), finding('f3', '/pricing')] })
    );
    expect(html.match(/data-problem-key=/g)?.length).toBe(1);
    expect(html).toContain('on 3 pages');
    expect(html).toMatch(/Must fix before release <span[^>]*>\(1\)<\/span>/);
  });

  it('puts the verdict on a tag, a short headline under it, and the long sentence under Details for developers', () => {
    const html = render(makeReport({ findings: [finding('f1', '/'), finding('f2', '/about')] }));
    expect(html).toContain('class="stamp ');
    expect(html).not.toContain('rotate');
    expect(html).toMatch(/<h1[^>]*font-stamp text-verdict[^>]*>Not ready yet<\/h1>/);
    expect(html).toContain('1 problem must be fixed first, all in security.');
    expect(html.indexOf('Verdict, in full')).toBeGreaterThan(html.indexOf('Problems found'));
    const order = ['Not ready yet', 'New check-up of this site', 'Problems found', 'Go further', 'Details for developers'];
    const at = order.map((text) => html.indexOf(text));
    expect(at.every((n) => n >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(html).not.toContain('Check-up #');
    expect(html).not.toContain('Light view');
  });

  it('has exactly one primary button and links to visibility, compare and baselines', () => {
    const html = render(makeReport());
    expect(html.match(/class="btn-primary/g)?.length).toBe(1);
    expect(html).toContain('href="/reports/run-cov-1/visibility"');
    expect(html).toContain(`href="/benchmark?url=${encodeURIComponent('https://example.com')}"`);
    expect(html).toContain('href="/baselines"');
  });
});

describe('reportHeadline', () => {
  it('counts must-fix problems and names the top one or two areas', () => {
    expect(
      reportHeadline({
        ready: false,
        mustFix: [{ aspect: 'Secure' }, { aspect: 'Secure' }, { aspect: 'Fast and mobile' }, { aspect: 'Works' }],
        total: 6,
        lowAreas: [],
      })
    ).toBe('4 problems must be fixed first, mostly in security and in speed and phone layout.');
    expect(reportHeadline({ ready: false, mustFix: [{ aspect: 'Secure' }], total: 1, lowAreas: [] })).toBe(
      '1 problem must be fixed first, all in security.'
    );
  });

  it('says what blocks release when only an area score is too low, and stays calm when ready', () => {
    expect(reportHeadline({ ready: false, mustFix: [], total: 2, lowAreas: ['Accessible'] })).toBe(
      'Some areas scored too low to release: accessibility.'
    );
    expect(reportHeadline({ ready: true, mustFix: [], total: 0, lowAreas: [] })).toBe('No problems found.');
    expect(reportHeadline({ ready: true, mustFix: [], total: 2, lowAreas: [] })).toBe(
      'Nothing blocks release. 2 smaller problems are worth fixing.'
    );
  });
});

describe('Visibility screen: plain layer and accessible tabs', () => {
  it('shows problems in plain words, technical bits under Details for developers, and roving tabs', () => {
    const source = readFileSync(new URL('../src/screens/VisibilityScreen.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('expectedVsActual');
    expect(source).not.toContain('{finding.title}');
    expect(source).toContain('<DeveloperDetails');
    expect(source).toContain('whyItMatters(');
    expect(source).toContain('tabIndex={isSelected ? 0 : -1}');
    expect(source).toContain('aria-controls={isSelected ? `panel-${tab}` : undefined}');
    expect(source).toContain('ArrowRight');
    expect(source).toContain('onRetry=');
    expect(source).not.toMatch(/text-\[1[0-2]px\]|uppercase|tracking-wider|bg-(pass|warn|fail)\/10/);
  });
});
