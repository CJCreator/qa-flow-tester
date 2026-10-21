import { describe, it, expect } from 'vitest';
import { RetryRunner, isTransientFailure } from '../src/retry-runner.js';

describe('T-57 retry policy: transient failures only', () => {
  it('classifies navigation timeouts, network errors and browser crashes as transient', () => {
    expect(isTransientFailure(new Error('page.goto: Timeout 10000ms exceeded.\nCall log:'))).toBe(true);
    expect(isTransientFailure(new Error('page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3001/'))).toBe(true);
    expect(isTransientFailure(new Error('page.click: Target page, context or browser has been closed'))).toBe(true);
    expect(isTransientFailure(new Error('page.evaluate: Target crashed'))).toBe(true);
  });

  it('does not classify step, locator and assertion failures as transient', () => {
    expect(isTransientFailure(new Error('locator.click: Timeout 5000ms exceeded.'))).toBe(false);
    expect(isTransientFailure(new Error('expect.toBeVisible: Timeout 5000ms exceeded.'))).toBe(false);
    expect(isTransientFailure(new Error('expect(received).toBe(expected) failed'))).toBe(false);
    expect(isTransientFailure(new Error('A step failed'))).toBe(false);
  });

  it('runs a failed assertion once and reports it as FAILED', async () => {
    let calls = 0;
    const out = await RetryRunner.runWithCleanRetry(
      async () => {
        calls++;
        throw new Error('expect(received).toBe(expected) failed');
      },
      { flowId: 'f', testCaseId: 't', maxRetries: 3, shouldRetry: isTransientFailure }
    );
    expect(out.outcome).toBe('FAILED');
    expect(out.attempts).toBe(1);
    expect(calls).toBe(1);
    expect(out.telemetry?.status).toBe('FAILED');
  });

  it('retries a navigation timeout once and reports FLAKY_PASSED when the retry passes', async () => {
    let calls = 0;
    const out = await RetryRunner.runWithCleanRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error('page.goto: Timeout 10000ms exceeded.');
        return 'ok';
      },
      { flowId: 'f', testCaseId: 't', maxRetries: 1, shouldRetry: isTransientFailure }
    );
    expect(out.outcome).toBe('FLAKY_PASSED');
    expect(out.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(out.telemetry?.status).toBe('FLAKY_PASSED');
  });

  it('retries a browser crash once and reports FLAKY_PASSED when the retry passes', async () => {
    let calls = 0;
    const out = await RetryRunner.runWithCleanRetry(
      async () => {
        calls++;
        if (calls === 1) throw new Error('Target crashed');
        return 'ok';
      },
      { flowId: 'f', testCaseId: 't', maxRetries: 1, shouldRetry: isTransientFailure }
    );
    expect(out.outcome).toBe('FLAKY_PASSED');
    expect(calls).toBe(2);
  });
});
