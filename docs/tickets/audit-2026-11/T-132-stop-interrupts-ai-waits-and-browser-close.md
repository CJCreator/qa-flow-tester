# T-132: Stop interrupts AI waits, and closing the browser leaves no 3-second timer behind

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | bug | built |

**Files you may edit (no others):**
- `packages/core/src/plan/ai-budget.ts`
- `packages/core/src/browser.ts`
- `packages/core/tests/ai-budget-pacing.test.ts`

**Do not build in parallel with:** T-135 (also edits `browser.ts` and `ai-budget.ts`).

## Problem

**A.** `PacedAI` waits between AI requests (the free-tier gap) and after a rate-limit answer (up to about 65 s).
Both waits are plain `setTimeout` promises. Pressing Stop, or "finish with what you have", does nothing until
the wait is over.

**B.** `BrowserManager.close()` races each `browser.close()` against a 3-second timer that is never cleared.
After a fast close the timer still holds the Node process open for up to 3 s (visible at the end of a CI
Check-up, `checkup.ts`).

## Current code

`packages/core/src/plan/ai-budget.ts:155-162` (branch `worktree-audit-cleanup`)

```ts
    if (options.sleep) this.sleep = options.sleep;
    this.signal = options.signal;
    this.finishSignal = options.finishSignal;
    ...
  private sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
```

The two waits (lines 227 and 258):

```ts
        if (wait > 0) await this.sleep(wait);
...
        await this.sleep(RATE_LIMIT_WAITS_MS[rateLimited++]);
```

`packages/core/src/browser.ts:254-262`

```ts
  async close(): Promise<void> {
    const closes: Promise<void>[] = [];
    for (const b of this.browsers.values()) {
      closes.push(Promise.race([b.close().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, 3000))]));
    }
    await Promise.all(closes);
    this.browsers.clear();
    this.browser = null;
  }
```

## Change

### A. `ai-budget.ts`

1. Add a private method below the `sleep` field:

```ts
  /** A wait that ends early when the run is stopped or asked to finish. The caller's next check stops it. */
  private async pause(ms: number): Promise<void> {
    const signals = [this.signal, this.finishSignal].filter((s): s is AbortSignal => !!s);
    if (signals.some((s) => s.aborted)) return;
    let wake: (() => void) | undefined;
    const woken = new Promise<void>((resolve) => {
      wake = resolve;
    });
    for (const s of signals) s.addEventListener('abort', wake!, { once: true });
    try {
      await Promise.race([this.sleep(ms), woken]);
    } finally {
      for (const s of signals) s.removeEventListener('abort', wake!);
    }
  }
```

2. Replace the two `await this.sleep(...)` calls (lines 227 and 258) with `await this.pause(...)`, same argument.

3. Right after each of those two calls, the code must notice the stop. Look at the lines that follow each
   call: if the loop already checks `this.signal?.aborted` / `this.finishSignal?.aborted` (or calls a helper
   that throws `StoppedEarlyError`) before the next request, leave it. If it does not, add directly after the
   `pause` call:

```ts
        if (this.signal?.aborted || this.finishSignal?.aborted) throw new StoppedEarlyError();
```

   Use the constructor arguments `StoppedEarlyError` already takes elsewhere in this file (search
   `new StoppedEarlyError(` and copy that call).

### B. `browser.ts`

4. Replace the body of the `for` loop in `close()`:

```ts
    for (const b of this.browsers.values()) {
      closes.push(
        (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const giveUp = new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 3000);
          });
          try {
            await Promise.race([b.close().catch(() => {}), giveUp]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        })()
      );
    }
```

## Tests

Edit `packages/core/tests/ai-budget-pacing.test.ts`. Copy the set-up of the test that passes
`sleep: async (ms) => void waits.push(ms)` (line 97). Add:

```ts
  it('ends a rate-limit wait as soon as the run is stopped', async () => {
    const stop = new AbortController();
    let release: (() => void) | undefined;
    const paced = new PacedAI(/* same provider stub that answers 429 once */, {
      /* same options */,
      signal: stop.signal,
      sleep: () => new Promise<void>((resolve) => { release = resolve; }), // never resolves on its own
    });
    const asking = paced.generateText([{ role: 'user', content: 'x' }]).catch((e) => e);
    await Promise.resolve();
    stop.abort();
    const outcome = await asking;           // must settle without calling release()
    expect(outcome).toBeInstanceOf(Error);
    release?.();
  });
```

Match the constructor arguments and the method name to what the neighbouring tests in that file use. Give the
test a 2 s timeout (`it(name, fn, 2000)`) so a regression fails fast.

Commands: `pnpm exec vitest run packages/core/tests/ai-budget-pacing.test.ts packages/core/tests/orchestrator-teardown.test.ts`, then `pnpm build`.

## Done when

- [x] `await this.sleep(` appears only inside `pause`
- [x] The new test passes; existing pacing tests pass (their recorded `waits` are unchanged)
- [x] `BrowserManager.close()` clears its timer
- [x] `pnpm build` passes

## Notes

The injected `sleep` option (used by tests to record waits) keeps working: `pause` calls it.
