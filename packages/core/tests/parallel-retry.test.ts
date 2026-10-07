import { describe, it, expect } from 'vitest';
import { AccountPoolManager } from '../src/account-pool.js';
import { EntityNamespacer } from '../src/entity-namespacing.js';
import { RetryRunner } from '../src/retry-runner.js';

describe('Parallelism, Account Pooling & Retry Hardening', () => {
  describe('AccountPoolManager', () => {
    it('leases accounts to concurrent workers and prevents conflicts', () => {
      const pool = new AccountPoolManager({
        admin: [
          { role: 'admin', username: 'admin1@test.com' },
          { role: 'admin', username: 'admin2@test.com' },
        ],
      });

      expect(pool.getAvailableCount('admin')).toBe(2);

      const lease1 = pool.leaseAccount('admin', 'worker-1');
      expect(lease1?.credential.username).toBe('admin1@test.com');
      expect(pool.getAvailableCount('admin')).toBe(1);

      const lease2 = pool.leaseAccount('admin', 'worker-2');
      expect(lease2?.credential.username).toBe('admin2@test.com');
      expect(pool.getAvailableCount('admin')).toBe(0);

      // Third worker gets null when pool is exhausted
      const lease3 = pool.leaseAccount('admin', 'worker-3');
      expect(lease3).toBeNull();

      // When worker-1 completes, account returns to pool
      pool.releaseAccount(lease1!.leaseId);
      expect(pool.getAvailableCount('admin')).toBe(1);

      const lease4 = pool.leaseAccount('admin', 'worker-3');
      expect(lease4?.credential.username).toBe('admin1@test.com');
    });
  });

  describe('EntityNamespacer', () => {
    it('generates unique run/worker-prefixed names', () => {
      const name1 = EntityNamespacer.generateName('project', 'w1');
      const name2 = EntityNamespacer.generateName('project', 'w2');
      expect(name1).toContain('project_ww1_');
      expect(name2).toContain('project_ww2_');
      expect(name1).not.toBe(name2);
    });

    it('injects variables into step values', () => {
      const step = {
        action: 'fill' as const,
        name: 'Enter title',
        value: 'New Invoice {{entityName}}',
      };

      const injected = EntityNamespacer.injectStepValues(step, 1);
      expect(injected.value).toContain('New Invoice entity_w1_');
    });
  });

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
