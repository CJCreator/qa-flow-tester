# T-190: Report: "Look over the other screens" names the Check-up it is for and shows the runner's reason

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/api.ts`
- `packages/wizard/src/screens/ReportScreen.tsx`
- `packages/wizard/tests/finish-ai-review.test.ts` (new)

**Do not build in parallel with:** T-193, T-194, T-195 (edit `api.ts` or `ReportScreen.tsx`).

## Problem

The button "Look over the other N screens" calls `POST /api/runner/ai/finish` with no body. The runner finishes the AI review of its last Check-up, which is not always the report on screen (an older report opened from Past check-ups). The wizard also throws a fixed message and drops the reason the runner gives in its `error` field (for example a 409 when nothing is left to review).

## Current code

`packages/wizard/src/api.ts:708-720` (branch `worktree-audit-cleanup`)

```ts
export async function finishAiReview(): Promise<{
  completed: boolean;
  reviewedCount: number;
  remainingCount: number;
  addedFindingsCount: number;
  grades?: ReleaseReport['grades'];
  note?: string;
}> {
  const res = await call('/api/runner/ai/finish', { method: 'POST' });
  if (!res.ok) throw new RunnerError('Couldn’t finish the AI review. Try again.');
  return json(res);
}
```

`packages/wizard/src/screens/ReportScreen.tsx:602`

```tsx
              const result = await finishAiReview();
```

For comparison, `triageProblem` in the same `api.ts` (lines 844-847) already reads the runner's reason:

```ts
  if (!res.ok) {
    const err = await json<{ error?: string }>(res).catch((): { error?: string } => ({}));
    throw new RunnerError(err.error || 'That couldn’t be saved. Try again.');
  }
```

## Change

1. `api.ts`: replace `finishAiReview` with:

```ts
/** Finishes the AI review of one Check-up. The id is sent so the runner can refuse a report that is not its last. */
export async function finishAiReview(runId: string): Promise<{
  completed: boolean;
  reviewedCount: number;
  remainingCount: number;
  addedFindingsCount: number;
  grades?: ReleaseReport['grades'];
  note?: string;
}> {
  const res = await call('/api/runner/ai/finish', { method: 'POST', body: JSON.stringify({ runId }) });
  if (!res.ok) {
    const err = await json<{ error?: string }>(res).catch((): { error?: string } => ({}));
    throw new RunnerError(err.error || 'Couldn’t finish the AI review. Try again.');
  }
  return json(res);
}
```

2. `ReportScreen.tsx` line 602: change to

```tsx
              const result = await finishAiReview(report.runId);
```

## Tests

New file `packages/wizard/tests/finish-ai-review.test.ts`. Copy the `stubFetch` helper and its `afterEach` cleanup from `packages/wizard/tests/checkup-schedules.test.tsx` (top of that file). Cases:

```ts
it('sends the id of the Check-up on screen', async () => {
  const fetchMock = stubFetch(200, { completed: true, reviewedCount: 2, remainingCount: 0, addedFindingsCount: 0 });
  await finishAiReview('run-abc');
  const [, init] = fetchMock.mock.calls[0];
  expect(JSON.parse(String(init.body))).toEqual({ runId: 'run-abc' });
});

it('shows the runner’s reason on a refusal', async () => {
  stubFetch(409, { error: 'Every screen was already looked over.' });
  await expect(finishAiReview('run-abc')).rejects.toThrow('Every screen was already looked over.');
});

it('falls back to the fixed message', async () => {
  stubFetch(500, {});
  await expect(finishAiReview('run-abc')).rejects.toThrow('Couldn’t finish the AI review. Try again.');
});
```

If `stubFetch` in that file does not return the mock, make your local copy return it (`const mock = vi.fn(...); vi.stubGlobal('fetch', mock); return mock;`).

Run: `pnpm exec vitest run packages/wizard/tests/finish-ai-review.test.ts` then `pnpm build`.

## Done when

- [x] The request body is `{"runId":"<id of the report on screen>"}`.
- [x] A refusal shows the runner's own `error` text.
- [x] `finishAiReview` has no caller without an argument (`pnpm build` proves it).

## Notes

- The runner ignores the body today, so this is safe to ship alone. Refusing a `runId` that is not the runner's last report is a runner ticket, out of scope here.
- Do not change the message shown in the `catch` at `ReportScreen.tsx:612-617`; it already prints `RunnerError.message`.
