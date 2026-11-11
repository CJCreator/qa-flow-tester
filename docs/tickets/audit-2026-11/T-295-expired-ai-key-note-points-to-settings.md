# T-295: The expired AI key note points to Settings

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | inconsistency | todo |

**Files you may edit (no others):**

- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/tests/audit-pipeline.test.ts`

**Do not build in parallel with:** any other ticket that edits `packages/core/src/audit/pipeline/pipeline.ts`. Build after T-289.

## Problem

When the AI key has expired, the Website Audit's note says "Update it in Audit settings." The Audit settings page holds only the PageSpeed key. The AI key is set in Settings. T-289 fixes the wizard's link and status chip to say "Settings"; this sentence comes from core and still names the wrong page.

## Current code

Branch from `main`. `packages/core/src/audit/pipeline/pipeline.ts`, in `aiStatusNoteText`:

```ts
if (status === 'key-expired') return 'The AI key expired. Update it in Audit settings.';
```

`packages/core/tests/audit-pipeline.test.ts` (find with `grep -n "Update it in Audit settings" packages/core/tests/audit-pipeline.test.ts`):

```ts
expect(result.notes).toContain('The AI key expired. Update it in Audit settings.');
```

## Change

1. In `pipeline.ts`, change the sentence to `'The AI key expired. Update it in Settings.'`.
2. In `audit-pipeline.test.ts`, change the expected sentence the same way.
3. Run `grep -rn "Update it in Audit settings" packages/`. A hit in `packages/wizard/tests/audit-analysis-summary.test.tsx` is fixture text that T-289 owns: leave it and name it in your notes. Any other hit under `packages/*/src`: stop and set `blocked`.

## Tests

`pnpm exec vitest run packages/core/tests/audit-pipeline.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -rn "Update it in Audit settings" packages/core` prints nothing.
- [ ] The test file and `pnpm build` pass.

## Notes

- Stored Website Audits keep the old sentence in their saved notes. That is expected; do not migrate stored data.
