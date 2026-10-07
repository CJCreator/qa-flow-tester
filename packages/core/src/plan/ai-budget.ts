import type {
  AICompletion,
  AIMessage,
  AICompletionOptions,
  AIModelOutcome,
  AIProviderType,
  AIStage,
  AIStageUsage,
} from '@qa/types';
import { completeWith, type AIProvider } from '../ai/ai-provider.js';
import { stopIfAborted } from '../abort.js';

/** The AI Request Budget is spent: the Plan Item is planned by fixed rules instead. */
export class BudgetSpentError extends Error {
  constructor(message = 'The AI Request Budget for today is spent.') {
    super(message);
    this.name = 'BudgetSpentError';
  }
}

/** The person stopped the scan to plan what was found: fixed rules plan the rest. */
export class StoppedEarlyError extends BudgetSpentError {
  constructor() {
    super('The scan was stopped, so fixed rules planned the rest.');
    this.name = 'StoppedEarlyError';
  }
}

/** OpenRouter's free models allow 20 requests a minute, so requests start at least this far apart. */
export const FREE_TIER_REQUEST_GAP_MS = 3100;
/** Waits before retrying a request the service turned away for going too fast. */
const RATE_LIMIT_WAITS_MS = [20000, 45000];

/** A cut-off answer with nothing in it: the model spent its whole output allowance before answering. */
export function stoppedBeforeAnswering(result: AICompletion): boolean {
  return result.finishReason === 'length' && result.text.trim() === '';
}

/**
 * An AI provider that keeps to the AI Request Budget. It counts every request (retries too), refuses
 * once the allowance is spent, spaces OpenRouter requests to stay under the free tier's per-minute
 * limit, and waits and retries when the service says it's going too fast. Running out of the day's
 * free requests isn't retried: that ends the budget.
 *
 * It also adds up the tokens each stage used and how each model did. When a model stops before
 * writing anything (its allowance all went on hidden reasoning), the next fallback model is used
 * from then on.
 */
export class PacedAI implements AIProvider {
  readonly providerType: AIProviderType;
  /** Requests made so far. */
  used = 0;
  /** Tokens used per stage. */
  readonly tokens: Partial<Record<AIStage, AIStageUsage>> = {};
  /** How each model did. */
  readonly models: Record<string, AIModelOutcome> = {};
  private lastStart = 0;
  private gapMs: number;
  private signal?: AbortSignal;
  private finishSignal?: AbortSignal;
  /** The model in use once a fallback took over; the provider's own model before that. */
  private model?: string;
  private fallbackModels: string[];

  constructor(
    private inner: AIProvider,
    /** Requests allowed in all; Infinity when the service doesn't say how many are left. */
    private allowance = Infinity,
    /**
     * `signal`: once aborted, no more requests are made (each throws an AbortError).
     * `model`: the model the provider uses, for the per-model record.
     * `fallbackModels`: tried in order when a model stops before answering.
     */
    options: {
      gapMs?: number;
      sleep?: (ms: number) => Promise<void>;
      signal?: AbortSignal;
      /** Once aborted, no more requests are made (each throws StoppedEarlyError): the scan plans what it has. */
      finishSignal?: AbortSignal;
      model?: string;
      fallbackModels?: string[];
    } = {}
  ) {
    this.providerType = inner.providerType;
    this.gapMs = options.gapMs ?? (inner.providerType === 'openrouter' ? FREE_TIER_REQUEST_GAP_MS : 0);
    if (options.sleep) this.sleep = options.sleep;
    this.signal = options.signal;
    this.finishSignal = options.finishSignal;
    this.model = options.model;
    this.fallbackModels = [...(options.fallbackModels ?? [])].filter((m) => m !== options.model);
  }

  private sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** Requests still allowed. */
  get left(): number {
    return Math.max(0, this.allowance - this.used);
  }

  /** The model answering now. */
  get currentModel(): string | undefined {
    return this.model;
  }

