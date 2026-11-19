# T-392: The runner stays up after an unhandled rejection

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | reliability | todo |

**Files you may edit (no others):** `packages/runner/src/cli.ts`, `packages/runner/src/scheduler.ts`, `packages/runner/tests/cli-unhandled-rejection.test.ts` (new).

**Do not build in parallel with:** T-394, T-402 (runner chain).

## Problem

- `cli.ts:79-82`: `process.on('unhandledRejection', …) { void shutdown('Unhandled promise rejection', 1); }`. On the shared hosted copy, one visitor's stray rejection stops everyone's runs.
- `scheduler.ts:297` swallows every tick error with `.catch(() => {})`.

## Change

- **Unhandled rejection:** log the redacted message and count it. Shut down only after 5 rejections in 60 s.
- **Uncaught exception:** add a handler that logs and shuts down cleanly, since that state is not safe to continue.
- **`scheduler.ts`:** log tick failures with `redactedMessage`.

## Tests

- After one rejected promise, the server still answers `GET /api/runner/status` with 200.
- Five quick rejections shut it down.

## Done when

Both tests pass. The hosted log shows the rejection while the server keeps running.
