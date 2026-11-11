# T-270: Remove the `dev` script that repeats `dev:wizard`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | config | duplication | todo |

**Files you may edit (no others):**

- `package.json`

**Do not build in parallel with:** T-229 (also edits `package.json`), T-271 and T-278 (they run `pnpm install`, which can rewrite the lock file against `package.json`). Build this one before them.

## Problem

`package.json` has two scripts that run the same command, `pnpm --filter @qa/wizard dev`. Every document names `dev:wizard` (`CLAUDE.md`, `README.md`, `docs/CONFIGURATION.md`). Nothing names `dev`. Two names for one command can drift.

## Current code

Branch from `main`. Find it with `grep -n '"dev' package.json`.

`package.json` (scripts):

```json
    "dev": "pnpm --filter @qa/wizard dev",
    "dev:wizard": "pnpm --filter @qa/wizard dev",
```

Check that nothing uses the short name: `grep -rnE "pnpm (run )?dev( |$|\`)" . --include=_.md --include=_.mjs --include=_.json --include=_.yml --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=tickets` must print nothing. (`pnpm dev:wizard` is fine and does not match.)

## Change

1. In `package.json`, delete the line `"dev": "pnpm --filter @qa/wizard dev",`. Keep `"dev:wizard"`.
2. Do not touch any other line. Do not run `pnpm install`.

## Tests

`pnpm exec vitest run packages/runner/tests/config-docs.test.ts` (it reads `package.json` and checks that every `pnpm <script>` named in the docs exists).

## Done when

- [ ] `grep -c '"dev":' package.json` prints 0, and `grep -c '"dev:wizard":' package.json` prints 1.
- [ ] `config-docs.test.ts` passes.

## Notes

- Not in this ticket: the `tsx` dev dependency. It looks unused but `packages/runner/tests/cli-bind-host.test.ts` runs `node --import tsx`, so it stays.
