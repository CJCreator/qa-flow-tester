import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReleaseReport } from '@qa/types';
import { skipReasonText } from '../src/lib/coverage-text';
import { Report } from '../src/screens/ReportScreen';

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
