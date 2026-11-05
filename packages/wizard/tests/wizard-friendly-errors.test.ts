import { describe, expect, it } from 'vitest';
import { plainMessage } from '../src/api';

const FALLBACK = 'Try again in a minute.';

describe('plainMessage (friendly errors, W1)', () => {
  it('shows a short plain sentence from the server', () => {
    expect(plainMessage('Check both addresses.', FALLBACK)).toBe('Check both addresses.');
  });

  it('replaces a stack trace with the fallback', () => {
    const trace = 'TypeError: x is not a function\n    at run (/app/packages/runner/src/benchmark.ts:42:7)';
    expect(plainMessage(trace, FALLBACK)).toBe(FALLBACK);
  });

  it('replaces an error code, a file path or an empty value with the fallback', () => {
    expect(plainMessage('ERR_START_FAILED', FALLBACK)).toBe(FALLBACK);
    expect(plainMessage('failed at C:\\QA Tool\\x.ts', FALLBACK)).toBe(FALLBACK);
    expect(plainMessage('', FALLBACK)).toBe(FALLBACK);
    expect(plainMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('replaces an over-long server dump with the fallback', () => {
    expect(plainMessage('x'.repeat(300), FALLBACK)).toBe(FALLBACK);
  });
});
