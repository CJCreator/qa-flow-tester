# T-138: AI failure reasons are dropped, so no "key expired" note is ever written

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core/audit | bug | built |

**Files you may edit (no others):**
- `packages/core/src/audit/ai/assessment.ts`
- `packages/core/src/audit/ai/page-recommendation.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/tests/audit-pipeline.test.ts`
- `packages/core/tests/audit-assessment.test.ts`

**Do not build in parallel with:** T-140, T-144, T-145, T-151, T-153, T-154, T-155, T-158 (all edit `pipeline.ts` or `assessment.ts`).

## Problem

`askSafely` in `assessment.ts` and in `page-recommendation.ts` catches every provider error, works out a status (`classifyAiError`) and a redacted message, and returns them. The callers throw both away. `assessPages`, `assessSite` and `recommendPages` therefore never throw for a provider error, so the `catch` branches in `pipeline.ts` that write the AI note never run.

Scenario: every AI request answers 401. The Website Audit ends with every area "not done", the step `assessment` recorded as `done`, and no note saying "The AI key expired. Update it in Audit settings." ADR 0042 requires the reason to be kept.

`pipeline.ts` also has a block that reads `(ai as any).status`, `.message` and `.reason` values that the type `AuditAiResolution` (`{ ok: false; reason: 'no-ai-key' }`) can never hold.

## Current code

`packages/core/src/audit/ai/assessment.ts:47` (branch `worktree-audit-cleanup`)

```ts
export interface AssessmentRunOptions {
  /** The audit's document language: notes are written in it. */
  language: DocumentLanguage;
  signal?: AbortSignal;
  timeoutMs?: number;
}
```

`packages/core/src/audit/ai/assessment.ts:283` (inside `askSafely`)

```ts
  } catch (err) {
    if (run.signal?.aborted) throw err;
    const status = classifyAiError(err);
    const error = redactAiMessage(err, 200);
    logAiFailure(ai.provider, err);
    return { ok: false, reason: 'ai-failed', status, error };
  }
```

`packages/core/src/audit/ai/page-recommendation.ts:264` (inside its own `askSafely`, whose `run` parameter is `RecommendPagesInput`)

```ts
  } catch (err) {
    if (run.signal?.aborted) throw err;
    const status = classifyAiError(err);
    const error = redactAiMessage(err, 200);
    logAiFailure(ai.provider, err);
    return { ok: false, status, error };
  }
```

`packages/core/src/audit/pipeline/pipeline.ts:625`

```ts
  if (!ai.ok) {
    const rawStatus = (ai as any).status ?? (ai as any).reason;
    const aiStatus: AuditAiStatus =
      rawStatus === 'key-expired'
        ? 'key-expired'
        : rawStatus === 'quota'
          ? 'quota'
          : rawStatus === 'timeout'
            ? 'timeout'
            : rawStatus === 'no-ai-key' || rawStatus === 'no-key'
              ? 'no-key'
              : 'provider-error';
    const aiReason =
      (ai as any).message ??
      ((ai as any).reason && !['no-ai-key', 'no-key', 'key-expired', 'quota', 'timeout'].includes((ai as any).reason)
        ? (ai as any).reason
        : undefined);
    const aiNote = aiStatusNoteText(aiStatus, aiReason);
    if (!notes.includes(aiNote)) notes.push(aiNote);
  }
  const run = { language, signal, ...(deps.aiTimeoutMs !== undefined ? { timeoutMs: deps.aiTimeoutMs } : {}) };
```

## Change

1. `assessment.ts`: add a callback to `AssessmentRunOptions`:

```ts
  /** Called for each AI request that failed at the provider, with its status and redacted message (ADR 0042). */
  onAiFailure?: (status: AuditAiStatus, error: string) => void;
```

