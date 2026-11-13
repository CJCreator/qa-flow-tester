import { describe, expect, it } from 'vitest';
import type { AICompletion, AIMessage } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { CapSpentError, PacedAI, estimateUsd } from '../src/plan/ai-budget.js';

/** Price of 1 USD per million tokens each way: a request estimated at 4.5 USD, a real one of 2 USD. */
const PRICE = { prompt: 1000, completion: 1000 };
const REAL_TOKENS = { promptTokens: 1000, completionTokens: 1000 };

/** A provider whose requests stay pending until the test answers them. */
function heldProvider() {
  const pending: Array<{ resolve: (c: AICompletion) => void; reject: (e: Error) => void }> = [];
  const state = { calls: 0 };
  const provider: AIProvider = {
    providerType: 'openai',
    async generateText() {
      return '';
    },
    complete(_m: AIMessage[]): Promise<AICompletion> {
      state.calls++;
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  };
  return { provider, state, pending };
}

/** Lets queued microtasks run so every parallel request reaches the provider or the cap. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('PacedAI dollar cap with reservations', () => {
  it('stops parallel requests from all starting under the cap', async () => {
    const { provider, state, pending } = heldProvider();
    const ai = new PacedAI(provider, Infinity, { gapMs: 0, concurrency: 4, cap: { dollars: 10 }, price: PRICE });

    const calls = [1, 2, 3, 4].map(() => ai.complete([{ role: 'user', content: 'x' }] as AIMessage[]));
    const outcomes = calls.map((c) =>
      c.then(
        () => 'ok',
        (e: unknown) => e
      )
    );
    await settle();

    // Each request holds 4.5 USD: two fit under 10, the third would overshoot.
    expect(state.calls).toBe(2);
    expect(estimateUsd(1, PRICE)).toBe(4.5);

    for (const p of pending) p.resolve({ text: 'ok', finishReason: 'stop', usage: REAL_TOKENS });
    const results = await Promise.all(outcomes);
    expect(results.slice(0, 2)).toEqual(['ok', 'ok']);
    expect(results[2]).toBeInstanceOf(CapSpentError);
    expect(results[3]).toBeInstanceOf(CapSpentError);
    // Spent is the two real requests: at most the cap plus one request's real cost.
    expect(ai.spentUsd).toBe(4);
    expect(ai.spentUsd).toBeLessThanOrEqual(10 + 2);
  });

  it('releases the hold after a failed request, so the cap is not locked', async () => {
    const { provider, state, pending } = heldProvider();
    const ai = new PacedAI(provider, Infinity, { gapMs: 0, concurrency: 1, cap: { dollars: 10 }, price: PRICE });

    const first = ai.complete([] as AIMessage[]);
    await settle();
    pending[0].reject(new Error('network down'));
    await expect(first).rejects.toThrow('network down');

    const second = ai.complete([] as AIMessage[]);
    await settle();
    expect(state.calls).toBe(2);
    pending[1].resolve({ text: 'ok', finishReason: 'stop', usage: REAL_TOKENS });
    await expect(second).resolves.toMatchObject({ text: 'ok' });
  });

  it('changes nothing without a dollar cap', async () => {
    const { provider, state, pending } = heldProvider();
    const ai = new PacedAI(provider, Infinity, { gapMs: 0, concurrency: 4, cap: { requests: 10 }, price: PRICE });

    const calls = [1, 2, 3, 4].map(() => ai.complete([] as AIMessage[]));
    await settle();
    expect(state.calls).toBe(4);
    for (const p of pending) p.resolve({ text: 'ok', finishReason: 'stop', usage: REAL_TOKENS });
    await Promise.all(calls);
  });
});
