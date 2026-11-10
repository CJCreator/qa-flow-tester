# T-101: The scheduler computes the next run in UTC

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | todo |

**Files you may edit (no others):**
- `packages/runner/src/scheduler.ts`
- `packages/runner/tests/scheduler.test.ts`

**Do not build in parallel with:** none.

## Problem

The schedule form in Settings says "Time of day (UTC)" and lists "02:00 UTC". `SchedulerManager.calculateNextRun` uses `setHours`, `getDay` and `setDate`, which use the server's local clock.

Scenario: on a computer in India (UTC+5:30) a daily schedule set to "02:00 UTC" runs at 02:00 local time, which is 20:30 UTC the day before. On Cloud Run (UTC) it happens to be right.

Owner decision (2026-11-10): the scheduler changes to UTC. The wizard label stays as it is. Existing local schedules shift once by the machine's UTC offset; that is accepted.

## Current code

`packages/runner/src/scheduler.ts:116-146` (branch `worktree-audit-cleanup`)

```ts
  calculateNextRun(cadence: 'daily' | 'weekly' | 'hourly', hour: number = 2, dayOfWeek: number = 1): string {
    const now = new Date();
    const next = new Date(now);

    if (cadence === 'hourly') {
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next.toISOString();
    }

    if (cadence === 'daily') {
      next.setHours(hour, 0, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next.toISOString();
    }

    if (cadence === 'weekly') {
      next.setHours(hour, 0, 0, 0);
      const currentDay = next.getDay();
      let daysUntil = (dayOfWeek - currentDay + 7) % 7;
      if (daysUntil === 0 && next <= now) {
        daysUntil = 7;
      }
      next.setDate(next.getDate() + daysUntil);
      return next.toISOString();
    }

    return next.toISOString();
  }
```

## Change

Replace the whole method with:

```ts
  /** The next time a schedule is due. `hour` and `dayOfWeek` (0 = Sunday) are UTC, as the Settings form says. */
  calculateNextRun(cadence: 'daily' | 'weekly' | 'hourly', hour: number = 2, dayOfWeek: number = 1): string {
    const now = new Date();
    const next = new Date(now);

    if (cadence === 'hourly') {
      next.setUTCMinutes(0, 0, 0);
      next.setUTCHours(next.getUTCHours() + 1);
      return next.toISOString();
    }

    if (cadence === 'daily') {
      next.setUTCHours(hour, 0, 0, 0);
      if (next <= now) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      return next.toISOString();
    }

    if (cadence === 'weekly') {
      next.setUTCHours(hour, 0, 0, 0);
      const currentDay = next.getUTCDay();
      let daysUntil = (dayOfWeek - currentDay + 7) % 7;
      if (daysUntil === 0 && next <= now) {
        daysUntil = 7;
      }
      next.setUTCDate(next.getUTCDate() + daysUntil);
      return next.toISOString();
    }

    return next.toISOString();
  }
```

Then check the rest of `scheduler.ts` for other local-clock calls: `grep -n "getHours\|setHours\|getDay()\|getDate()\|setDate(\|setMinutes\|getMinutes" packages/runner/src/scheduler.ts` must print nothing.

## Tests

Edit `packages/runner/tests/scheduler.test.ts`. Add a new `describe('calculateNextRun uses UTC', ...)` with fake time. Use `vi.useFakeTimers()` and `vi.setSystemTime(...)` in each test and `vi.useRealTimers()` in an `afterEach`. Create the manager with `new SchedulerManager(scratch)` as the other tests do.

Cases (all expected values are exact ISO strings):

| Now (`setSystemTime`) | Call | Expected |
|---|---|---|
| `2026-11-10T01:30:00.000Z` | `calculateNextRun('daily', 2)` | `2026-11-10T02:00:00.000Z` |
| `2026-11-10T02:00:00.000Z` | `calculateNextRun('daily', 2)` | `2026-11-11T02:00:00.000Z` |
| `2026-11-10T23:59:00.000Z` | `calculateNextRun('hourly')` | `2026-11-11T00:00:00.000Z` |
| `2026-11-10T12:00:00.000Z` (a Tuesday) | `calculateNextRun('weekly', 9, 1)` | `2026-11-16T09:00:00.000Z` |
| `2026-11-10T08:00:00.000Z` (a Tuesday) | `calculateNextRun('weekly', 9, 2)` | `2026-11-10T09:00:00.000Z` |
| `2026-11-10T10:00:00.000Z` (a Tuesday) | `calculateNextRun('weekly', 9, 2)` | `2026-11-17T09:00:00.000Z` |

These pass in any time zone only when the method uses UTC.

Run: `pnpm exec vitest run packages/runner/tests/scheduler.test.ts packages/runner/tests/schedule-routes.test.ts`, then `pnpm build`.

## Done when

- [ ] `scheduler.ts` has no local-clock date call.
- [ ] The six cases pass.
- [ ] Both test files and `pnpm build` pass.

## Notes

- Do not change the wizard label (`SettingsScreen.tsx`); it already says UTC.
- Do not migrate stored `nextRunAt` values. Each is recomputed after its next run.
