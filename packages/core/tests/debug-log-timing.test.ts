import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { stageTiming } from '../src/debug-log.js';

describe('debug-log: stageTiming', () => {
  const origEnv = process.env.QA_DEBUG;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (origEnv !== undefined) {
      process.env.QA_DEBUG = origEnv;
    } else {
      delete process.env.QA_DEBUG;
    }
  });

  it('prints a [qa:timing] line when QA_DEBUG=timing', () => {
    process.env.QA_DEBUG = 'timing';
    stageTiming('test', 1234.6, { testCaseId: 'TC-1', wallMs: 1300 });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain('[qa:timing]');
    expect(line).toContain('stage=test');
    expect(line).toContain('durationMs=1235');
    expect(line).toContain('testCaseId=TC-1');
    expect(line).toContain('wallMs=1300');
  });

  it('prints a [qa:timing] line when QA_DEBUG=all', () => {
    process.env.QA_DEBUG = 'all';
    stageTiming('ai', 10);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('[qa:timing]');
  });

  it('prints nothing when QA_DEBUG is unset', () => {
    delete process.env.QA_DEBUG;
    stageTiming('run', 500);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('prints nothing when QA_DEBUG names other areas only', () => {
    process.env.QA_DEBUG = 'crawl,auth';
    stageTiming('narrow', 20);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
