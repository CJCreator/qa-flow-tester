import { describe, expect, it } from 'vitest';
import type { AICompletion, AIMessage } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import {
  BudgetSpentError,
  CapSpentError,
  PacedAI,
  UNREPORTED_LIMIT_GAP_MS,
  estimateUsd,
  pacingFor,
} from '../src/plan/ai-budget.js';
import { fallbackNotes, fallbackReasonOf } from '../src/plan/ai-planner.js';

function slowProvider(type: 'openrouter' | 'openai', tokens = { promptTokens: 0, completionTokens: 0 }) {
  const state = { inFlight: 0, maxInFlight: 0, calls: 0 };
  const provider: AIProvider = {
    providerType: type,
    async generateText() {
      return '';
    },
    async complete(_m: AIMessage[]): Promise<AICompletion> {
      state.calls++;
      state.inFlight++;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      await new Promise((r) => setTimeout(r, 15));
      state.inFlight--;
      return { text: 'ok', finishReason: 'stop', usage: tokens };
    },
  };
  return { provider, state };
}

describe('pacingFor', () => {
  it('goes one at a time with the default gap when OpenRouter reports no per-interval limit', () => {
    expect(pacingFor({}, 'openrouter')).toEqual({ gapMs: UNREPORTED_LIMIT_GAP_MS, concurrency: 1 });
    expect(pacingFor(null, 'openrouter')).toEqual({ gapMs: UNREPORTED_LIMIT_GAP_MS, concurrency: 1 });
  });

  it('keeps a free key sequential: only a daily count is reported', () => {
    expect(pacingFor({ remainingRequests: 40, limitRequests: 50 }, 'openrouter').concurrency).toBe(1);
  });

  it('allows several at once only when the service reports a rate, capped at 4', () => {
    const p = pacingFor({ requestsPerInterval: 100, intervalMs: 10000 }, 'openrouter');
    expect(p).toEqual({ gapMs: 100, concurrency: 4 });
    expect(pacingFor({ requestsPerInterval: 2, intervalMs: 1000 }, 'openrouter').concurrency).toBe(2);
    // Little left today: headroom limits concurrency.
    expect(pacingFor({ requestsPerInterval: 100, intervalMs: 1000, remainingRequests: 1 }, 'openrouter').concurrency).toBe(1);
  });

  it('other providers: no gap, one at a time unless reported', () => {
    expect(pacingFor({}, 'openai')).toEqual({ gapMs: 0, concurrency: 1 });
    expect(pacingFor({ requestsPerInterval: 60, intervalMs: 60000 }, 'openai')).toEqual({ gapMs: 1000, concurrency: 4 });
  });
});

describe('PacedAI concurrency', () => {
  it('runs requests in parallel when allowed, and counts them exactly', async () => {
    const { provider, state } = slowProvider('openai');
    const ai = new PacedAI(provider, 100, { concurrency: 3, gapMs: 0 });
    await Promise.all(Array.from({ length: 6 }, () => ai.complete([])));
    expect(ai.used).toBe(6);
    expect(state.calls).toBe(6);
    expect(state.maxInFlight).toBeGreaterThan(1);
    expect(state.maxInFlight).toBeLessThanOrEqual(3);
  });

  it('is sequential by default', async () => {
    const { provider, state } = slowProvider('openai');
    const ai = new PacedAI(provider, Infinity, { gapMs: 0 });
    await Promise.all(Array.from({ length: 4 }, () => ai.complete([])));
    expect(state.maxInFlight).toBe(1);
    expect(ai.used).toBe(4);
  });

  it('never exceeds the allowance with parallel calls', async () => {
    const { provider, state } = slowProvider('openai');
    const ai = new PacedAI(provider, 3, { concurrency: 4, gapMs: 0 });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => ai.complete([])));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
    expect(state.calls).toBe(3);
    expect(ai.used).toBe(3);
  });

  it('keeps the gap between starts under concurrency', async () => {
    const { provider } = slowProvider('openai');
    const waits: number[] = [];
    const ai = new PacedAI(provider, Infinity, {
      concurrency: 3,
      gapMs: 1000,
      sleep: async (ms) => void waits.push(ms),
    });
    await Promise.all([ai.complete([]), ai.complete([]), ai.complete([])]);
    const sorted = waits.filter((w) => w > 0).sort((a, b) => a - b);
    expect(sorted).toHaveLength(2);
    // The second and third requests are reserved one and two gaps after the first.
    expect(sorted[1] - sorted[0]).toBeGreaterThanOrEqual(900);
  });
});

