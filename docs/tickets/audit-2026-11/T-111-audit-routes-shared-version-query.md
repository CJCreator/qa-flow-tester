# T-111: One `versionQuery` for the Website Audit routes

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | inconsistency | built |

**Files you may edit (no others):**
- `packages/runner/src/routes/audit-common.ts` (new)
- `packages/runner/src/routes/audit-crawl.ts`
- `packages/runner/src/routes/audit-store.ts`
- `packages/runner/src/routes/audit-content.ts`
- `packages/runner/src/routes/audit-documents.ts`
- `packages/runner/src/routes/audit-preview.ts`

**Do not build in parallel with:** T-95, T-109 (edit `audit-crawl.ts`).

## Problem

Five Website Audit route modules each define the same `versionQuery` function (it reads `?version=` from the address). The five copies behave the same today but are written three different ways, so they can drift.

## Current code

Branch `worktree-audit-cleanup`. Find each with `grep -n "^function versionQuery" packages/runner/src/routes/*.ts`.

`routes/audit-crawl.ts`:

```ts
function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  return /^[1-9][0-9]{0,6}$/.test(raw) ? Number(raw) : 'invalid';
}
```

`routes/audit-store.ts` and `routes/audit-documents.ts`:

```ts
function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  if (!/^[1-9][0-9]{0,6}$/.test(raw)) return 'invalid';
  return Number(raw);
}
```

`routes/audit-content.ts` and `routes/audit-preview.ts` (each also has `const VERSION = /^[1-9][0-9]{0,6}$/;`):

```ts
function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  return VERSION.test(raw) ? Number(raw) : 'invalid';
}
```

## Change

1. Create `packages/runner/src/routes/audit-common.ts`:

```ts
/** Helpers shared by the Website Audit route modules. */

const VERSION = /^[1-9][0-9]{0,6}$/;

/**
 * The `?version=` of a Website Audit request: the number, undefined when the query has none (the caller
 * then uses the latest version), or 'invalid' for anything that is not a whole number from 1.
 */
export function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  return VERSION.test(raw) ? Number(raw) : 'invalid';
}
```

2. In each of the five route files: delete the local `versionQuery` function (with any comment directly above it) and add `import { versionQuery } from './audit-common.js';` with the other relative imports.

3. In `audit-content.ts` and `audit-preview.ts`: after step 2, check whether `VERSION` is still used in the file: `grep -n "VERSION\b" packages/runner/src/routes/audit-content.ts packages/runner/src/routes/audit-preview.ts`. Delete the `const VERSION = ...` line only in a file where no other line uses it. (`MAX_PREVIEW_BODY_CHARS` and other names containing "VERSION" do not count; match the whole word.)

4. Run `pnpm exec prettier --write packages/runner/src/routes/audit-common.ts` and `pnpm build`.

## Tests

Add `packages/runner/tests/audit-common.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { versionQuery } from '../src/routes/audit-common.js';

const at = (query: string) => new URL(`http://localhost/api/audits/audit_00001${query}`);

describe('versionQuery', () => {
  it('is undefined without a version', () => {
    expect(versionQuery(at(''))).toBeUndefined();
  });
  it('reads a whole number from 1', () => {
    expect(versionQuery(at('?version=1'))).toBe(1);
    expect(versionQuery(at('?version=1234567'))).toBe(1234567);
  });
  it("is 'invalid' for anything else", () => {
    for (const bad of ['0', '01', '-1', '1.5', 'abc', '', '12345678']) {
      expect(versionQuery(at(`?version=${bad}`)), bad).toBe('invalid');
    }
  });
});
```

Run: `pnpm exec vitest run packages/runner/tests/audit-common.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -c "^function versionQuery" packages/runner/src/routes/*.ts` shows 0 for every file.
- [ ] The new test passes; the runner unit tests and `pnpm build` pass.

## Notes

- The new test file needs no entry in `vitest.workspace.ts`: files not listed in `BROWSER_TESTS` are unit tests.
- Not in this ticket: `refuseStoreFailure` (four copies with different messages), `pitchScreenshots`, the stored-settings loader and the `'edits'` key. Their copies differ in wording, so merging them changes replies and needs an owner review.
