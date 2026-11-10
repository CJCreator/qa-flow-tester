# T-201: Website Audit API helpers: one "not answering" message and one error-code check

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | wizard | inconsistency | blocked |

**Files you may edit (no others):**
- `packages/wizard/src/screens/audit/audit-call.ts` (new)
- `packages/wizard/src/screens/audit/ai/rewrite-api.ts`
- `packages/wizard/src/screens/audit/ai/stage-models-api.ts`
- `packages/wizard/src/screens/audit/documents/export-api.ts`
- `packages/wizard/src/screens/audit/documents/review-api.ts`
- `packages/wizard/src/screens/audit/documents/settings-api.ts`
- `packages/wizard/src/screens/audit/results/analysis-client.ts`
- `packages/wizard/src/screens/audit/saved/helper-api.ts`
- `packages/wizard/src/screens/audit/saved/saved-api.ts`
- `packages/wizard/src/screens/audit/saved/share-api.ts`
- `packages/wizard/src/screens/audit/start/audit-start-api.ts`
- `packages/wizard/tests/audit-call.test.ts` (new)

**Do not build in parallel with:** T-189 (edits `audit-start-api.ts`, `export-api.ts`), T-197 (edits `saved-api.ts`, `share-api.ts`). Build after both.

## Problem

Ten Website Audit API modules each declare their own `NOT_ANSWERING` text, and nine each declare an identical `isAuditErrorCode`. The text has drifted into two wordings:

- seven files: `'The tool is not answering. Check your connection and that the tool is still running, then try again.'`
- three files (`analysis-client.ts:22`, `saved-api.ts:52`, `audit-start-api.ts:20`): `'The tool is not answering. Make sure it is still open in its terminal, then try again.'`

The second wording is wrong on the hosted copy, where there is no terminal. The same failure reads differently depending on the screen.

## Current code

Every file listed holds this constant (branch `worktree-audit-cleanup`):

| File | `NOT_ANSWERING` at line | `isAuditErrorCode` at line |
|---|---|---|
| `ai/rewrite-api.ts` | 24-25 (`export const`) | 39-41 |
| `ai/stage-models-api.ts` | 101-102 | 109-111 |
| `documents/export-api.ts` | 110-111 | none |
| `documents/review-api.ts` | 25-26 | 34-36 |
| `documents/settings-api.ts` | 139-140 | 146-148 |
| `results/analysis-client.ts` | 22 | 37-39 |
| `saved/helper-api.ts` | 40-41 | 64-66 |
| `saved/saved-api.ts` | 52 | 65-67 |
| `saved/share-api.ts` | 29-30 | 61-63 |
| `start/audit-start-api.ts` | 20 | 40-42 |

The nine `isAuditErrorCode` copies are byte-identical:

```ts
function isAuditErrorCode(value: unknown): value is AuditErrorCode {
  return typeof value === 'string' && (AUDIT_ERROR_CODES as readonly string[]).includes(value);
}
```

No file imports `NOT_ANSWERING` from another (checked with grep), although `rewrite-api.ts` exports it.

## Change

1. Create `packages/wizard/src/screens/audit/audit-call.ts`:

```ts
import { AUDIT_ERROR_CODES, type AuditErrorCode } from '@qa/types/src/browser.js';

/** Shown when a request got no answer at all. One wording for every Website Audit screen. */
export const NOT_ANSWERING =
  'The tool is not answering. Check your connection and that the tool is still running, then try again.';

/** True for a code the runner's Website Audit routes can return. */
export function isAuditErrorCode(value: unknown): value is AuditErrorCode {
  return typeof value === 'string' && (AUDIT_ERROR_CODES as readonly string[]).includes(value);
}
```

2. In each of the ten files:
   - delete the local `NOT_ANSWERING` declaration (one or two lines, see the table);
   - delete the local `isAuditErrorCode` function (three lines) where the table lists one;
   - add an import of what the file still uses. For files under `ai/`, `documents/`, `results/`, `saved/`, `start/` the path is `'../audit-call'`:

