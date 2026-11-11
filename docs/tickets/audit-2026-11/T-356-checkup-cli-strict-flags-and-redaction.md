# T-356: The CI check-up refuses bad flags and hides more secret-looking text

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/checkup.ts`
- `packages/core/src/redact.ts`
- `packages/runner/tests/checkup-args.test.ts` (new)
- `packages/runner/tests/checkup-docs.test.ts`
- `packages/core/tests/redaction.test.ts`

**Do not build in parallel with:** T-355 (edits `checkup.ts`); T-316 (edits `redact.ts`); T-309, T-316 (all edit `redaction.test.ts`).

## Problem

`parseArgs` in `checkup.ts` accepts almost anything. In a CI workflow that means a typo gives a quietly different Check-up:

- `--max-pages abc` becomes 50 (`checkup.ts:172`, `:274`), `--concurrency 0` becomes 2 (`:201`), with no message.
- A bad `--header` says "QA_CUSTOM_HEADERS is not valid" (`:230-238`), which names a setting the person did not use.
- A flag's value can be taken as the address: the URL is the first argument that is not a flag and not in `flagValues` (`:274`), and the list of value flags in `flagValues` is hand-kept.
- Unknown flags are accepted, and there is no `--help`.

Also `redactIngest` (`checkup.ts:103-105`) hides only `password: value`. Spec documents are sent to the AI provider, and a document with `api_key = ...`, `secret: ...`, `token=...` or `Authorization: Bearer ...` goes out as written.

## Current code

Branch from `main`.

`grep -n "Number(flag\|Number(rawConcurrency\|QA_CUSTOM_HEADERS is not valid\|replace(/password" packages/runner/src/checkup.ts`:

```ts
  const maxPages = Number(flag('--max-pages') ?? env.QA_MAX_PAGES ?? 50);
  const crawlConcurrency = rawConcurrency ? Math.max(1, Math.min(5, Number(rawConcurrency) || 2)) : undefined;
  ...
  return text.replace(/password\s*[:=]\s*\S+/gi, '[hidden]');
```

`SECRET_PARAM_NAMES` (`packages/checkers/src/security.ts:6`) is the shared list of secret-looking names; `packages/core/src/redact.ts` already builds on it for URLs (`URL_SECRET_PARAM_NAMES`). The runner imports `@qa/core` but not `@qa/checkers`.

## Change

1. `core/src/redact.ts`: add and export `redactSecretText(text: string): string`. It hides the value in `name <: or => value` pairs when `name` is in `URL_SECRET_PARAM_NAMES` (also match with a quote or `-`/`_` around, case-insensitive), and `Bearer <token>` / `Authorization: <value>`. Replace the value with `REDACTED`. Keep it a pure function. It is exported by the existing `export * from './redact.js'`.
2. `checkup.ts`: `redactIngest` keeps its `[hidden]` marker for `password` pairs (the existing test pins it) and then runs `redactSecretText` over the result.
3. `checkup.ts` `parseArgs`:
   - One table of known flags with whether each takes a value: `--fail-on --provider --max-pages --output --test-cap --concurrency --delay --header --preset --health-path --expected-version` take a value; `--staging --confirm-live --help` do not; `--docs` takes many; `--debug` takes an optional value. Use it for `flagValues` instead of the hand-written list, and throw `Unknown option "<flag>". Run with --help.` for any other `--` argument.
   - `--max-pages`, `--concurrency`, `--test-cap`, `--delay` (flag or env): if given and not a whole number in range (max-pages 1..1000, concurrency 1..5, test-cap 1..100000, delay 0..2000), throw `--max-pages must be a whole number from 1 to 1000, not "abc"` (same shape for each). Unset still means the default.
   - `--header`: throw `--header must look like "Name: value"` for a bad `--header`; keep "QA_CUSTOM_HEADERS is not valid" only for the environment variable.
   - A flag that needs a value but is last or followed by another `--flag` throws `--max-pages needs a value`.
   - `--help` (and `-h`): `parseArgs` returns normally; `runCheckup`'s caller prints a short usage text built from the file header comment (flags and env names) and exits 0. Add a `help: true` field to `CheckupArgs` and handle it at the top of `runCheckup`.
4. Run `pnpm exec prettier --write` on the touched files, then `pnpm build` (core exported API changed).

## Tests

- New `packages/runner/tests/checkup-args.test.ts` (unit): `--max-pages abc`, `--concurrency 0`, `--concurrency 9`, `--delay x` each throw with the flag named; valid values still parse; an unknown flag throws; `--header "bad"` throws a `--header` message and not the env message; `--max-pages` as the last argument throws "needs a value"; `--help` sets `help: true`; a URL placed after a value flag is still found as the address.
- `checkup-docs.test.ts`: `redactIngest('api_key = abc123 and Authorization: Bearer xyz.abc')` hides both values; the existing `password` case is unchanged.
- `core/tests/redaction.test.ts`: table for `redactSecretText`: `secret: x`, `"token":"x"`, `client_secret=x`, `Bearer abc.def`, and ordinary text such as `the key idea` or `monkey: banana` is not changed.

Run: `pnpm exec vitest run packages/runner/tests/checkup-args.test.ts packages/runner/tests/checkup-docs.test.ts packages/core/tests/redaction.test.ts`, then the runner and core unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "Unknown option" packages/runner/src/checkup.ts` finds the refusal.
- [ ] `grep -n "export function redactSecretText" packages/core/src/redact.ts` finds the helper, and `redactIngest` calls it.
- [ ] The tests above pass; `pnpm build` passes.

## Notes

- Audit finding L10 (audit of 11 Nov 2026 on `d225418`).
- Builds after T-355 (same file `checkup.ts`).
- The generated workflow (`packages/wizard/src/lib/workflow.ts`, T-376) passes flags by name: check `grep -n "checkup" templates/qa-check.yml .github/workflows/qa-check.yml` still use only known flags before merging.
