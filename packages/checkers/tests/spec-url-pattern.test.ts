import { describe, it, expect } from 'vitest';
import { urlMatchesPattern } from '../src/spec-conformance.js';

describe('Expected page addresses', () => {
  it('matches a plain address as written, query and dots included', () => {
    // An AI expected this exact page; "?" must not be read as "the l is optional".
    expect(urlMatchesPattern('/inventory-item.html?id=4', ['/inventory-item.html', '/inventory-item.html?id=4'])).toBe(
      true
    );
    expect(urlMatchesPattern('/inventory-item.html?id=4', ['/inventory-item.html?id=5'])).toBe(false);
  });

  it('still understands wildcards and regular expressions', () => {
    expect(urlMatchesPattern('/invoices/*', ['/invoices/INV-101'])).toBe(true);
    expect(urlMatchesPattern('/dashboard|/account', ['/account'])).toBe(true);
    expect(urlMatchesPattern('^/invoices/new$', ['/invoices/new'])).toBe(true);
    expect(urlMatchesPattern('/invoices/*', ['/dashboard'])).toBe(false);
  });

  it('does not break on a pattern that is not a valid regular expression', () => {
    expect(urlMatchesPattern('/search(1', ['/search(1'])).toBe(true);
  });

  it('returns false for patterns longer than 300 characters', () => {
    const pattern301 = 'a'.repeat(301);
    expect(pattern301.length).toBe(301);
    expect(urlMatchesPattern(pattern301, [pattern301])).toBe(false);
  });

  it('matches regex characters literally without interpreting them as regex syntax', () => {
    expect(urlMatchesPattern('/a+b', ['/a+b'])).toBe(true);
    expect(urlMatchesPattern('/a+b', ['/aab'])).toBe(false);

    expect(urlMatchesPattern('/users?', ['/users?'])).toBe(true);
    expect(urlMatchesPattern('/users?', ['/user'])).toBe(false);
  });

  it('prevents catastrophic backtracking (ReDoS) and completes in under 1 second', () => {
    const start = Date.now();
    const result = urlMatchesPattern('(a+)+$', ['a'.repeat(5000) + '!']);
    const duration = Date.now() - start;

    expect(result).toBe(false);
    expect(duration).toBeLessThan(1000);
  });
});
