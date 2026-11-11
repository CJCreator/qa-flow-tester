import { describe, it, expect } from 'vitest';
import { RetryRunner } from '../src/retry-runner.js';

describe('Retry hardening', () => {
  describe('RetryRunner Clean Retry', () => {
    it('returns PASSED on clean first attempt', async () => {
      const outcome = await RetryRunner.runWithCleanRetry(async () => 'success', {
        flowId: 'flow-1',
        testCaseId: 'TC-1',
        maxRetries: 1,
      });

      expect(outcome.outcome).toBe('PASSED');
      expect(outcome.attempts).toBe(1);
      expect(outcome.result).toBe('success');
      expect(outcome.telemetry).toBeUndefined();
    });

    it('returns FLAKY_PASSED when second attempt succeeds', async () => {
      let callCount = 0;
      const outcome = await RetryRunner.runWithCleanRetry(
        async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Animation race condition');
          }
          return 'recovered';
        },
        { flowId: 'flow-flaky', testCaseId: 'TC-FLAKY', maxRetries: 1 }
      );

      expect(outcome.outcome).toBe('FLAKY_PASSED');
      expect(outcome.attempts).toBe(2);
      expect(outcome.result).toBe('recovered');
      expect(outcome.telemetry?.status).toBe('FLAKY_PASSED');
      expect(outcome.telemetry?.retryCount).toBe(1);
    });

    it('returns FAILED when all retries are exhausted', async () => {
      const outcome = await RetryRunner.runWithCleanRetry(
        async () => {
          throw new Error('Persistent 500 error');
        },
        { flowId: 'flow-fail', testCaseId: 'TC-FAIL', maxRetries: 1 }
      );

      expect(outcome.outcome).toBe('FAILED');
      expect(outcome.attempts).toBe(2);
      expect(outcome.telemetry?.status).toBe('FAILED');
      expect(outcome.error?.message).toBe('Persistent 500 error');
    });
  });
});