describe('PacedAI cap', () => {
  it('stops at the request cap and labels the fallback "cap"', async () => {
    const { provider } = slowProvider('openai');
    const ai = new PacedAI(provider, Infinity, { gapMs: 0, cap: { requests: 2 } });
    await ai.complete([]);
    await ai.complete([]);
    expect(ai.left).toBe(0);
    let err: unknown;
    try {
      await ai.complete([]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CapSpentError);
    expect(err).toBeInstanceOf(BudgetSpentError);
    expect(fallbackReasonOf(err)).toBe('cap');
    expect(ai.used).toBe(2);
    const notes = fallbackNotes([{ source: 'fallback', fallbackReason: 'cap' }]);
    expect(notes).toEqual([expect.stringContaining('cap you set')]);
  });

  it('the provider allowance still wins when it is smaller than the cap', async () => {
    const { provider } = slowProvider('openai');
    const ai = new PacedAI(provider, 1, { gapMs: 0, cap: { requests: 5 } });
    await ai.complete([]);
    const err = await ai.complete([]).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetSpentError);
    expect(err).not.toBeInstanceOf(CapSpentError);
    expect(fallbackReasonOf(err)).toBe('budget');
  });

  it('stops at the dollar cap when a price is known', async () => {
    // 1000 prompt + 1000 completion tokens at $1 + $3 per million = $0.004 a request.
    const { provider } = slowProvider('openai', { promptTokens: 1000, completionTokens: 1000 });
    const ai = new PacedAI(provider, Infinity, {
      gapMs: 0,
      cap: { dollars: 0.006 },
      price: { prompt: 1, completion: 3 },
    });
    await ai.complete([]);
    await ai.complete([]);
    expect(ai.spentUsd).toBeCloseTo(0.008, 6);
    const err = await ai.complete([]).catch((e) => e);
    expect(err).toBeInstanceOf(CapSpentError);
    expect(ai.used).toBe(2);
  });

  it('ignores a dollar cap when no price is known', async () => {
    const { provider } = slowProvider('openai', { promptTokens: 1000000, completionTokens: 1000000 });
    const ai = new PacedAI(provider, Infinity, { gapMs: 0, cap: { dollars: 0.0001 } });
    for (let i = 0; i < 3; i++) await ai.complete([]);
    expect(ai.used).toBe(3);
    expect(ai.spentUsd).toBe(0);
  });

  it('a free model (price 0) never reaches a dollar cap', async () => {
    const { provider } = slowProvider('openai', { promptTokens: 5000, completionTokens: 5000 });
    const ai = new PacedAI(provider, Infinity, { gapMs: 0, cap: { dollars: 0.01 }, price: { prompt: 0, completion: 0 } });
    for (let i = 0; i < 3; i++) await ai.complete([]);
    expect(ai.used).toBe(3);
  });
});

describe('estimateUsd', () => {
  it('is a plain average-token estimate', () => {
    const usd = estimateUsd(10, { prompt: 1, completion: 2 });
    expect(usd).toBeGreaterThan(0);
    expect(estimateUsd(10, { prompt: 0, completion: 0 })).toBe(0);
    expect(estimateUsd(20, { prompt: 1, completion: 2 })).toBeCloseTo(usd * 2, 9);
  });
});
