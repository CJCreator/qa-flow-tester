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

  it('clamps values above 2000 to 2000 and below 0 to 0', () => {
    expect(parseArgs([url], { QA_DELAY_MS: '9999' }).crawlDelayMs).toBe(2000);
    expect(parseArgs([url], { QA_DELAY_MS: '-5' }).crawlDelayMs).toBe(0);
  });

  it('falls back to 100 ms for a non-numeric value', () => {
    expect(parseArgs([url], { QA_DELAY_MS: 'soon' }).crawlDelayMs).toBe(100);
  });

  it('lets --delay override QA_DELAY_MS, including with 0', () => {
    expect(parseArgs(['--delay', '0', url], { QA_DELAY_MS: '500' }).crawlDelayMs).toBe(0);
  });
});