  async generateText(messages: AIMessage[], options?: AICompletionOptions): Promise<string> {
    return (await this.complete(messages, options)).text;
  }

  async complete(messages: AIMessage[], options: AICompletionOptions = {}): Promise<AICompletion> {
    let rateLimited = 0;
    for (;;) {
      stopIfAborted(this.signal);
      if (this.finishSignal?.aborted) throw new StoppedEarlyError();
      if (this.used >= this.allowance) throw new BudgetSpentError();
      const wait = this.lastStart + this.gapMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      stopIfAborted(this.signal);
      this.lastStart = Date.now();
      this.used++;
      const model = options.model ?? this.model;
      let result: AICompletion;
      try {
        result = await completeWith(this.inner, messages, model ? { ...options, model } : options);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/\b429\b|rate.?limit/i.test(message)) {
          this.outcome(model, 'failed');
          throw err;
        }
        if (/per.?day|daily/i.test(message)) {
          this.allowance = this.used;
          throw new BudgetSpentError('The AI service’s free requests for today are used up.');
        }
        // This model's shared free pool is busy: another model answers sooner than waiting would.
        const next =
          !options.model && /upstream|temporarily rate.?limited/i.test(message)
            ? this.fallbackModels.shift()
            : undefined;
        if (next) {
          this.outcome(model, 'failed');
          this.model = next;
          continue;
        }
        if (rateLimited >= RATE_LIMIT_WAITS_MS.length) throw err;
        await this.sleep(RATE_LIMIT_WAITS_MS[rateLimited++]);
        continue;
      }
      this.tally(options.stage ?? 'other', result);
      const answeredBy = model ?? result.model;
      if (stoppedBeforeAnswering(result)) {
        this.outcome(answeredBy, 'truncated');
        // This model spends its allowance thinking: the next one takes over for the rest of the run.
        const next = !options.model ? this.fallbackModels.shift() : undefined;
        if (next) {
          this.model = next;
          continue;
        }
        return result;
      }
      this.outcome(answeredBy, result.finishReason === 'length' ? 'truncated' : result.text.trim() ? 'ok' : 'failed');
      return result;
    }
  }

  private tally(stage: AIStage, result: AICompletion): void {
    const s = (this.tokens[stage] ??= {
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      truncated: 0,
    });
    s.requests++;
    s.promptTokens += result.usage?.promptTokens ?? 0;
    s.completionTokens += result.usage?.completionTokens ?? 0;
    s.reasoningTokens += result.usage?.reasoningTokens ?? 0;
    if (result.finishReason === 'length') s.truncated++;
  }

  private outcome(model: string | undefined, how: keyof AIModelOutcome): void {
    if (!model) return;
    (this.models[model] ??= { ok: 0, truncated: 0, failed: 0 })[how]++;
  }
}

/** Pages a first scan usually ends up testing on its own: look-alike pages are covered by a few samples. */
const TYPICAL_TESTED_PAGES = 24;
const PAGES_PER_REQUEST_ESTIMATE = 3;

/**
 * About how many AI requests a scan needs, before it starts: from the pages seen last time, or a
 * typical site. `low` is every answer usable first time; `high` has every answer repaired once.
 * The visual review after the run comes on top.
 */
export function estimateScanRequests(options: {
  maxPages: number;
  pagesSeenBefore?: number;
  visualReviewCalls: number;
}): {
  low: number;
  high: number;
  visualReview: number;
} {
  const pages = Math.max(1, Math.min(options.maxPages, options.pagesSeenBefore ?? TYPICAL_TESTED_PAGES));
  const batches = Math.ceil(pages / PAGES_PER_REQUEST_ESTIMATE);
  // Pages, the journeys, and the shared menus when their destinations weren't all seen.
  const low = batches + 1;
  const high = 2 * (batches + 2);
  return {
    low,
    high,
    visualReview: Math.min(options.visualReviewCalls, Math.max(1, Math.ceil(pages / PAGES_PER_REQUEST_ESTIMATE))),
  };
}
