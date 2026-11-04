/**
 * BE-202 (REQ-002, Q-11). The Website Audit include/exclude path filter: whole-segment prefixes,
 * decoded and case-preserved, exclude wins, include narrows, the start page always allowed.
 */
import { describe, it, expect } from 'vitest';
import { pathLimitVerdict } from '../src/audit/crawl/limits.js';

const limits = (includePaths: string[] = [], excludePaths: string[] = []) => ({ includePaths, excludePaths });

describe('pathLimitVerdict', () => {
  it('allows every path when no include and no exclude paths are set', () => {
    for (const path of ['/', '/about', '/blog/2025/x', '/caf%C3%A9', '/%E0%A4%A']) {
      expect(pathLimitVerdict(path, limits(), '/')).toBeUndefined();
    }
  });

  it('excludes a prefix on whole segments only (REQ-002 AC-3)', () => {
    const l = limits([], ['/blog']);
    expect(pathLimitVerdict('/blog', l, '/')).toBe('excluded');
    expect(pathLimitVerdict('/blog/', l, '/')).toBe('excluded');
    expect(pathLimitVerdict('/blog/2025/x', l, '/')).toBe('excluded');
    expect(pathLimitVerdict('/blogger', l, '/')).toBeUndefined();
    expect(pathLimitVerdict('/about', l, '/')).toBeUndefined();
  });

  it('treats a trailing slash on the prefix like none', () => {
    expect(pathLimitVerdict('/blog', limits([], ['/blog/']), '/')).toBe('excluded');
    expect(pathLimitVerdict('/blogger', limits([], ['/blog/']), '/')).toBeUndefined();
  });

  it('keeps case: /Blog is not /blog', () => {
    expect(pathLimitVerdict('/Blog/x', limits([], ['/blog']), '/')).toBeUndefined();
  });

  it('excludes a path matching no include path (REQ-002 AC-4)', () => {
    const l = limits(['/services']);
    expect(pathLimitVerdict('/services', l, '/')).toBeUndefined();
    expect(pathLimitVerdict('/services/catering', l, '/')).toBeUndefined();
    expect(pathLimitVerdict('/about', l, '/')).toBe('excluded');
    expect(pathLimitVerdict('/servicesx', l, '/')).toBe('excluded');
  });

  it('always allows the start page, whatever the include and exclude paths say (Q-11)', () => {
    expect(pathLimitVerdict('/', limits(['/services']), '/')).toBeUndefined();
    expect(pathLimitVerdict('/blog', limits([], ['/blog']), '/blog')).toBeUndefined();
    expect(pathLimitVerdict('/blog/', limits(['/services'], ['/']), '/blog')).toBeUndefined();
    expect(pathLimitVerdict('/caf%C3%A9', limits([], ['/café']), '/café')).toBeUndefined();
    // Other pages under the excluded start page are still excluded.
    expect(pathLimitVerdict('/blog/x', limits([], ['/blog']), '/blog')).toBe('excluded');
  });

  it('lets an exclude match win over an include match', () => {
    const l = limits(['/services'], ['/services/private']);
    expect(pathLimitVerdict('/services/private', l, '/')).toBe('excluded');
    expect(pathLimitVerdict('/services/private/x', l, '/')).toBe('excluded');
    expect(pathLimitVerdict('/services/public', l, '/')).toBeUndefined();
    expect(pathLimitVerdict('/blog', limits(['/blog'], ['/blog']), '/')).toBe('excluded');
  });

  it('compares percent-encoded paths after decoding', () => {
    expect(pathLimitVerdict('/caf%C3%A9', limits([], ['/café']), '/')).toBe('excluded');
    expect(pathLimitVerdict('/caf%C3%A9/menu', limits([], ['/café']), '/')).toBe('excluded');
    expect(pathLimitVerdict('/café', limits([], ['/caf%C3%A9']), '/')).toBe('excluded');
    expect(pathLimitVerdict('/caf%C3%A9', limits(['/café']), '/')).toBeUndefined();
    expect(pathLimitVerdict('/cafe', limits([], ['/café']), '/')).toBeUndefined();
  });

  it('keeps an encoded slash inside its segment', () => {
    expect(pathLimitVerdict('/blog%2Fx', limits([], ['/blog']), '/')).toBeUndefined();
  });

  it('compares a path that cannot be decoded as written, never throws', () => {
    expect(() => pathLimitVerdict('/%E0%A4%A', limits([], ['/blog']), '/')).not.toThrow();
    expect(pathLimitVerdict('/%E0%A4%A', limits([], ['/blog']), '/')).toBeUndefined();
    expect(pathLimitVerdict('/bad%ZZ/x', limits([], ['/bad%ZZ']), '/')).toBe('excluded');
    expect(pathLimitVerdict('/100%/x', limits(['/blog']), '/')).toBe('excluded');
    expect(pathLimitVerdict('/%E0%A4%A', limits(['/blog']), '/%E0%A4%A')).toBeUndefined();
  });

  it('treats the prefix / as covering every path', () => {
    expect(pathLimitVerdict('/anything/here', limits([], ['/']), '/start')).toBe('excluded');
    expect(pathLimitVerdict('/anything/here', limits(['/']), '/start')).toBeUndefined();
  });
});
