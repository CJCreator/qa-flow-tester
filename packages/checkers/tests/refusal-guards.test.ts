import { describe, it, expect } from 'vitest';
import { isRefusalBaseline, isRefusalResult } from '../src/refusal-rule.js';

describe('isRefusalBaseline', () => {
  it('accepts valid baseline objects', () => {
    expect(isRefusalBaseline({ path: '/a', records: 2, errorTexts: ['x'] })).toBe(true);
    expect(isRefusalBaseline({ path: '/', records: 0, errorTexts: [] })).toBe(true);
    expect(isRefusalBaseline({ path: '/test', records: -1, errorTexts: ['a', 'b'] })).toBe(true);
  });

  it('rejects null, primitives, and non-objects', () => {
    expect(isRefusalBaseline(null)).toBe(false);
    expect(isRefusalBaseline(undefined)).toBe(false);
    expect(isRefusalBaseline('foo')).toBe(false);
    expect(isRefusalBaseline(123)).toBe(false);
    expect(isRefusalBaseline(true)).toBe(false);
  });

  it('rejects incomplete or malformed objects', () => {
    expect(isRefusalBaseline({})).toBe(false);
    expect(isRefusalBaseline({ path: 123, records: 0, errorTexts: [] })).toBe(false);
    expect(isRefusalBaseline({ records: 0, errorTexts: [] })).toBe(false);
    expect(isRefusalBaseline({ path: '/a', records: NaN, errorTexts: [] })).toBe(false);
    expect(isRefusalBaseline({ path: '/a', records: Infinity, errorTexts: [] })).toBe(false);
    expect(isRefusalBaseline({ path: '/a', records: -Infinity, errorTexts: [] })).toBe(false);
    expect(isRefusalBaseline({ path: '/a', records: '2', errorTexts: [] })).toBe(false);
    expect(isRefusalBaseline({ path: '/a', records: 2 })).toBe(false);
    expect(isRefusalBaseline({ path: '/a', records: 2, errorTexts: 'not-array' })).toBe(false);
    expect(isRefusalBaseline({ path: '/a', records: 2, errorTexts: [1] })).toBe(false);
    expect(isRefusalBaseline({ path: '/a', records: 2, errorTexts: ['valid', 2] })).toBe(false);
    expect(isRefusalBaseline({ path: '/a', records: 2, errorTexts: [null] })).toBe(false);
  });
});

describe('isRefusalResult', () => {
  it('accepts valid result objects with and without errorText', () => {
    expect(
      isRefusalResult({
        moved: false,
        newRecord: false,
        signals: ['alert', 'invalid'],
        errorText: 'Some error',
        crashed: false,
      })
    ).toBe(true);

    expect(
      isRefusalResult({
        moved: true,
        newRecord: false,
        signals: [],
        crashed: false,
      })
    ).toBe(true);

    expect(
      isRefusalResult({
        moved: false,
        newRecord: true,
        signals: ['aria-invalid', 'error-text'],
        errorText: undefined,
        crashed: true,
      })
    ).toBe(true);
  });

  it('rejects null, primitives, and non-objects', () => {
    expect(isRefusalResult(null)).toBe(false);
    expect(isRefusalResult(undefined)).toBe(false);
    expect(isRefusalResult('string')).toBe(false);
    expect(isRefusalResult(42)).toBe(false);
    expect(isRefusalResult(false)).toBe(false);
  });

  it('rejects incomplete objects and invalid field types', () => {
    expect(isRefusalResult({})).toBe(false);
    expect(isRefusalResult({ moved: 'yes', newRecord: false, signals: [], crashed: false })).toBe(false);
    expect(isRefusalResult({ moved: false, newRecord: 1, signals: [], crashed: false })).toBe(false);
    expect(isRefusalResult({ moved: false, newRecord: false, signals: [], crashed: 'no' })).toBe(false);
    expect(isRefusalResult({ moved: false, newRecord: false, signals: 'alert', crashed: false })).toBe(false);
    expect(
      isRefusalResult({ moved: false, newRecord: false, signals: ['alert'], errorText: 123, crashed: false })
    ).toBe(false);
  });

  it('rejects unknown signal names', () => {
    expect(
      isRefusalResult({
        moved: false,
        newRecord: false,
        signals: ['unknown'],
        crashed: false,
      })
    ).toBe(false);

    expect(
      isRefusalResult({
        moved: false,
        newRecord: false,
        signals: ['alert', 'custom-signal'],
        crashed: false,
      })
    ).toBe(false);

    expect(
      isRefusalResult({
        moved: false,
        newRecord: false,
        signals: ['ALERT'],
        crashed: false,
      })
    ).toBe(false);
  });
});
