# T-354: The schedule store refuses an unreadable file, and a scheduler tick logs its errors

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/scheduler.ts`
- `packages/runner/tests/scheduler-store.test.ts`
- `packages/runner/tests/scheduler.test.ts`

**Do not build in parallel with:** none.

## Problem

The `ScheduleStore` interface says it plainly: "A failed read must throw: an empty list would be saved over the real one" (`scheduler.ts:31`). The local `FileScheduleStore.read()` does the opposite: `catch { return []; }` for every error (`scheduler.ts:59-67`). A schedule file that is briefly unreadable (a permission error, a half-written file, bad JSON) reads as "no schedules". The next add, pause, delete or claim (`addSchedule`, `toggleSchedule`, `tick`) then saves a list with only the new entry over the real file. The owner's schedules are gone.

Second, `tick()` ends in `catch { // scheduler tick error resilience ... }` (`scheduler.ts:253-255`), and `start()` runs it as `void this.tick(...)` (`scheduler.ts:263`). A failed store read, or a failed save, is swallowed with no log and no trace in `TickSummary`, so nobody learns that schedules stopped running.

## Current code

Branch from `main`.

`grep -n "catch" packages/runner/src/scheduler.ts`:

```ts
    } catch {
      return [];
    }
```

and in `tick()`:

```ts
    } catch {
      // scheduler tick error resilience: a failed store read stops the tick and saves nothing
    } finally {
```

`packages/runner/tests/scheduler-store.test.ts` has an existing case "a missing or broken file reads as no schedules" (around line 114) that pins the old behaviour.

## Change

1. `FileScheduleStore.read()`: return `[]` only when the file does not exist (`err.code === 'ENOENT'`). For any other read error, JSON that does not parse, or JSON that is not an array: copy the file aside as `schedules.json.corrupt-<Date.now()>` (best effort, ignore a failed copy) and throw `new Error('The schedule file could not be read; it was kept as schedules.json.corrupt-<ts>.')`. The message names no path and no content.
2. `TickSummary` gets `error?: string`. In the `tick()` catch, set `summary.error` to a short redacted message and log it once: `console.error('[Release check-up] Scheduler tick failed:', redactedMessage(err))`. `redactedMessage` is exported from `./server.js` and used by `cli.ts:77`; if importing it into `scheduler.ts` makes an import cycle, check where it is defined (`grep -rn "export function redactedMessage" packages/*/src`) and import from there, or fall back to `err instanceof Error ? err.message.slice(0, 200) : 'unknown error'`.
3. Also log (same prefix, redacted) when `onRunScheduled(...)` rejects at `scheduler.ts:235`. Keep counting it as `failed`.
4. `start()`: keep a final `.catch(...)` on the `void this.tick(...)` call so the timer can never cause an unhandled rejection.
5. Update the doc comment above `FileScheduleStore` ("A missing file reads as no schedules; an unreadable one throws").

## Tests

- `scheduler-store.test.ts`: replace the "broken file reads as no schedules" case. A missing file still reads `[]`. A file holding `not json` makes `read()` reject, and a `schedules.json.corrupt-*` file exists next to it. `addSchedule` on a manager over a broken file rejects and does **not** overwrite `schedules.json` (its content is still `not json`).
- `scheduler.test.ts`: a store whose `read()` throws makes `tick()` resolve with `error` set, nothing started, and `console.error` called once (spy). A runner callback that rejects counts as `failed` and logs.

Run: `pnpm exec vitest run packages/runner/tests/scheduler-store.test.ts packages/runner/tests/scheduler.test.ts`, then the runner unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "ENOENT" packages/runner/src/scheduler.ts` finds the only branch that returns `[]`.
- [ ] `grep -n "error?: string" packages/runner/src/scheduler.ts` finds the `TickSummary` field.
- [ ] The tests above pass; `pnpm build` passes.

## Notes

- Audit findings H14 and M33 (part) (audit of 11 Nov 2026 on `d225418`).
- T-298 and T-299 also edit schedule code (`scheduler.ts` types and `server.ts`): build them after this one.
- The hosted `BackendScheduleStore` already lets store errors through; it is not changed.
