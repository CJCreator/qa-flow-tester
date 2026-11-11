# T-286: Wizard: delete `buildProductContext` and `hasNonDefaultOptions` and their tests

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | wizard | dead-code | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/context.ts`
- `packages/wizard/src/lib/onboarding.ts`
- `packages/wizard/tests/context-url-summary.test.ts`
- `packages/wizard/tests/onboarding.test.ts`
- `packages/wizard/tests/intent-view.test.ts`

**Do not build in parallel with:** T-164 and T-198 (they only run `context-url-summary.test.ts` and `intent-view.test.ts`; build this one first).

## Problem

Two exported helpers are used by tests only:

- `buildProductContext` in `lib/context.ts`: no `src` file imports it (grep over `packages/`: `context.ts` and `tests/context-url-summary.test.ts` only). The New check-up screen builds the Product Context another way (`productContextOf` in `lib/form.ts`).
- `hasNonDefaultOptions` in `lib/onboarding.ts`: no `src` file imports it (`onboarding.ts`, `tests/onboarding.test.ts`, `tests/intent-view.test.ts` only). `App.tsx` imports only `hasFinishedCheckup` from that module.

The owner's standing rule for unused code is "delete everything", including its tests.

## Current code

Find with `grep -n "buildProductContext\|hasNonDefaultOptions" -r packages/wizard/src packages/wizard/tests`.

`packages/wizard/src/lib/context.ts` (about lines 56 to 68): the doc comment starting `/** Joins every file and the pasted notes into one Product Context document.` and the function:

```ts
export function buildProductContext(files: ReferenceFile[], pasted: string): string | undefined {
  const parts = files
    .filter((f) => f.content.trim())
    .map((f) => `# Reference file: ${f.name}\n\n${f.content.trim()}\n`);
  if (pasted.trim()) parts.push(`# Pasted notes\n\n${pasted.trim()}\n`);
  return parts.length > 0 ? parts.join('\n') : undefined;
}
```

`packages/wizard/src/lib/onboarding.ts` (29 lines): imports `RunSummary` from `@qa/types` and `{ DEFAULT_MAX_PAGES, type CheckupForm } from './form'`; then `hasNonDefaultOptions(form: CheckupForm)` with its doc comment; then `hasFinishedCheckup` (keep this one).

`packages/wizard/tests/context-url-summary.test.ts`: line 4 `import { buildProductContext, rejectReason } from '../src/lib/context';`; inside `describe('reference materials'` three tests: `rejects non-text files ...` (keep), `returns nothing to send when no files or notes were added` and `joins several files so the context parser still finds requirements from each one` (delete both).

`packages/wizard/tests/onboarding.test.ts`: first `describe('More options on the new check-up screen'` (delete) and `describe('developer shortcuts for first-time visitors'` (keep).

`packages/wizard/tests/intent-view.test.ts`: line 14 `import { hasNonDefaultOptions } from '../src/lib/onboarding';` and, last line of the test `reads the Test cap from the form ...`: `expect(hasNonDefaultOptions({ ...EMPTY_FORM, testCap: '10' })).toBe(true);`.

## Change

1. `context.ts`: delete the doc comment and the whole `buildProductContext` function (and one blank line). Do not touch `ReferenceFile` or the rest.
2. `onboarding.ts`: delete the doc comment and `hasNonDefaultOptions`, and delete the line `import { DEFAULT_MAX_PAGES, type CheckupForm } from './form';`. The file keeps `import type { RunSummary } from '@qa/types';` and `hasFinishedCheckup`. (`DEFAULT_MAX_PAGES` is still used in `form.ts`, `App.tsx` and a test; leave it exported.)
3. `context-url-summary.test.ts`: change the import to `import { rejectReason } from '../src/lib/context';` and delete the two tests named above. Keep `ContextParser` (used further down in the file).
4. `onboarding.test.ts`: replace the whole file with:

```ts
import { describe, it, expect } from 'vitest';
import type { RunSummary } from '@qa/types';
import { hasFinishedCheckup } from '../src/lib/onboarding';

describe('developer shortcuts for first-time visitors', () => {
  it('hasFinishedCheckup is false for null and []', () => {
    expect(hasFinishedCheckup(null)).toBe(false);
    expect(hasFinishedCheckup(undefined)).toBe(false);
    expect(hasFinishedCheckup([])).toBe(false);
  });
  it('is true once there is one past check-up', () => {
    expect(hasFinishedCheckup([{ runId: 'r1', host: 'example.com' } as unknown as RunSummary])).toBe(true);
  });
});
```

5. `intent-view.test.ts`: delete line 14 (the import) and the single `hasNonDefaultOptions` expectation line. `EMPTY_FORM` is still used by the line above it; keep its import.
6. Run `pnpm exec prettier --write` on the five files.

## Tests

No new test. Run:

`pnpm exec vitest run packages/wizard/tests/context-url-summary.test.ts packages/wizard/tests/onboarding.test.ts packages/wizard/tests/intent-view.test.ts packages/wizard/tests/context-files.test.ts`

Then `pnpm build`.

## Done when

- [ ] `grep -rn "buildProductContext\|hasNonDefaultOptions" packages --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist` prints nothing.
- [ ] `hasFinishedCheckup` is still exported and `App.tsx` still builds.
- [ ] The four test files and `pnpm build` pass.

## Notes

- Out of scope: the plan-translate functions (T-285).
- Do not change `productContextOf` or `splitStoredContext`.
