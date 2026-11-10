import { describe, expect, it } from 'vitest';
import type { RouteSkipReason, SkippedPageInfo } from '@qa/types';
import {
  createSkippedPageFinding,
  createSkippedPageFindings,
  formatWaitTime,
  isSiteCausedSkip,
  isSiteCausedSkippedPage,
  SITE_CAUSED_SKIP_REASONS,
} from '../src/audit/pipeline/skipped-findings.js';
import { hasClaimWords } from '../src/audit/ai/claim-words.js';

describe('skipped-findings (T-84, ADR 0018)', () => {
  describe('isSiteCausedSkip', () => {
    it('returns true for site-caused skip reasons: http-error, timeout, did-not-load', () => {
      expect(isSiteCausedSkip('http-error')).toBe(true);
      expect(isSiteCausedSkip('timeout')).toBe(true);
      expect(isSiteCausedSkip('did-not-load')).toBe(true);
    });

    it('returns false for tool-caused skip reasons', () => {
      const toolCaused: RouteSkipReason[] = [
        'page-limit',
        'depth-limit',
        'excluded',
        'robots',
        'sign-in',
        'payment',
        'time-limit',
        'trap-limit',
        'session-lost',
        'duplicate',
        'off-site-redirect',
      ];
      for (const reason of toolCaused) {
        expect(isSiteCausedSkip(reason)).toBe(false);
      }
    });
  });

  describe('isSiteCausedSkippedPage', () => {
    it.each([
      [{ why: 'http-error' as const }, true],
      [{ why: 'timeout' as const, detail: '30000ms' }, true],
      [{ why: 'did-not-load' as const, detail: 'net' }, true],
      [{ why: 'did-not-load' as const, detail: 'aborted' }, false],
      [{ why: 'did-not-load' as const, detail: 'other' }, false],
      [{ why: 'did-not-load' as const, detail: 'Error' }, false],
      [{ why: 'did-not-load' as const }, false],
      [{ why: 'robots' as const }, false],
    ])('evaluates %o as %s', (skip, expected) => {
      expect(isSiteCausedSkippedPage(skip)).toBe(expected);
    });
  });

  describe('formatWaitTime', () => {
    it('formats millisecond wait time to seconds', () => {
      expect(formatWaitTime('30000ms')).toBe('30s');
      expect(formatWaitTime('15000ms')).toBe('15s');
      expect(formatWaitTime('500ms')).toBe('1s');
    });

    it('keeps seconds string if provided', () => {
      expect(formatWaitTime('30s')).toBe('30s');
      expect(formatWaitTime('10s')).toBe('10s');
    });

    it('defaults to 30s when detail is absent or unparseable', () => {
      expect(formatWaitTime(undefined)).toBe('30s');
      expect(formatWaitTime('')).toBe('30s');
      expect(formatWaitTime('unknown')).toBe('30s');
    });
  });

  describe('createSkippedPageFinding', () => {
    it('creates an ADR 0018 finding for http-error with status code', () => {
      const skip: SkippedPageInfo = {
        urlPath: '/server-error',
        why: 'http-error',
        status: 500,
      };
      const finding = createSkippedPageFinding(skip, 'AF-010');

      expect(finding.id).toBe('AF-010');
      expect(finding.rule).toBe('http-error');
      expect(finding.urlPath).toBe('/server-error');
      expect(finding.title).toBe('Page failed to load: HTTP 500');
      expect(finding.detail).toContain('500');
      expect(finding.sectionId).toBeNull();
      expect(finding.source).toBe('checker');
      expect(finding.impact).toBe('high');
      expect(finding.effort).toBe('medium');
      expect(hasClaimWords(finding.title)).toBe(false);
      expect(hasClaimWords(finding.detail)).toBe(false);
      expect(hasClaimWords(finding.suggestion)).toBe(false);
    });

    it('creates an ADR 0018 finding for timeout with wait time', () => {
      const skip: SkippedPageInfo = {
        urlPath: '/slow-page',
        why: 'timeout',
        detail: '30000ms',
      };
      const finding = createSkippedPageFinding(skip, 'AF-011');

      expect(finding.id).toBe('AF-011');
      expect(finding.rule).toBe('timeout');
      expect(finding.urlPath).toBe('/slow-page');
      expect(finding.title).toBe('Page timed out after 30s');
      expect(finding.detail).toContain('30s');
      expect(hasClaimWords(finding.title)).toBe(false);
    });

    it('creates an ADR 0018 finding for did-not-load', () => {
      const skip: SkippedPageInfo = {
        urlPath: '/broken-conn',
        why: 'did-not-load',
      };
      const finding = createSkippedPageFinding(skip, 'AF-012');

      expect(finding.id).toBe('AF-012');
      expect(finding.rule).toBe('did-not-load');
      expect(finding.title).toBe('Page failed to load');
      expect(hasClaimWords(finding.title)).toBe(false);
    });
  });

  describe('createSkippedPageFindings', () => {
    it('turns site-caused skips into findings and leaves tool-caused skips out', () => {
      const skips: SkippedPageInfo[] = [
        { urlPath: '/err-500', why: 'http-error', status: 500 },
        { urlPath: '/timeout-page', why: 'timeout', detail: '30000ms' },
        { urlPath: '/page-101', why: 'page-limit' },
        { urlPath: '/deep-page', why: 'depth-limit' },
        { urlPath: '/excluded-path', why: 'excluded' },
        { urlPath: '/secret-admin', why: 'sign-in' },
        { urlPath: '/cart/pay', why: 'payment' },
        { urlPath: '/blocked-by-robots', why: 'robots' },
        { urlPath: '/net-down', why: 'did-not-load', detail: 'net' },
      ];

      let id = 1;
      const ids = { next: () => `AF-${String(id++).padStart(3, '0')}` };
      const findings = createSkippedPageFindings(skips, ids);

      expect(findings).toHaveLength(3);
      expect(findings.map((f) => f.urlPath)).toEqual(['/err-500', '/timeout-page', '/net-down']);
      expect(findings.map((f) => f.title)).toEqual([
        'Page failed to load: HTTP 500',
        'Page timed out after 30s',
        'Page failed to load',
      ]);
    });

    it('filters out tool-caused did-not-load skips without net detail', () => {
      const skips: SkippedPageInfo[] = [
        { urlPath: '/a', why: 'did-not-load', detail: 'net' },
        { urlPath: '/b', why: 'did-not-load', detail: 'aborted' },
        { urlPath: '/c', why: 'did-not-load' },
      ];
      let id = 1;
      const ids = { next: () => `AF-${String(id++).padStart(3, '0')}` };
      const findings = createSkippedPageFindings(skips, ids);
      expect(findings).toHaveLength(1);
      expect(findings[0].urlPath).toBe('/a');
    });
  });
});
