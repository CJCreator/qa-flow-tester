/**
 * ADR 0043: a busy host's Retry-After is read from the page answer, as seconds or an HTTP date.
 */
import { describe, it, expect } from 'vitest';
import { parseRetryAfter } from '../src/navigate.js';

describe('parseRetryAfter', () => {
  it('reads delay-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter(' 0 ')).toBe(0);
  });

  it('reads an HTTP date as the time left until it', () => {
    const now = Date.parse('Wed, 05 Nov 2026 10:00:00 GMT');
    expect(parseRetryAfter('Wed, 05 Nov 2026 10:00:45 GMT', now)).toBe(45_000);
    expect(parseRetryAfter('Wed, 05 Nov 2026 09:59:00 GMT', now)).toBe(0);
  });

  it('ignores a missing or unreadable value', () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
  });
});
