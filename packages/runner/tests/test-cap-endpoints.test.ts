/**
 * Test cap and Intent switch-offs: the cap is clamped, `--test-cap` reaches the run body, and `intentsOff` is validated.
 */
import { describe, it, expect } from 'vitest';
import { checkIntentsOff, checkTestCap } from '../src/run-inputs.js';
import { buildRunBody, parseArgs } from '../src/checkup.js';

describe('checkTestCap', () => {
  it('keeps a positive whole number, clamps to 1..100000, else uses the default', () => {
    expect(checkTestCap(50)).toBe(50);
    expect(checkTestCap('300')).toBe(300);
    expect(checkTestCap(12.9)).toBe(12);
    expect(checkTestCap(5_000_000)).toBe(100000);
    for (const v of [0, -3, 0.5, NaN, Infinity, 'abc', '', null, undefined, {}])
      expect(checkTestCap(v)).toBeUndefined();
  });
});

describe('checkIntentsOff', () => {
  it('accepts known Intents once each, refuses the rest', () => {
    expect(checkIntentsOff(['rejects', 'limits', 'rejects'])).toEqual({ ok: true, value: ['rejects', 'limits'] });
    expect(checkIntentsOff([])).toEqual({ ok: true, value: [] });
    expect(checkIntentsOff(['nope']).ok).toBe(false);
    expect(checkIntentsOff('rejects').ok).toBe(false);
  });
});

describe('--test-cap', () => {
  it('reaches the run body, clamped; absent by default', () => {
    expect(buildRunBody(parseArgs(['http://x.test', '--test-cap', '40'], {})).testCap).toBe(40);
    expect(parseArgs(['http://x.test', '--test-cap', '9999999'], {}).testCap).toBe(100000);
    expect(parseArgs(['http://x.test', '--test-cap', 'zero'], {}).testCap).toBeUndefined();
    const args = parseArgs(['--test-cap', '7', 'http://x.test'], {});
    expect(args.url).toBe('http://x.test');
    expect(buildRunBody(parseArgs(['http://x.test'], {}))).not.toHaveProperty('testCap');
  });
});