Import `AuditAiStatus` from `@qa/types` if the file does not import it yet (it is used in `askSafely`'s return type, so it is normally imported already).

2. `assessment.ts`, `askSafely` catch: call it before returning.

```ts
    logAiFailure(ai.provider, err);
    run.onAiFailure?.(status, error);
    return { ok: false, reason: 'ai-failed', status, error };
```

3. `page-recommendation.ts`: add the same optional `onAiFailure?: (status: AuditAiStatus, error: string) => void;` field to the `RecommendPagesInput` interface, and in its `askSafely` catch add `run.onAiFailure?.(status, error);` before the `return`.

4. `pipeline.ts`: replace the whole `if (!ai.ok) { ... }` block and the `const run = ...` line shown above with:

```ts
  if (!ai.ok) {
    const aiNote = aiStatusNoteText('no-key');
    if (!notes.includes(aiNote)) notes.push(aiNote);
  }
  // The first provider failure of the audit is kept with its reason (ADR 0042).
  let aiFailure: { status: AuditAiStatus; error: string } | null = null;
  const run = {
    language,
    signal,
    ...(deps.aiTimeoutMs !== undefined ? { timeoutMs: deps.aiTimeoutMs } : {}),
    onAiFailure: (status: AuditAiStatus, error: string) => {
      if (!aiFailure) aiFailure = { status, error };
    },
  };
```

5. `pipeline.ts`: find this line (after the `assessSite` try/catch):

```ts
  record('assessment', 'assessing', assessed, assessed ? undefined : NOTES.assessment);
```

Replace it with:

```ts
  if (aiFailure) {
    const failed = aiFailure as { status: AuditAiStatus; error: string };
    const aiNote = aiStatusNoteText(failed.status, failed.error);
    if (!notes.includes(aiNote)) notes.push(aiNote);
    // Nothing came back at all: the step did not finish.
    const anyDone = pages.some((p) => p.areas?.some((a) => a.status === 'done')) || siteAreas.some((a) => a.status === 'done');
    if (!anyDone) assessed = false;
  }
  record('assessment', 'assessing', assessed, assessed ? undefined : NOTES.assessment);
```

6. `pipeline.ts`: find

```ts
    recommendations = await stages.recommendPages({ ...run, pages: recommendationInputs }, ai);
    record('recommendation', 'assessing', true);
```

Replace the `record` line with:

```ts
    const allByRule = recommendations.length > 0 && recommendations.every((r) => r.decidedBy === 'rule');
    const recommended = !(aiFailure && ai.ok && allByRule);
    record('recommendation', 'assessing', recommended, recommended ? undefined : NOTES.recommendation);
```

## Tests

`packages/core/tests/audit-pipeline.test.ts`:

- The existing tests near line 859 pass impossible values such as `ai: { ok: false as const, reason: 'key-expired' as const }` through `as any`. Delete those tests (the ones that only exist to feed `status` / `message` / a non-`'no-ai-key'` `reason` through `deps.ai`). Keep the test for `reason: 'no-ai-key'`, which must still expect the note `AI notes need an AI key.`
- Add `'a provider failure on every request writes the AI note and marks the steps not done'`. Copy the setup of the nearest test in the file that passes its own `stages`. Pass `stages.assessPages` as a stub that calls `input.onAiFailure?.('key-expired', 'HTTP 401')` and returns `[]`; `stages.assessSite` as a stub that returns six areas with `status: 'not-done', reason: 'ai-failed'`; `stages.recommendPages` as a stub that returns one `ruleRecommendation`-shaped entry per page with `decidedBy: 'rule'`; `deps.ai` as `{ ok: true, ai: <any fake AuditAi> }`. Expect `result.notes` to contain `The AI key expired. Update it in Audit settings.`, and the `assessment` and `recommendation` steps to have `status: 'not-done'`.

`packages/core/tests/audit-assessment.test.ts`: add `'reports a provider failure through onAiFailure'`. Copy the setup of `'no key: every area of every page and of the site is not-done no-ai-key, nothing created'` but pass an `ai` whose `ask` throws `new Error('Request failed (401)')` and an `onAiFailure` spy. Expect the spy to be called with `'key-expired'` and a string.

Run: `pnpm exec vitest run packages/core/tests/audit-pipeline.test.ts packages/core/tests/audit-assessment.test.ts packages/core/tests/audit-page-recommendation.test.ts`, then `pnpm build`.

## Done when

- [x] `pipeline.ts` has no `(ai as any)`.
- [x] A run where every AI request fails with 401 ends with the "key expired" note and both AI steps `not-done`.
- [x] `pnpm build` passes.

## Notes

- The existing `catch` branches around `assessPages` / `assessSite` stay: a custom stage may still throw.
- `aiStatusNoteText` already exists in `pipeline.ts`; do not change its wording.
- Out of scope: stopping later AI requests after a refused key (T-149).
