# T-128: A cut-off AI answer is reported the same way by every AI service

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | built |

**Files you may edit (no others):**
- `packages/core/src/ai/providers/openai.ts`
- `packages/core/src/plan/journeys.ts`
- `packages/core/tests/ai-provider.test.ts`

**Do not build in parallel with:** T-130 (also edits `journeys.ts`).

## Problem

When a model stops because it used its whole answer allowance:

- the Anthropic and Gemini providers **return** `finishReason: 'length'` from `complete()`;
- the OpenAI/OpenRouter provider **throws** a plain `Error`.

The planner (`askWithOneRepair` in `plan/ai-planner.ts`) and the AI Request Budget (`plan/ai-budget.ts`) look at
`finishReason === 'length'` to record the outcome as "truncated" and to tell the person to pick another model.
On OpenRouter (the default service) they never see it: a cut-off answer is recorded as "no answer", the model's
track record is wrong, and the note says "The AI service didn't answer".

Second place: the journeys repair request in `plan/journeys.ts` uses `ai.generateText`, which returns only the
text, so a cut-off **repair** is also reported as "didn't answer".

## Current code

`packages/core/src/ai/providers/openai.ts:20-22` (branch `worktree-audit-cleanup`)

```ts
  async generateText(messages: AIMessage[], options: AICompletionOptions = {}): Promise<string> {
    return (await this.complete(messages, options)).text;
  }
```

`openai.ts:114-121`

```ts
    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error(
        `The AI's answer was cut off at its length limit (${body.max_tokens} tokens) before it finished.`
      );
    }
```

`packages/core/src/plan/journeys.ts:258-273`

```ts
    const repairText = await ai.generateText(
      [
        system,
        asking,
        { role: 'assistant', content: responseText },
        {
          role: 'user',
          content: `That response was not usable:\n${problems ... }`,
        },
      ],
      { ...asked, stage: 'repair', temperature: 0 }
    );
    let flows: DiscoveredFlow[];
    try {
      flows = parseFlows(repairText);
```

`AITruncatedError` and `completeWith` are already imported in `journeys.ts` (line 9).

## Change

1. `openai.ts`, `complete()`: delete the `if (choice?.finish_reason === 'length') { throw ... }` block. The
   `return { ..., finishReason: choice?.finish_reason ?? choice?.native_finish_reason, ... }` below it already
   returns `'length'`.

2. `openai.ts`, `generateText()`: this method returns text only, so it must keep failing loudly on a cut-off
   answer (callers that use it cannot see `finishReason`):

```ts
  async generateText(messages: AIMessage[], options: AICompletionOptions = {}): Promise<string> {
    const answer = await this.complete(messages, options);
    if (answer.finishReason === 'length') {
      throw new Error("The AI's answer was cut off at its length limit before it finished.");
    }
    return answer.text;
  }
```

3. `journeys.ts`: replace `const repairText = await ai.generateText(` ... `);` with a `completeWith` call that
   keeps the same two arguments, then check the finish reason:

```ts
    const repair = await completeWith(
      ai,
      [ /* the same four messages, unchanged */ ],
      { ...asked, stage: 'repair', temperature: 0 }
    );
    // A cut-off repair is "the model ran out of room", not "the service didn't answer".
    if (repair.finishReason === 'length' && !firstParse) throw new AITruncatedError(repair.model);
    const repairText = repair.text;
```

   Keep the message array exactly as it is; only the call and the two lines after it change. The
   `&& !firstParse` matters: when the first answer was usable, the code below falls back to it.

## Tests

Edit `packages/core/tests/ai-provider.test.ts`. The existing test
`'asks OpenRouter models to answer without thinking first, and says when an answer was cut off'` expects
`generateText` to reject with `/cut off/`: it must still pass unchanged.

Add next to it, copying its `globalThis.fetch` stub (finish reason `'length'`, content `'{"flows":['`):

```ts
  it('returns finishReason "length" from complete() instead of throwing', async () => {
    // ...same fetch stub with finish_reason: 'length'...
    const openRouter = createAIProvider('openrouter', 'test-key', undefined, 'some/model:free');
    const answer = await openRouter.complete!([{ role: 'user', content: 'plan' }]);
    expect(answer.finishReason).toBe('length');
    expect(answer.text).toBe('{"flows":[');
  });
```

Restore `globalThis.fetch` in `finally`, as the existing test does.

Commands: `pnpm exec vitest run packages/core/tests/ai-provider.test.ts packages/core/tests/ai-budget-pacing.test.ts`,
then `pnpm exec vitest run packages/core/tests` and `pnpm build`.

## Done when

- [x] `complete()` on the OpenAI/OpenRouter provider returns `finishReason: 'length'` and does not throw
- [x] `generateText()` still rejects with a "cut off" message
- [x] The journeys repair throws `AITruncatedError` when its answer was cut off and there is no usable first answer
- [x] Core unit tests and `pnpm build` pass

## Notes

If another core test fails because it expected `complete()` to throw on a cut-off answer, change that
expectation to `finishReason === 'length'` and list the test in the PR.
