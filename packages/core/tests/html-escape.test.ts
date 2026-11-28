import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../src/html-escape.js';

describe('escapeHtml', () => {
  it('escapes all five characters', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#039;Jerry&#039;&lt;/a&gt;'
    );
  });

  it('returns an empty string for nullish or empty input', () => {
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml('')).toBe('');
  });

  it('double-escapes already-escaped input', () => {
    expect(escapeHtml('&amp; &lt;')).toBe('&amp;amp; &amp;lt;');
  });
});
