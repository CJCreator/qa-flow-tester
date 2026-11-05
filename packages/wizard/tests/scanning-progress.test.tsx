import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { headersNotice, stalledForSeconds, statusText } from '../src/lib/coverage-text';
import { isScanProgress, ScanningScreen, type ScanProgress } from '../src/screens/ScanningScreen';

describe('T-109: headersNotice helper', () => {
  it('returns notice text with header names only, never values', () => {
    const notice = headersNotice(['X-Custom-Token', 'Authorization']);
    expect(notice).toBe('Add your headers again to continue: X-Custom-Token, Authorization');
    expect(notice).not.toContain('Bearer');
    expect(notice).not.toContain('secret');
  });

  it('returns empty string for empty array', () => {
    expect(headersNotice([])).toBe('');
  });
});

describe('T-109: stalledForSeconds pure helper', () => {
  it('returns >= 20 seconds when there is no growth for 20 s', () => {
    const t0 = 100_000;
    const history = [
      { at: t0, pagesFound: 5 },
      { at: t0 + 10_000, pagesFound: 5 },
      { at: t0 + 20_000, pagesFound: 5 },
    ];

    expect(stalledForSeconds(history, t0 + 20_000)).toBe(20);
    expect(stalledForSeconds(history, t0 + 25_000)).toBe(25);
    expect(stalledForSeconds(history, t0 + 25_000)).toBeGreaterThanOrEqual(20);
  });

  it('growth resets stalled seconds to 0', () => {
    const t0 = 100_000;
    const history = [
      { at: t0, pagesFound: 5 },
      { at: t0 + 20_000, pagesFound: 5 },
      { at: t0 + 25_000, pagesFound: 6 },
    ];

    expect(stalledForSeconds(history, t0 + 25_000)).toBe(0);
    expect(stalledForSeconds(history, t0 + 26_000)).toBe(1);
  });

  it('returns 0 for empty history', () => {
    expect(stalledForSeconds([], Date.now())).toBe(0);
  });
});

describe('T-109: statusText pure helper', () => {
  it('announces stage changes and ignores path changes to prevent live-region jitter', () => {
    const progressA: ScanProgress = { stage: 'crawling', urlPath: '/account', pagesFound: 2 };
    const progressB: ScanProgress = { stage: 'crawling', urlPath: '/pricing', pagesFound: 3 };

    expect(statusText(progressA)).toBe('Exploring the site…');
    expect(statusText(progressB)).toBe('Exploring the site…');
    expect(statusText(progressA)).toBe(statusText(progressB));

    expect(statusText({ stage: 'narrow-screens' })).toBe('Looking at phone and tablet menus…');
    expect(statusText({ stage: 'planning' })).toBe('Writing the plan…');
    expect(statusText({ stage: 'planning', asking: true, what: 'Reviewing checkout flow' })).toBe(
      'Reviewing checkout flow'
    );
    expect(statusText(null)).toBe('Opening the site…');
  });
});

describe('T-109: isScanProgress type guard', () => {
  it('identifies valid ScanProgress objects without casting', () => {
    expect(isScanProgress({ stage: 'crawling' })).toBe(true);
    expect(isScanProgress({ stage: 'narrow-screens' })).toBe(true);
    expect(isScanProgress({ stage: 'planning' })).toBe(true);
  });

  it('rejects invalid or non-object payloads', () => {
    expect(isScanProgress(null)).toBe(false);
    expect(isScanProgress(undefined)).toBe(false);
    expect(isScanProgress('stage')).toBe(false);
    expect(isScanProgress(123)).toBe(false);
    expect(isScanProgress({ stage: 'unknown' })).toBe(false);
    expect(isScanProgress({})).toBe(false);
  });
});

describe('T-109: ScanningScreen crawl health and accessible regions', () => {
  it('renders precomputed stall warning markup when stalledSeconds is provided', () => {
    const progress: ScanProgress = {
      stage: 'crawling',
      urlPath: '/dashboard',
      pagesFound: 12,
    };

    const html = renderToStaticMarkup(
      createElement(ScanningScreen, {
        host: 'example.com',
        progress,
        hasMaterials: false,
        onStop: () => {},
        stalledSeconds: 20,
      })
    );

    expect(html).toContain('No new pages for 20 seconds');
  });

  it('renders signedInAs, signInFailedFor, and skipped count', () => {
    const progress: ScanProgress = {
      stage: 'crawling',
      urlPath: '/admin',
      pagesFound: 8,
      signedInAs: 'admin',
      signInFailedFor: ['editor'],
      skipped: 3,
    };

    const html = renderToStaticMarkup(
      createElement(ScanningScreen, {
        host: 'example.com',
        progress,
        hasMaterials: false,
        onStop: () => {},
      })
    );

    expect(html).toContain('Signed in as <strong class="text-ink">admin</strong>');
    expect(html).toContain('Sign-in failed for editor');
    expect(html).toContain('3 skipped');
    expect(html).toContain('3');
  });

  it('announces stage via polite aria-live region and makes current path non-live', () => {
    const progress: ScanProgress = {
      stage: 'crawling',
      urlPath: '/contact',
      pagesFound: 4,
    };

    const html = renderToStaticMarkup(
      createElement(ScanningScreen, {
        host: 'example.com',
        progress,
        hasMaterials: false,
        onStop: () => {},
      })
    );

    // Polite live region contains stage announcement only
    expect(html).toMatch(
      /<div[^>]*role="status"[^>]*aria-live="polite"[^>]*class="sr-only"[^>]*>Exploring the site…<\/div>/
    );

    // The visible path container is NOT aria-live / role="status"
    expect(html).toContain('Exploring the site: just looked at /contact');
    expect(html).not.toMatch(/<p[^>]*role="status"[^>]*>[^<]*just looked at/);
  });
});
