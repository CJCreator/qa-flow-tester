import { describe, it, expect } from 'vitest';
import { parseArgs, runCheckup, USAGE_TEXT } from '../src/checkup.js';

describe('checkup CLI argument parsing (strict flags and range validation)', () => {
  it('throws on unknown options with run with --help message', () => {
    expect(() => parseArgs(['--unknown'])).toThrow('Unknown option "--unknown". Run with --help.');
    expect(() => parseArgs(['--foo', 'bar'])).toThrow('Unknown option "--foo". Run with --help.');
    expect(() => parseArgs(['--roles', '[]'])).toThrow('Unknown option "--roles". Run with --help.');
  });

  describe('range validation', () => {
    it('--max-pages requires a whole number from 1 to 1000', () => {
      expect(() => parseArgs(['--max-pages', 'abc'])).toThrow(
        '--max-pages must be a whole number from 1 to 1000, not "abc"'
      );
      expect(() => parseArgs(['--max-pages', '0'])).toThrow(
        '--max-pages must be a whole number from 1 to 1000, not "0"'
      );
      expect(() => parseArgs(['--max-pages', '1001'])).toThrow(
        '--max-pages must be a whole number from 1 to 1000, not "1001"'
      );
      expect(() => parseArgs(['--max-pages', '1.5'])).toThrow(
        '--max-pages must be a whole number from 1 to 1000, not "1.5"'
      );
      expect(() => parseArgs([], { QA_MAX_PAGES: 'abc' } as NodeJS.ProcessEnv)).toThrow(
        '--max-pages must be a whole number from 1 to 1000, not "abc"'
      );
      expect(parseArgs(['--max-pages', '500']).maxPages).toBe(500);
    });

    it('--concurrency requires a whole number from 1 to 5', () => {
      expect(() => parseArgs(['--concurrency', '0'])).toThrow(
        '--concurrency must be a whole number from 1 to 5, not "0"'
      );
      expect(() => parseArgs(['--concurrency', '9'])).toThrow(
        '--concurrency must be a whole number from 1 to 5, not "9"'
      );
      expect(() => parseArgs(['--concurrency', '-1'])).toThrow(
        '--concurrency must be a whole number from 1 to 5, not "-1"'
      );
      expect(() => parseArgs([], { QA_CONCURRENCY: '0' } as NodeJS.ProcessEnv)).toThrow(
        '--concurrency must be a whole number from 1 to 5, not "0"'
      );
      expect(parseArgs(['--concurrency', '3']).crawlConcurrency).toBe(3);
    });

    it('--delay requires a whole number from 0 to 2000', () => {
      expect(() => parseArgs(['--delay', 'x'])).toThrow('--delay must be a whole number from 0 to 2000, not "x"');
      expect(() => parseArgs(['--delay', '-1'])).toThrow('--delay must be a whole number from 0 to 2000, not "-1"');
      expect(() => parseArgs(['--delay', '2001'])).toThrow('--delay must be a whole number from 0 to 2000, not "2001"');
      expect(() => parseArgs([], { QA_DELAY_MS: 'x' } as NodeJS.ProcessEnv)).toThrow(
        '--delay must be a whole number from 0 to 2000, not "x"'
      );
      expect(parseArgs(['--delay', '0']).crawlDelayMs).toBe(0);
      expect(parseArgs(['--delay', '500']).crawlDelayMs).toBe(500);
    });

    it('--test-cap requires a whole number from 1 to 100000', () => {
      expect(() => parseArgs(['--test-cap', '0'])).toThrow(
        '--test-cap must be a whole number from 1 to 100000, not "0"'
      );
      expect(() => parseArgs(['--test-cap', '100001'])).toThrow(
        '--test-cap must be a whole number from 1 to 100000, not "100001"'
      );
      expect(() => parseArgs(['--test-cap', 'bad'])).toThrow(
        '--test-cap must be a whole number from 1 to 100000, not "bad"'
      );
      expect(parseArgs(['--test-cap', '40']).testCap).toBe(40);
    });
  });

  describe('missing flag values', () => {
    it('throws when a value flag is last or followed by another flag', () => {
      expect(() => parseArgs(['--max-pages'])).toThrow('--max-pages needs a value');
      expect(() => parseArgs(['--max-pages', '--staging'])).toThrow('--max-pages needs a value');
      expect(() => parseArgs(['--fail-on'])).toThrow('--fail-on needs a value');
      expect(() => parseArgs(['--provider'])).toThrow('--provider needs a value');
      expect(() => parseArgs(['--output'])).toThrow('--output needs a value');
      expect(() => parseArgs(['--concurrency'])).toThrow('--concurrency needs a value');
      expect(() => parseArgs(['--delay'])).toThrow('--delay needs a value');
      expect(() => parseArgs(['--test-cap'])).toThrow('--test-cap needs a value');
      expect(() => parseArgs(['--header'])).toThrow('--header needs a value');
      expect(() => parseArgs(['--header', '--staging'])).toThrow('--header needs a value');
      expect(() => parseArgs(['--preset'])).toThrow('--preset needs a value');
      expect(() => parseArgs(['--health-path'])).toThrow('--health-path needs a value');
      expect(() => parseArgs(['--expected-version'])).toThrow('--expected-version needs a value');
    });
  });

  describe('--header validation', () => {
    it('throws --header message when flag value is malformed', () => {
      expect(() => parseArgs(['--header', 'bad'])).toThrow('--header must look like "Name: value"');
      expect(() => parseArgs(['--header', 'NoColonLine'])).toThrow('--header must look like "Name: value"');
    });

    it('keeps QA_CUSTOM_HEADERS is not valid for environment variable only', () => {
      expect(() => parseArgs([], { QA_CUSTOM_HEADERS: 'invalid-json' } as NodeJS.ProcessEnv)).toThrow(
        'QA_CUSTOM_HEADERS is not valid'
      );
    });

    it('parses valid custom headers', () => {
      const args = parseArgs(['--header', 'X-Custom: test-val', '--header', 'Authorization: Bearer token']);
      expect(args.customHeaders).toEqual({
        'X-Custom': 'test-val',
        Authorization: 'Bearer token',
      });
    });
  });

  describe('--help and -h', () => {
    it('--help returns help: true', () => {
      expect(parseArgs(['--help']).help).toBe(true);
    });

    it('-h returns help: true', () => {
      expect(parseArgs(['-h']).help).toBe(true);
    });

    it('runCheckup prints usage and returns 0 when args.help is true without requiring URL', async () => {
      const code = await runCheckup({
        help: true,
        staging: false,
        failOn: 'standard',
        outputDir: 'qa-report',
        maxPages: 50,
        provider: 'openrouter',
        signIns: [],
        docs: [],
      });
      expect(code).toBe(0);
    });
  });

  describe('valid parsing and URL placement', () => {
    it('finds URL placed before, between or after value flags', () => {
      expect(parseArgs(['https://target.test', '--max-pages', '20']).url).toBe('https://target.test');
      expect(parseArgs(['--max-pages', '20', 'https://target.test']).url).toBe('https://target.test');
      expect(parseArgs(['--fail-on', 'blocker', 'https://target.test', '--staging']).url).toBe('https://target.test');
    });

    it('parses all valid flags together', () => {
      const args = parseArgs([
        'https://app.test',
        '--staging',
        '--fail-on',
        'blocker',
        '--max-pages',
        '100',
        '--concurrency',
        '3',
        '--delay',
        '250',
        '--test-cap',
        '50',
        '--provider',
        'gemini',
        '--output',
        'my-report',
      ]);
      expect(args.url).toBe('https://app.test');
      expect(args.staging).toBe(true);
      expect(args.failOn).toBe('blocker');
      expect(args.maxPages).toBe(100);
      expect(args.crawlConcurrency).toBe(3);
      expect(args.crawlDelayMs).toBe(250);
      expect(args.testCap).toBe(50);
      expect(args.provider).toBe('gemini');
      expect(args.outputDir).toContain('my-report');
    });
  });
});
