import type { AIMessage, AICompletionOptions, AIProviderType } from '@qa/types';
import type { AIProvider } from '../ai/ai-provider.js';
import { stopIfAborted } from '../abort.js';

/** The AI Request Budget is spent: the Plan Item is planned by fixed rules instead. */
export class BudgetSpentError extends Error {
  constructor(message = 'The AI Request Budget for today is spent.') {
    super(message);
    this.name = 'BudgetSpentError';
  }
}

/** OpenRouter's free models allow 20 requests a minute, so requests start at least this far apart. */
export const FREE_TIER_REQUEST_GAP_MS = 3100;
/** Waits before retrying a request the service turned away for going too fast. */
const RATE_LIMIT_WAITS_MS = [20000, 45000];

/**
 * An AI provider that keeps to the AI Request Budget. It counts every request (retries too), refuses
 * once the allowance is spent, spaces OpenRouter requests to stay under the free tier's per-minute
 * limit, and waits and retries when the service says it's going too fast. Running out of the day's
 * free requests isn't retried: that ends the budget.
 */
export class PacedAI implements AIProvider {
  readonly providerType: AIProviderType;
  /** Requests made so far. */
  used = 0;
  private lastStart = 0;
  private gapMs: number;

  private signal?: AbortSignal;

  constructor(
    private inner: AIProvider,
    /** Requests allowed in all; Infinity when the service doesn't say how many are left. */
    private allowance = Infinity,
    /** `signal`: once aborted, no more requests are made (each throws an AbortError). */
    options: { gapMs?: number; sleep?: (ms: number) => Promise<void>; signal?: AbortSignal } = {}
  ) {
    this.providerType = inner.providerType;
    this.gapMs = options.gapMs ?? (inner.providerType === 'openrouter' ? FREE_TIER_REQUEST_GAP_MS : 0);
    if (options.sleep) this.sleep = options.sleep;
    this.signal = options.signal;
  }

  private sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** Requests still allowed. */
  get left(): number {
    return Math.max(0, this.allowance - this.used);
  }

  async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      stopIfAborted(this.signal);
      if (this.used >= this.allowance) throw new BudgetSpentError();
      const wait = this.lastStart + this.gapMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      stopIfAborted(this.signal);
      this.lastStart = Date.now();
      this.used++;
      try {
        return await this.inner.generateText(messages, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/\b429\b|rate.?limit/i.test(message)) throw err;
        if (/per.?day|daily/i.test(message)) {
          this.allowance = this.used;
          throw new BudgetSpentError('The AI service’s free requests for today are used up.');
        }
        if (attempt >= RATE_LIMIT_WAITS_MS.length) throw err;
        await this.sleep(RATE_LIMIT_WAITS_MS[attempt]);
      }
    }
  }
}
