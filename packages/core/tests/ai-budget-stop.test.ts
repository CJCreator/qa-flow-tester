import { describe, expect, it } from 'vitest';
import type { AICompletion, AIMessage, AICompletionOptions } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { isAbortError } from '../src/abort.js';
import { PacedAI, StoppedEarlyError } from '../src/plan/ai-budget.js';

function abortableProvider() {
  let receivedSignal: AbortSignal | undefined;
  let calls = 0;
  let onCall: (() => void) | undefined;

  const provider: AIProvider = {
    providerType: 'openai',
    async generateText() {
      return '';
    },
    async complete(_m: AIMessage[], options?: AICompletionOptions): Promise<AICompletion> {
      calls++;
      receivedSignal = options?.signal;
      onCall?.();
      if (!options?.signal) {
        return { text: 'ok', finishReason: 'stop' };
      }
      return new Promise<AICompletion>((resolve, reject) => {
        if (options.signal!.aborted) {
          reject(new Error('aborted'));
          return;
        }
        options.signal!.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'));
          },
          { once: true }
        );
      });
    },
  };
  return {
    provider,
    getReceivedSignal: () => receivedSignal,
    getCalls: () => calls,
    waitForCall: () =>
      new Promise<void>((resolve) => {
        onCall = resolve;
      }),
  };
}

describe('PacedAI stop signals', () => {
  it('cancels an in-flight request when signal is aborted, rejects with abort error, and resets used to 0', async () => {
    const p = abortableProvider();
    const controller = new AbortController();
    const paced = new PacedAI(p.provider, 10, { signal: controller.signal, gapMs: 0 });

    const callPromise = p.waitForCall();
    const promise = paced.complete([]);
    await callPromise;
    expect(paced.used).toBe(1);

    const start = Date.now();
    controller.abort();

    await expect(promise).rejects.toSatisfy((err: unknown) => isAbortError(err));
    expect(Date.now() - start).toBeLessThan(100);
    expect(paced.used).toBe(0);
  });

  it('cancels an in-flight request when finishSignal is aborted, rejects with StoppedEarlyError, and resets used to 0', async () => {
    const p = abortableProvider();
    const finishController = new AbortController();
    const paced = new PacedAI(p.provider, 10, { finishSignal: finishController.signal, gapMs: 0 });

    const callPromise = p.waitForCall();
    const promise = paced.complete([]);
    await callPromise;
    expect(paced.used).toBe(1);

    finishController.abort();

    await expect(promise).rejects.toThrow(StoppedEarlyError);
    expect(paced.used).toBe(0);
  });

  it('passes no signal to the provider when neither stop signal is configured', async () => {
    const p = abortableProvider();
    const paced = new PacedAI(p.provider, 10, { gapMs: 0 });

    const result = await paced.complete([]);
    expect(result.text).toBe('ok');
    expect(p.getReceivedSignal()).toBeUndefined();
    expect(paced.used).toBe(1);
  });

  it("honours caller's own options.signal alongside stop signals", async () => {
    const p = abortableProvider();
    const runnerController = new AbortController();
    const callerController = new AbortController();
    const paced = new PacedAI(p.provider, 10, { signal: runnerController.signal, gapMs: 0 });

    const callPromise = p.waitForCall();
    const promise = paced.complete([], { signal: callerController.signal });
    await callPromise;
    expect(paced.used).toBe(1);
    expect(p.getReceivedSignal()).toBeDefined();

    callerController.abort();

    await expect(promise).rejects.toThrow('aborted');
    expect(runnerController.signal.aborted).toBe(false);
  });

  it("honours caller's own options.signal when no stop signals are configured", async () => {
    const p = abortableProvider();
    const callerController = new AbortController();
    const paced = new PacedAI(p.provider, 10, { gapMs: 0 });

    const callPromise = p.waitForCall();
    const promise = paced.complete([], { signal: callerController.signal });
    await callPromise;
    expect(paced.used).toBe(1);
    expect(p.getReceivedSignal()).toBeDefined();

    callerController.abort();

    await expect(promise).rejects.toThrow('aborted');
  });
});
