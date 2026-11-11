# T-378: Promise lint rules are errors, and lint fails above the current warning count

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | config | gap | todo |

**Files you may edit (no others):**

- `eslint.config.mjs`
- `package.json`
- The source files under `packages/*/src/` that `pnpm lint` reports for the two promise rules (see Change, step 1). Do not edit any other file.

**Do not build in parallel with:** T-272 (edits `eslint.config.mjs`); T-229, T-270, T-380 (all edit `package.json`); and any ticket that runs `pnpm install` or edits a `package.json`.

## Problem

A promise that is started and never awaited, or an `async` function handed to something that ignores its result, loses its error. In a server that runs one Check-up at a time, that means an unhandled rejection can crash the process or a failure can vanish. ESLint has two rules for this, and both are set to `warn` (`eslint.config.mjs:86-87`). The last lint run (11 Nov 2026) printed 129 warnings, of which 24 are `no-misused-promises` and 1 is `no-floating-promises`. Nobody reads 129 warnings, so nothing stops a new one.

`"lint": "eslint ."` (`package.json:27`) has no `--max-warnings`, so the count can grow without any check failing. CI and Deploy both run `pnpm lint`.

## Current code

Branch from `main`. `grep -n "no-floating-promises\|no-misused-promises" eslint.config.mjs`.

`eslint.config.mjs` (last config object, applies to `packages/*/src/**/*.{ts,tsx}`):

```js
    rules: {
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
    },
```

`package.json`:

```json
    "lint": "eslint .",
```

## Change

1. List the hits first. Run `pnpm exec eslint . --format unix 2>&1 | grep "no-floating-promises\|no-misused-promises"`. Expect 25 lines (24 and 1). Write the file names into the ticket's Files list before you start (replace the placeholder line above). If the count is not 25, use the real count.
2. Fix each hit. Do not silence with `eslint-disable`. The usual fixes:
   - A floating promise that may fail and is meant to run in the background: `void promise.catch((err) => log(...))`, using the file's existing logging helper. Never a bare `void` on something that can reject.
   - A floating promise whose result matters: `await` it.
   - `no-misused-promises` on an `async` callback passed to `setInterval`, `setTimeout`, an event emitter's `.on(...)` or an HTTP request handler: wrap it as `() => { void handler().catch(...) }`, or catch inside the `async` function so it can not reject.
   - `no-misused-promises` on an `async` function used where a `void` return is expected, with a condition test (`if (somePromise)`): `await` it before the test.
   Do not change behaviour. If a fix would change what a route answers or when a run stops, stop and leave a note in the ticket instead.
3. `eslint.config.mjs`: change both rules to `'error'`. Update nothing else in the file.
4. `package.json`: change the script to `"lint": "eslint . --max-warnings <N>"`, where `<N>` is the warning count that `pnpm lint` prints after steps 2 and 3. Expected: 104 (129 minus the 25 fixed). Use the number lint prints, not a guess. This is a ratchet: lower it whenever warnings are removed, never raise it.
5. Run `pnpm exec prettier --write` on every file you changed, then `pnpm build`.

## Tests

No new test file. The check is the lint run itself. If a fix changes code that has a unit test, run that test:

- `pnpm lint` exits 0 and prints the same warning count as `<N>`.
- `pnpm exec vitest run --project unit` for every package whose source you changed.
- `pnpm build`.

## Done when

- [ ] `grep -n "promises'" eslint.config.mjs` shows both rules as `'error'`.
- [ ] `grep -n '"lint"' package.json` shows `--max-warnings` with the real count.
- [ ] `pnpm lint` exits 0; adding a throwaway `async` call without `await` in a source file makes it exit 1 (remove it again).
- [ ] No new `eslint-disable` comment: `git diff | grep "^+.*eslint-disable"` prints nothing.
- [ ] The unit tests of the changed packages pass; `pnpm build` passes.

## Notes

- Audit finding M14 (audit of 11 Nov 2026 on `d225418`). The brief said `--max-warnings 129`; that was the count before the 25 promise hits become errors and are fixed, so the ratchet is set to what is left.
- Out of scope: `noUncheckedIndexedAccess` in `tsconfig.base.json`. It would flag hundreds of array reads and is too wide for one ticket; open a separate ticket per package if wanted.
- T-272 edits `eslint.config.mjs` (the ignore list): build this after it. Tickets that edit the same source files (for example T-240, T-256) should be built first or merged by hand, since step 2 touches files across `packages/*/src`.
