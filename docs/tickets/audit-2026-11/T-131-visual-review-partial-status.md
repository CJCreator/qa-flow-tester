# T-131: A visual review that stopped early says so

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | built |

**Files you may edit (no others):**
- `packages/core/src/ai/visual-review.ts`
- `packages/core/tests/visual-review.test.ts`

**Do not build in parallel with:** none.

## Problem

1. `reviewScreens` looks at up to `maxCalls` screens. If the AI service fails part-way (or the AI Request
   Budget runs out) and the number of screens was not above `maxCalls`, the result is still
   `status: 'completed'` and the note leaves out "the rest can be finished from the report", although
   `remainingScreens` is not empty. The report then offers no way to finish the review.

   Cause: `isPartial = looked < totalCount && remaining.length > 0`. `remaining` is only the screens past
   `maxCalls`; a stop inside the first `maxCalls` leaves it empty.

2. Dead condition at the top: the mock-provider half of the `if` does nothing (the only `return` is inside
   `if (!aiProvider)`).

## Current code

`packages/core/src/ai/visual-review.ts:48-61` (branch `worktree-audit-cleanup`)

```ts
    // Graceful skip if no AI provider / key available
    if (!aiProvider || (aiProvider.providerType === 'mock' && !process.env.TEST_MOCK_AI)) {
      // In production without real key, or mock when not testing mock
      if (!aiProvider) {
        return {
          status: 'skipped',
          reviewedCount: 0,
          totalCount,
          findings: [],
          remainingScreens: screens,
          note: 'AI visual review skipped — no AI API key configured',
        };
      }
    }
```

`visual-review.ts:120-125`

```ts
    const looked = reviewedCount + unreadable;
    const isPartial = looked < totalCount && remaining.length > 0;
    const note = isPartial
      ? `The AI looked at ${reviewedCount} of ${totalCount} screens; the rest can be finished from the report.`
      : `The AI looked at ${reviewedCount} of ${totalCount} screens.`;
```

## Change

1. Replace the first block with:

```ts
    // No AI: nothing is looked at.
    if (!aiProvider) {
      return {
        status: 'skipped',
        reviewedCount: 0,
        totalCount,
        findings: [],
        remainingScreens: screens,
        note: 'AI visual review skipped — no AI API key configured',
      };
    }
```

2. Replace the `isPartial` line with:

```ts
    // Partial whenever a screen is left, whether the cap or a failure stopped the review.
    const isPartial = looked < totalCount;
```

3. If `remaining` is now unused (TypeScript or lint says so), delete its declaration
   (`const remaining = screens.slice(maxCalls);`).

## Tests

Edit `packages/core/tests/visual-review.test.ts`. Copy the set-up of
`'runs full visual review when budget covers all screens'` (it builds screens and a fake AI provider). Add:

```ts
  it('is partial when the AI fails part-way, even under the cap', async () => {
    // three screens, maxCalls 10, a provider whose 2nd call rejects
    ...
    expect(result.status).toBe('partial');
    expect(result.reviewedCount).toBe(1);
    expect(result.remainingScreens).toHaveLength(2);
    expect(result.note).toContain('the rest can be finished from the report');
    expect(result.stoppedBy).toBeInstanceOf(Error);
  });
```

Make the fake provider throw on its second call (keep a counter in the fake's `generateText` / `complete` /
vision method: use the same method the existing fake implements).

Command: `pnpm exec vitest run packages/core/tests/visual-review.test.ts`, then `pnpm build`.

## Done when

- [x] The new test passes and the six existing tests still pass
- [x] `TEST_MOCK_AI` no longer appears in `visual-review.ts`
- [x] `pnpm build` passes

## Notes

A screen whose screenshot cannot be read counts as "looked at" (`unreadable`); that rule is unchanged.