```ts
import { isAuditErrorCode, NOT_ANSWERING } from '../audit-call';
```

     For `documents/export-api.ts` import only `NOT_ANSWERING`.
   - `ai/rewrite-api.ts` exported `NOT_ANSWERING`. Keep that working with a re-export line: `export { NOT_ANSWERING } from '../audit-call';` in addition to the import.
3. After the deletions, a file may no longer use `AUDIT_ERROR_CODES` (it was only used by `isAuditErrorCode`). Remove `AUDIT_ERROR_CODES` from that file's `@qa/types/src/browser.js` import. Keep `type AuditErrorCode`: every file still uses it in its outcome type.
4. Do not touch any `call(...)` function, `REFUSALS` table or other text.

## Tests

New file `packages/wizard/tests/audit-call.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAuditErrorCode, NOT_ANSWERING } from '../src/screens/audit/audit-call';

const AUDIT = resolve(__dirname, '../src/screens/audit');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('shared Website Audit API helpers', () => {
  it('knows a runner code from other text', () => {
    expect(isAuditErrorCode('ERR_AUDIT_NOT_FOUND')).toBe(true);
    expect(isAuditErrorCode('nope')).toBe(false);
    expect(isAuditErrorCode(404)).toBe(false);
  });
  it('does not mention a terminal: the hosted copy has none', () => {
    expect(NOT_ANSWERING).toMatch(/not answering/);
    expect(NOT_ANSWERING).not.toMatch(/terminal/);
  });
  it('is declared once', () => {
    const declaring = files(AUDIT).filter((f) => /const NOT_ANSWERING\s*=/.test(readFileSync(f, 'utf8')));
    expect(declaring.map((f) => f.replace(/\\/g, '/').split('/screens/audit/')[1])).toEqual(['audit-call.ts']);
    const checks = files(AUDIT).filter((f) => /function isAuditErrorCode/.test(readFileSync(f, 'utf8')));
    expect(checks).toHaveLength(1);
  });
});
```

Run all audit tests, since ten modules change:
`pnpm exec vitest run packages/wizard/tests/audit-call.test.ts packages/wizard/tests/audit-saved.test.tsx packages/wizard/tests/audit-preview-share.test.tsx packages/wizard/tests/audit-helpers.test.tsx packages/wizard/tests/audit-documents-export.test.tsx packages/wizard/tests/audit-documents-review.test.tsx packages/wizard/tests/audit-document-settings.test.tsx packages/wizard/tests/audit-rewrite-review.test.tsx packages/wizard/tests/audit-ai-models-panel.test.tsx packages/wizard/tests/audit-analysis-screen.test.tsx packages/wizard/tests/audit-start-screen.test.tsx`
then `pnpm build` and `pnpm lint` (0 errors).

## Done when

- [ ] `NOT_ANSWERING` and `isAuditErrorCode` are each declared once, in `audit-call.ts`.
- [ ] No Website Audit screen says "open in its terminal".
- [ ] All listed tests, `pnpm build` and `pnpm lint` pass.

## Notes

- Existing tests match `/not answering/` or `'The tool is not answering'`, so the unified wording passes them. `audit-analysis-screen.test.tsx:308` uses the terminal wording only as sample data passed into a view; leave it.
- Out of scope: merging the differing `call(...)` functions, `REFUSALS` tables and the two `languageName` functions. Their signatures differ per module.

- BLOCKED (wizard agent): `packages/wizard/tests/audit-analysis-screen.test.tsx:306-308` expects the old terminal sentence ("Make sure it is still open in its terminal") with `toEqual`. That file is not in this ticket's file list, so the test cannot be updated here. Its line `expected ... to deeply equal ...` fails once the shared `NOT_ANSWERING` is adopted. Unblock by adding that test file to the list (or updating its expected sentence), then rebuild this ticket.
