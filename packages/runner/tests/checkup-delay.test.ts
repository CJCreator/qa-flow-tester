import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/checkup.js';

describe('checkup pacing delay (QA_DELAY_MS, --delay)', () => {
  const url = 'https://app.test';

  it('is undefined when neither QA_DELAY_MS nor --delay is set', () => {
    expect(parseArgs([url], {}).crawlDelayMs).toBeUndefined();
  });

  it('treats QA_DELAY_MS=0 as no delay, not the 100 ms default', () => {
    expect(parseArgs([url], { QA_DELAY_MS: '0' }).crawlDelayMs).toBe(0);
  });

  it('treats --delay 0 as no delay', () => {
    expect(parseArgs(['--delay', '0', url], {}).crawlDelayMs).toBe(0);
  });

  it('uses the given value when it is numeric', () => {
    expect(parseArgs([url], { QA_DELAY_MS: '250' }).crawlDelayMs).toBe(250);
  });

  it('refuses values above 2000 or below 0 instead of clamping (T-356)', () => {
    expect(() => parseArgs([url], { QA_DELAY_MS: '9999' })).toThrow(
      '--delay must be a whole number from 0 to 2000, not "9999"'
    );
    expect(() => parseArgs([url], { QA_DELAY_MS: '-5' })).toThrow(
      '--delay must be a whole number from 0 to 2000, not "-5"'
    );
  });

  it('refuses a non-numeric value instead of falling back to 100 ms (T-356)', () => {
    expect(() => parseArgs([url], { QA_DELAY_MS: 'soon' })).toThrow(
      '--delay must be a whole number from 0 to 2000, not "soon"'
    );
  });

  it('lets --delay override QA_DELAY_MS, including with 0', () => {
    expect(parseArgs(['--delay', '0', url], { QA_DELAY_MS: '500' }).crawlDelayMs).toBe(0);
  });
});
