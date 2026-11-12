import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseArgs } from '../src/checkup.js';

describe('checkup --debug option and QA_DEBUG', () => {
  const origDebug = process.env.QA_DEBUG;

  afterEach(() => {
    if (origDebug !== undefined) {
      process.env.QA_DEBUG = origDebug;
    } else {
      delete process.env.QA_DEBUG;
    }
  });

  it('sets QA_DEBUG to "all" when --debug is passed without an area', () => {
    delete process.env.QA_DEBUG;
    const args = parseArgs(['--debug', 'https://app.test']);
    expect(process.env.QA_DEBUG).toBe('all');
    expect(args.debug).toBe('all');
    expect(args.url).toBe('https://app.test');
  });

  it('sets QA_DEBUG to specific areas when provided after --debug', () => {
    delete process.env.QA_DEBUG;
    const args = parseArgs(['--debug', 'crawl,auth', 'https://app.test']);
    expect(process.env.QA_DEBUG).toBe('crawl,auth');
    expect(args.debug).toBe('crawl,auth');
    expect(args.url).toBe('https://app.test');
  });

  it('reads QA_DEBUG from environment when not passed in argv', () => {
    const args = parseArgs(['https://app.test'], { QA_DEBUG: 'nav' });
    expect(process.env.QA_DEBUG).toBe('nav');
    expect(args.debug).toBe('nav');
  });
});

describe('checkup strict custom headers validation', () => {
  it('throws on invalid JSON in QA_CUSTOM_HEADERS without leaking content', () => {
    const malformed = '{bad-json-value-secret';
    expect(() => parseArgs(['https://app.test'], { QA_CUSTOM_HEADERS: malformed })).toThrowError(
      'QA_CUSTOM_HEADERS is not valid'
    );
    try {
      parseArgs(['https://app.test'], { QA_CUSTOM_HEADERS: malformed });
    } catch (err: any) {
      expect(err.message).toBe('QA_CUSTOM_HEADERS is not valid');
      expect(err.message).not.toContain(malformed);
    }
  });

  it('throws on non-object QA_CUSTOM_HEADERS', () => {
    expect(() => parseArgs(['https://app.test'], { QA_CUSTOM_HEADERS: '"string"' })).toThrowError(
      'QA_CUSTOM_HEADERS is not valid'
    );
    expect(() => parseArgs(['https://app.test'], { QA_CUSTOM_HEADERS: '[1, 2]' })).toThrowError(
      'QA_CUSTOM_HEADERS is not valid'
    );
  });

  it('throws on invalid --header line without leaking content', () => {
    // T-356: a bad --header names the flag, not the environment variable.
    const headerMsg = '--header must look like "Name: value"';
    expect(() => parseArgs(['--header', 'NoColonLine', 'https://app.test'])).toThrowError(headerMsg);

    const secretVal = 'secret\r\nBearer 123';
    expect(() => parseArgs(['--header', `Auth: ${secretVal}`, 'https://app.test'])).toThrowError(headerMsg);
    try {
      parseArgs(['--header', `Auth: ${secretVal}`, 'https://app.test']);
    } catch (err: any) {
      expect(err.message).toBe(headerMsg);
      expect(err.message).not.toContain('Bearer');
    }
  });

  it('parses valid custom headers from env and --header', () => {
    const args = parseArgs(['--header', 'X-Cli: yes', 'https://app.test'], {
      QA_CUSTOM_HEADERS: JSON.stringify({ 'X-Env': 'production' }),
    });
    expect(args.customHeaders).toEqual({
      'X-Env': 'production',
      'X-Cli': 'yes',
    });
  });
});
