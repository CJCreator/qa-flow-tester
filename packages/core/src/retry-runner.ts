import type { RetryTelemetryEntry } from '@qa/types';
import { categoriseFlakyCause } from './flaky-cause.js';
import { redactUrl } from './redact.js';

export interface RetryRunnerOptions {
  /** Reruns after the first failure (default 1). Stops at the first pass. */
  maxRetries?: number;
  flowId: string;
  testCaseId: string;
  /** Return false for an error that must not be retried, such as the user stopping the run. */
  shouldRetry?: (error: Error) => boolean;
  /** Whether a write was sent during the test; used only to name the likely cause. */
  sentAny?: () => boolean;
}

export interface RetryExecutionResult<T> {
  result?: T;
  outcome: 'PASSED' | 'FLAKY_PASSED' | 'FAILED';
  attempts: number;
  telemetry?: RetryTelemetryEntry;
  error?: Error;
}

/**
 * Transient failures only: a navigation that timed out or failed at the network, or a browser that closed under
 * the test. A failed step, a missing element or a failed assertion is a real result and is not retried.
 */
const TRANSIENT_FAILURE =
  /page\.(goto|reload|goBack|goForward|waitForURL|waitForNavigation): Timeout \d+ms exceeded|page\.goto: net::ERR_|Target (page, context or browser has been closed|closed|crashed)|Page crashed|Browser has been closed/i;

export function isTransientFailure(error: Error): boolean {
  return TRANSIENT_FAILURE.test(error.message);
}

export class RetryRunner {
  /**
   * Executes a flow with Clean Whole-Flow Retry semantics.
   * If an attempt fails, it discards and re-runs the action factory in a pristine context, up to
   * `maxRetries` times, and stops at the first pass. The pass rate is passes / attempts made.
   * A flaky test stays passed (Flaky Passed); nothing here hides a test or lengthens a timeout.
   */
  static async runWithCleanRetry<T>(
    actionFactory: (attempt: number) => Promise<T>,
    options: RetryRunnerOptions
  ): Promise<RetryExecutionResult<T>> {
    const maxRetries = options.maxRetries ?? 1;
    let attempts = 0;
    let firstError: Error | undefined;
    const errors: string[] = [];

    const telemetryFor = (
      status: RetryTelemetryEntry['status'],
      passes: number,
      message: string | undefined
    ): RetryTelemetryEntry => ({
      flowId: options.flowId,
      testCaseId: options.testCaseId,
      failedStepIndex: 0,
      retryCount: attempts - 1,
      status,
      errorMessage: message === undefined ? undefined : redactUrl(message),
      passes,
      attempts,
      passRate: attempts > 0 ? passes / attempts : 0,
      likelyCause: categoriseFlakyCause({ errors, sentAny: options.sentAny?.() }),
    });

    while (attempts <= maxRetries) {
      attempts++;
      try {
        const result = await actionFactory(attempts);
        if (attempts === 1) {
          return {
            result,
            outcome: 'PASSED',
            attempts,
          };
        }
        return {
          result,
          outcome: 'FLAKY_PASSED',
          attempts,
          telemetry: telemetryFor('FLAKY_PASSED', 1, firstError?.message),
        };
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (!firstError) {
          firstError = error;
        }
        errors.push(error.message);

        if (attempts > maxRetries || options.shouldRetry?.(error) === false) {
          return {
            outcome: 'FAILED',
            attempts,
            error,
            telemetry: telemetryFor('FAILED', 0, error.message),
          };
        }
      }
    }

    return {
      outcome: 'FAILED',
      attempts,
      error: firstError,
    };
  }
}
