# T-99: A beta copy must not write the shared AI models file

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | built |

**Files you may edit (no others):**
- `packages/runner/src/server.ts`

**Do not build in parallel with:** T-91, T-92, T-94, T-96, T-97, T-100, T-106, T-108, T-110, T-112 (all edit `server.ts`).

## Problem

`.qa-ai-models.json` holds the AI provider and models for the whole runner. On a beta copy many testers share one runner. The settings POST already skips writing this file on beta (`if (!this.beta) {` near line 3011). Two other paths still write it on beta:

- `POST /api/ai/openrouter/key` (the wizard's key form), around line 3153.
- `refreshAiModels`, called on every Check-up start with an OpenRouter key, around line 2840.

Scenario: tester A chooses a model in Settings. Tester B starts a Check-up; `refreshAiModels` rewrites the shared file and A's next Check-up uses B's models.

## Current code

`packages/runner/src/server.ts:2830-2848` (branch `worktree-audit-cleanup`)

```ts
  private async refreshAiModels(
    apiKey: string
  ): Promise<{ text: string | null; vision: string | null; fallbacks: string[] }> {
    const [free, current, record] = await Promise.all([
      this.openRouter.listFreeModels(apiKey),
      this.readAiModels(),
      this.readModelRecord(),
    ]);
    const models = keepOrPickModels(free, current, record);
    const chosenBy = current.chosenBy === 'person' && current.text === models.text ? 'person' : undefined;
    await this.writeAiModels({
      ...current,
      provider: 'openrouter',
      text: models.text,
      vision: models.vision,
      chosenBy,
    });
    return { ...models, fallbacks: fallbackModels(free, models.text, record) };
  }
```

`packages/runner/src/server.ts:3152-3154`

```ts
      const current = await this.readAiModels();
      if ((current.provider ?? 'openrouter') !== 'openrouter') await this.writeAiModels({ provider: 'openrouter' });
      const models = await this.refreshAiModels(apiKey!.trim()).catch(() => ({ text: null, vision: null }));
```

## Change

1. In `refreshAiModels`, wrap the `await this.writeAiModels({...});` call:

```ts
    // The models file is shared by everyone on a beta copy: a tester's Check-up must not rewrite it.
    if (!this.beta) {
      await this.writeAiModels({
        ...current,
        provider: 'openrouter',
        text: models.text,
        vision: models.vision,
        chosenBy,
      });
    }
```

The method still returns the chosen models, so the Check-up that called it uses them.

2. At line 3153, change the condition to:

```ts
      if (!this.beta && (current.provider ?? 'openrouter') !== 'openrouter') {
        await this.writeAiModels({ provider: 'openrouter' });
      }
```

## Tests

No new test. Run the existing beta and AI suites to confirm nothing depended on the write:

`pnpm build`, then `pnpm exec vitest run packages/runner/tests/schedule-tick-beta-extra.test.ts packages/runner/tests/ai-gemini-models.test.ts`

Then run every runner AI test: `pnpm exec vitest run --project unit packages/runner/tests/ai-`

## Done when

- [x] On beta neither path calls `writeAiModels`.
- [x] Off beta both behave as before.
- [x] Build and the listed tests pass.

## Notes

- If a test fails because a beta Check-up expected the models file to change, stop and set the ticket to `blocked` with the test name. Do not delete the guard.
- Out of scope: per-visitor model storage.
