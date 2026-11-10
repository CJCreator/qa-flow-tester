import { describe, it, expect } from 'vitest';
import {
  ROLE_NAME_PATTERN,
  HEADER_NAME_PATTERN,
  MAX_CUSTOM_HEADERS,
  MAX_HEADER_VALUE_LENGTH,
  isSafeHeaderValue,
  parseHeaderText,
} from '../src/input-rules.js';

describe('input-rules contracts', () => {
  describe('ROLE_NAME_PATTERN', () => {
    it('validates role names matching pattern', () => {
      expect(ROLE_NAME_PATTERN.test('admin')).toBe(true);
      expect(ROLE_NAME_PATTERN.test('user_1')).toBe(true);
      expect(ROLE_NAME_PATTERN.test('qa-tester')).toBe(true);
    });

    it('rejects path traversal, spaces, and illegal characters', () => {
      expect(ROLE_NAME_PATTERN.test('../x')).toBe(false);
      expect(ROLE_NAME_PATTERN.test('user name')).toBe(false);
      expect(ROLE_NAME_PATTERN.test('admin/editor')).toBe(false);
      expect(ROLE_NAME_PATTERN.test('')).toBe(false);
      expect(ROLE_NAME_PATTERN.test('a'.repeat(41))).toBe(false);
    });
  });

  describe('HEADER_NAME_PATTERN', () => {
    it('accepts RFC 7230 tokens', () => {
      expect(HEADER_NAME_PATTERN.test('X-QA-Bypass-Token')).toBe(true);
      expect(HEADER_NAME_PATTERN.test('Authorization')).toBe(true);
      expect(HEADER_NAME_PATTERN.test('Content-Type')).toBe(true);
      expect(HEADER_NAME_PATTERN.test('custom_header')).toBe(true);
    });

    it('rejects spaces, colons, or controls', () => {
      expect(HEADER_NAME_PATTERN.test('X Bad')).toBe(false);
      expect(HEADER_NAME_PATTERN.test('X:Bad')).toBe(false);
      expect(HEADER_NAME_PATTERN.test('')).toBe(false);
    });
  });

  describe('isSafeHeaderValue', () => {
    it('accepts normal header values', () => {
      expect(isSafeHeaderValue('Bearer secret-token-123')).toBe(true);
      expect(isSafeHeaderValue('')).toBe(true);
    });

    it('rejects values with CR, LF, NUL, or length over cap', () => {
      expect(isSafeHeaderValue('a\r\nb')).toBe(false);
      expect(isSafeHeaderValue('a\nb')).toBe(false);
      expect(isSafeHeaderValue('a\rb')).toBe(false);
      expect(isSafeHeaderValue('a\0b')).toBe(false);
      expect(isSafeHeaderValue('x'.repeat(MAX_HEADER_VALUE_LENGTH + 1))).toBe(false);
    });
  });

  describe('parseHeaderText', () => {
    it('parses valid headers and keeps last occurrence for duplicates', () => {
      const input = 'X-A: 1\nX-B: two\nX-A: updated';
      const result = parseHeaderText(input);
      expect(result.errors).toEqual([]);
      expect(result.headers).toEqual({
        'X-A': 'updated',
        'X-B': 'two',
      });
    });

    it('rejects malformed lines without leaking secret values', () => {
      const result = parseHeaderText('X-A: 1\nbad line\nX B: 2');
      expect(result.headers).toEqual({ 'X-A': '1' });
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]).toBe('Line 2: header must be in "Name: value" format');
      expect(result.errors[1]).toBe('Line 3: invalid header name "X B"');
      // Assert that errors never contain the value text from invalid lines
      expect(result.errors[1]).not.toContain('2');
    });

    it('rejects unsafe values without echoing them', () => {
      const unsafeVal = 'super_secret_value\0injection';
      const result = parseHeaderText(`X-Secret: ${unsafeVal}`);
      expect(result.headers['X-Secret']).toBeUndefined();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toBe('Line 1: invalid header value');
      expect(result.errors[0]).not.toContain('super_secret_value');
    });

    it('enforces maximum custom headers count', () => {
      const lines: string[] = [];
      for (let i = 0; i <= MAX_CUSTOM_HEADERS; i++) {
        lines.push(`X-Header-${i}: val`);
      }
      const result = parseHeaderText(lines.join('\n'));
      expect(Object.keys(result.headers)).toHaveLength(MAX_CUSTOM_HEADERS);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain(`Line ${MAX_CUSTOM_HEADERS + 1}`);
    });

    it('counts names that every object inherits, and keeps them', () => {
      const result = parseHeaderText('constructor: a\ntoString: b');
      expect(result.errors).toEqual([]);
      expect(Object.keys(result.headers).sort()).toEqual(['constructor', 'toString']);
      expect(result.headers.constructor).toBe('a');
    });

    it('keeps __proto__ as an ordinary header', () => {
      const result = parseHeaderText('__proto__: x');
      expect(Object.keys(result.headers)).toEqual(['__proto__']);
      expect(Object.getPrototypeOf(result.headers)).toBe(Object.prototype);
    });

    it('treats names that differ only in capitals as one header: the last wins', () => {
      const result = parseHeaderText('X-A: 1\nx-a: 2');
      expect(result.headers).toEqual({ 'x-a': '2' });
      expect(result.errors).toEqual([]);
    });

    it('inherited names count toward the maximum', () => {
      const lines = Array.from({ length: MAX_CUSTOM_HEADERS - 1 }, (_, i) => `X-H${i}: v`);
      const result = parseHeaderText([...lines, 'constructor: a', 'X-Over: b'].join('\n'));
      expect(Object.keys(result.headers)).toHaveLength(MAX_CUSTOM_HEADERS);
      expect(result.errors).toHaveLength(1);
    });
  });
});
