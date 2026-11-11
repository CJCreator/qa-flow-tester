# T-233: delete the two check-up API reply types that only a test uses

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | types | dead-code | todo |

**Files you may edit (no others):**

- `packages/types/src/checkup-api.ts`
- `packages/types/tests/checkup-api.test.ts`

**Do not build in parallel with:** nothing.

## Problem

`RunStartReply` and `ApprovalReply` in `checkup-api.ts` are used by nothing in the runner or the wizard. Only one test line reads them. T-180 kept them on purpose, but the owner's standing rule for unused items is to delete them. The file header also says both ends of the API import these shapes, which is not true for these two.

Checked on the current tree: `grep -rn "RunStartReply\|ApprovalReply" packages docs` finds only the two definitions and `packages/types/tests/checkup-api.test.ts`.

## Current code

Find them with `grep -n "RunStartReply\|ApprovalReply" packages/types/src/checkup-api.ts packages/types/tests/checkup-api.test.ts`.

`packages/types/src/checkup-api.ts`:

```ts
/**
 * `POST /api/runner/run` reply (202). The run's progress and completion travel over the SSE stream, so
 * the id is the whole answer.
 */
export interface RunStartReply {
  runId: string;
}
```

```ts
/**
 * `POST /api/runner/plan/approve` reply on success: the Plan is approved and its run has started. Approval
 * refusals carry an error and a `code` instead (409 ERR_DUPLICATE_APPROVAL / ERR_PLAN_UPDATING, 404).
 */
export interface ApprovalReply {
  status: 'approved';
  runId: string;
}
```

The header comment (top of the file):

```ts
 * Pure, browser-safe module, and types only on purpose: the wizard bundles @qa/types from source, so a value
 * or an import of a Node built-in here would enter the wizard's bundle. Both ends of the check-up API import
 * these shapes instead of carrying a copy, so a field cannot disappear on one side unnoticed.
```

`packages/types/tests/checkup-api.test.ts`, the import list:

```ts
import type {
  ApprovalReply,
  PlanPatchBody,
  RunnerStatusReply,
  RunStartBody,
  RunStartReply,
} from '../src/checkup-api.js';
```

and the last test in the file:

```ts
it('RunStartReply and ApprovalReply carry what their success branches write', () => {
  const started = { runId: 'run-1' } satisfies RunStartReply;
  const approved = { status: 'approved', runId: 'run-1' } satisfies ApprovalReply;

  expectTypeOf(started).toMatchTypeOf<RunStartReply>();
  expectTypeOf(approved).toMatchTypeOf<ApprovalReply>();
  expectTypeOf<ApprovalReply['status']>().toEqualTypeOf<'approved'>();
});
```

## Change

1. In `checkup-api.ts`: delete the `RunStartReply` interface with the doc comment above it, and the blank line after it. Delete the `ApprovalReply` interface with its doc comment, and the blank line before it, so the file ends right after the `RunnerStatusReply` interface's closing brace.

2. In the header comment, replace the sentence "Both ends of the check-up API import these shapes instead of carrying a copy, so a field cannot disappear on one side unnoticed." with "The wizard imports the request and status shapes below instead of carrying a copy, so a field cannot disappear on one side unnoticed."

3. In `checkup-api.test.ts`: change the import to

```ts
import type { PlanPatchBody, RunnerStatusReply, RunStartBody } from '../src/checkup-api.js';
```

and delete the whole `it('RunStartReply and ApprovalReply carry ...', ...)` test (including its closing `});`). Keep the closing `});` of the `describe`.

4. Run `pnpm exec prettier --write packages/types/src/checkup-api.ts packages/types/tests/checkup-api.test.ts`.

## Tests

No new test. Run:

- `pnpm exec vitest run packages/types/tests/checkup-api.test.ts`
- `pnpm build` and `pnpm typecheck`

## Done when

- [ ] `grep -rn "RunStartReply\|ApprovalReply" packages` finds nothing.
- [ ] `checkup-api.test.ts` passes (the other tests in it are unchanged), `pnpm build` and `pnpm typecheck` pass.

## Notes

- Keep `RunStartBody`, `PlanPatchBody`, `RunnerStatusReply` and `AiKeySource`: the runner and the wizard import them.
- `docs/API.md` does not name the two deleted types, so no doc change is needed (checked with the grep above).
- This module is imported by the wizard: no Node built-ins.
