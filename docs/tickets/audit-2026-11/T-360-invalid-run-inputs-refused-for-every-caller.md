# T-360: Invalid run inputs are refused for every caller, not dropped

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/session/checkup-run.ts`
- `packages/runner/tests/checkup-run-invalid-inputs.test.ts` (new)

**Do not build in parallel with:** T-296, T-308, T-312, T-313, T-331, T-355, T-358 (all edit `checkup-run.ts`).

## Problem

`createCheckupRun(...).start()` takes a `RunStartBody` and checks several inputs with the helpers in `run-inputs.ts`, but when a check fails it quietly uses "no value" instead of refusing:

- `aiCap`: `aiCap.ok ? aiCap.value : undefined` (`session/checkup-run.ts:699`, `:716`). A bad cap becomes no cap: the spending limit is gone.
- `customHeaders`: `customHeadersChecked.ok ? ... : undefined` (`:1048`, `:1054`). The headers are dropped and the Check-up runs without its bypass header.
- `savedSessions`: the result of `checkSavedSessions(...)` is used only `if (sessions.ok && ...)` (`:1049-1050`).
- `contextDocuments` and `contextUrl`: `checkedDocs.ok && ...` and `docsUrl.ok && ...` (`:778-781`) drop the Product Context.

Today this is safe for the web route, because `handleTriggerRun` validates all of them first and answers 400 (`server.ts:3154-3162`). The other two callers skip that: the command-line Check-up (`checkup.ts:520`) and the scheduler (`server.ts:1448`, `runSchedule`). The scheduler body carries none of these fields today (latent), but the CLI passes `customHeaders` straight from its flags and environment, and checks them only with its own parser, so a header the runner rejects is dropped without a word. Any new caller inherits the same gap.

## Current code

Branch from `main`.

`grep -n "\.ok ?\|\.ok &&" packages/runner/src/session/checkup-run.ts`:

```ts
        aiCap: aiCap.ok ? aiCap.value : undefined,
        headers: customHeadersChecked.ok ? customHeadersChecked.value : undefined,
      if (checkedDocs.ok && checkedDocs.value) documents.push(...checkedDocs.value);
```

`packages/runner/src/run-inputs.ts:18-29`: `InputProblem { error, code }` and `Checked<T> = { ok: true; value } | { ok: false; problem }`.

## Change

1. In `checkup-run.ts` add one helper near `runBusy`:

```ts
/** A refused input: the same error and code the web route answers with, as a 400. */
const inputRefused = (problem: InputProblem) =>
  Object.assign(new Error(problem.error), { code: problem.code, status: 400 });
```

   and import `type InputProblem` (and the checkers already imported).
2. At the top of `start()`, after the busy check and before `starting = true`, run `checkContextDocuments`, `checkContextUrl`, `checkAiCap`, `checkCustomHeaders` and `checkSavedSessions(body.savedSessions, hostnameOf(body.targetUrl))` and `throw inputRefused(checked.problem)` on the first `!ok`. Nothing has been claimed yet, so there is nothing to undo.
3. At the four use sites keep the checked values but make a `!ok` impossible to ignore: replace `x.ok ? x.value : undefined` with a small `valueOf(checked)` that returns the value or throws `inputRefused(problem)`. (They stay as a second line of defence for the paths that reach `executeRun` without `start()`.)
4. Do not change the web route: it still answers 400 first. `server.ts` is not in this ticket; its `500` branch for other errors stays (it is not reached for these codes).
5. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

New file `packages/runner/tests/checkup-run-invalid-inputs.test.ts` (unit tier; start the run with an injected `prepareAI` like `checkup-run-teardown.test.ts`, so no browser launches):

- `aiCap: { dollars: -1 }` (or whatever `checkAiCap` refuses: read its cases in `run-inputs.ts:75-96`) makes `start()` reject with `status: 400` and a `code`; `session.run.isRunning` is false afterwards and no run folder was made.
- A bad `customHeaders` (a header name with a space) rejects the same way. The refusal text does not repeat the header value.
- A bad `savedSessions` value rejects.
- A valid body still starts (the existing teardown test shows how).
- A refused start does not leave `starting` set: a second, valid `start()` right after succeeds.

Run: `pnpm exec vitest run packages/runner/tests/checkup-run-invalid-inputs.test.ts packages/runner/tests/checkup-run-teardown.test.ts`, then the runner unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "\.ok ? .*: undefined" packages/runner/src/session/checkup-run.ts` finds nothing.
- [ ] `grep -n "inputRefused" packages/runner/src/session/checkup-run.ts` finds the helper and its uses.
- [ ] The tests above pass; `pnpm build` passes.

## Notes

- Audit finding M36 (audit of 11 Nov 2026 on `d225418`). Suspected part confirmed as to routes: the web route validates first (`server.ts:3154-3162`), so the live exposure is the CLI and any future caller, not the browser path.
- T-355 and T-358 also edit `checkup-run.ts`: build them one after another.
- T-356 makes the CLI refuse bad flags itself; this ticket is the second line of defence inside the run.
