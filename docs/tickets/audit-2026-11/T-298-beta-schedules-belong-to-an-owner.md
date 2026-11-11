# T-298: On a beta copy each schedule belongs to its owner, with a cap per owner

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | runner | security | todo |

**Files you may edit (no others):**

- `packages/runner/src/routes/schedules.ts`
- `packages/runner/src/server.ts`
- `packages/runner/tests/schedule-routes.test.ts`
- `packages/runner/tests/route-access.test.ts`
- `packages/runner/tests/beta.test.ts`
- `docs/API.md`
- `docs/adr/0039-cloud-scheduler-owner-schedules.md`

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-299, T-300, T-301, T-302, T-303, T-308, T-313, T-329, T-331, T-357 (all edit `server.ts`); T-313 (edits `beta.test.ts`); T-244, T-266 (all edit `API.md`); T-276 (edits `0039-cloud-scheduler-owner-schedules.md`).

## Problem

The four schedule rows (list, add, pause, delete) are `access: 'owner'` and `beta: 'allow'` (`packages/runner/src/routes/schedules.ts:51-94`, e.g. `:54-55`). `authorizeRoute` lets any caller with the access key through an `owner` row (`packages/runner/src/routes/route.ts:170`) and serves every `beta: 'allow'` row on a beta copy (`route.ts:189`). On the hosted copy every tester holds the key, so every tester can list, add, pause and delete everyone's schedules. The store is one global list with no owner field and no count limit (`packages/runner/src/server.ts:3727-3742`, `handleAddSchedule` at `:3760`). Each due schedule takes the single run slot during a tick, so a tester can also fill the slot for everyone with hourly schedules.

ADR 0039 assumed "the owner (access key) can manage schedules in beta", which does not hold when the key is shared. The `RunnerServerOptions.beta` doc comment (`server.ts:363-366`) still says schedules are closed on a beta copy, which is no longer true either.

## Owner decision (open)

Who may manage schedules on the hosted copy?

- **A. Only an owner signed in with an `AUDIT_OWNER_EMAILS` Google account (recommended default).** Drop `beta: 'allow'` from the four owner rows. `authorizeRoute` already serves an `owner` row on a beta copy to a caller whose email is an owner email (`auditOwnerAllowed`, `route.ts:188`), so no new access code is needed. A tester with only the key gets `403 ERR_BETA`, and the wizard already shows "Schedules are managed by the owner of this copy." for a 401/403 (`SCHEDULES_OWNER_ONLY`, `packages/wizard/src/api.ts:1004`). Add a cap of 10 schedules on the hosted copy so one owner cannot fill the run slot all day. A local copy is unchanged.
- **B. Every tester keeps their own schedules.** Store an owner on each schedule, filter list, pause and delete by it, and cap each owner at N. The owner cannot be the visitor session: sessions live in memory for 24 hours (`packages/runner/src/beta.ts:26-27`) and are gone after a restart, so the schedules would be orphaned. It needs a Google sign-in for testers, a new field in `CheckupSchedule`, a store migration and a wizard change. Much more work.
- **C. Close schedules on the hosted copy for everyone, owners too.** Put the four rows back in `closedInBeta`. Simple, but it undoes what ADR 0039 was written for.

This ticket builds A unless the owner picks another option.

## Current code

Branch from `main`.

`packages/runner/src/routes/schedules.ts` (`grep -n "beta: 'allow'" packages/runner/src/routes/schedules.ts`): five rows have `beta: 'allow'`, the tick row (`access: 'scheduler'`, line 44) and the four owner rows (lines 55, 62, 70, 86), for example:

```ts
  {
    method: 'GET',
    path: SCHEDULES_PATH,
    access: 'owner',
    beta: 'allow',
    handle: (context) => guarded(context, async () => sendJson(context.res, 200, await context.server.listSchedules())),
  },
```

`packages/runner/src/routes/route.ts` (`grep -n "auditOwnerAllowed" packages/runner/src/routes/route.ts`):

```ts
  if (caller.beta) {
    const auditOwnerAllowed = caller.auditOwner === true && (access === 'owner' || isHelperPermission(access));
    const servedInBeta = route.beta === 'allow' || access === 'sign-in' || helperGranted || auditOwnerAllowed;
```

`packages/runner/src/server.ts` (`grep -n "deleting check-ups, schedules" packages/runner/src/server.ts`):

```ts
  /**
   * Beta mode (RUNNER_BETA=1), for a runner shared with a few outside testers: each tester's AI key and
   * sign-ins live in memory for their session only, only public sites can be checked, and the routes that
   * change what other testers see (deleting check-ups, schedules, comparisons) are closed.
   */
  beta?: boolean;
```

`handleAddSchedule` (`grep -n "const schedule = await this.scheduler.addSchedule" packages/runner/src/server.ts`) adds without any count check.

Tests that encode today's behaviour:

- `packages/runner/tests/route-access.test.ts:257-267`: "the four owner rows are owner / allow" (`for (const row of owner) expect(row.beta).toBe('allow');`).
- `packages/runner/tests/beta.test.ts:201-252`: "Schedules on a beta copy with an access key (ADR 0039)", where `asOwner` is the key only and "serves the owner: add, list, pause and delete are never 403".
- `packages/runner/tests/schedule-routes.test.ts:192-270`: the beta block creates schedules with `{ 'x-qa-access': KEY }` only ("refuses private targets at creation", "rejects out-of-range values").

## Change

1. `routes/schedules.ts`: remove `beta: 'allow',` from the four `access: 'owner'` rows. Keep it on the tick row. Change the file's top comment to: "the owner's list, add, pause and delete; on the hosted copy only an owner signed in with an AUDIT_OWNER_EMAILS Google account reaches them (the access key is shared by every tester there, T-298), and the tick the Cloud Scheduler job calls."

2. `server.ts`, `handleAddSchedule`: after the out-of-range check and before `this.scheduler.addSchedule(...)`, refuse an eleventh schedule on the hosted copy:

```ts
    // The hosted copy has one run slot for everyone: a few schedules, not a full day of them (T-298).
    if (this.beta && (await this.scheduler.loadSchedules()).length >= MAX_HOSTED_SCHEDULES) {
      this.sendJson(res, 429, {
        error: `This copy already has ${MAX_HOSTED_SCHEDULES} schedules. Delete one before adding another.`,
        code: 'ERR_SCHEDULE_LIMIT',
      });
      return;
    }
```

   with `const MAX_HOSTED_SCHEDULES = 10;` next to the other module constants near `TICK_BUDGET_MS` (`grep -n "TICK_BUDGET_MS =" packages/runner/src/server.ts`).

3. `server.ts`, the `beta?: boolean` doc comment: replace "and the routes that change what other testers see (deleting check-ups, schedules, comparisons) are closed." with "and the routes that change what other testers see (deleting check-ups, comparisons) are closed. Schedules are served only to an owner signed in with an AUDIT_OWNER_EMAILS account (T-298)."

4. `docs/API.md:25`: change "Plan and schedule rows are `allow`." to "Plan rows are `allow`. The four schedule rows are not: on a beta copy only an owner signed in with an `AUDIT_OWNER_EMAILS` Google account reaches them, and the access key alone is refused (`403 ERR_BETA`, T-298)." In the Schedules table, add to the `POST /api/runner/schedules` row: "On a beta copy at most 10 schedules (`429 ERR_SCHEDULE_LIMIT`)."

5. `docs/adr/0039-cloud-scheduler-owner-schedules.md`: add at the end:

```md
## Amendment, 2026-11-11 (T-298): on the hosted copy the schedule owner is an owner email

Every tester on the hosted copy holds the access key, so "the owner (access key)" in Decision let any tester list, add, pause and delete every schedule. The four schedule rows are no longer `beta: 'allow'`: on a beta copy only a Google sign-in whose email is in `AUDIT_OWNER_EMAILS` reaches them (route.ts `auditOwnerAllowed`, as for the Website Audit owner rows, ADR 0042). The hosted copy also keeps at most 10 schedules. A local copy is unchanged: the access key (or this computer) is the owner.
```

6. Run `pnpm exec prettier --write` on every changed file, then `pnpm build`.

## Tests

`packages/runner/tests/route-access.test.ts`, "schedule rows and the scheduler access level (ADR 0039)":

- Rename "the four owner rows are owner / allow, and the tick row is scheduler / allow" to "the four owner rows are owner and not served in beta by policy; the tick row is scheduler / allow", and replace `for (const row of owner) expect(row.beta).toBe('allow');` with `for (const row of owner) expect(row.beta).toBeUndefined();`.
- New case: for each of the four owner rows, `authorizeRoute(row, { hasAccessKey: true, beta: true })` is `{ allow: false, status: 403, code: 'ERR_BETA' }`; `authorizeRoute(row, { hasAccessKey: false, beta: true, auditOwner: true })` is `{ allow: true }`; `authorizeRoute(row, { hasAccessKey: true, beta: false })` is `{ allow: true }`.

`packages/runner/tests/schedule-routes.test.ts`, the "schedules on a beta copy" block:

- Give the `RunnerServer` `auditOwnerEmails: ['owner@example.com']` (and the same to `createHelperAccess`), and build `ownerCookie` like `helperCookie` for `owner@example.com`.
- "refuses private targets at creation" and "rejects out-of-range values": send `{ cookie: ownerCookie }` instead of `{ 'x-qa-access': KEY }`. The expected codes stay.
- New case "the access key alone is 403 ERR_BETA on the four schedule rows": `GET`, `POST /api/runner/schedules`, `POST …/sched_1_abc/toggle`, `DELETE …/sched_1_abc`, each with `{ 'x-qa-access': KEY }` only.
- New case "an owner manages schedules": with `ownerCookie`, add (201), list (200), toggle (200), delete (200).
- New case "an eleventh schedule is refused": set `store.list` to 10 schedules, then the owner's add answers 429 with `code: 'ERR_SCHEDULE_LIMIT'` and `store.list` still has 10. Restore `store.list` after.

`packages/runner/tests/beta.test.ts`, "Schedules on a beta copy with an access key (ADR 0039)": rename the block to "Schedules on a beta copy: the access key alone is not the owner (T-298)", and change "serves the owner: add, list, pause and delete are never 403" to "refuses a key holder with 403 ERR_BETA": the same four calls through `asOwner` each answer 403 with `code: 'ERR_BETA'`. Keep the 401 case and the `DELETE /api/runs/run-1` case.

Run: `pnpm exec vitest run packages/runner/tests/route-access.test.ts packages/runner/tests/schedule-routes.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm exec vitest run packages/runner/tests/beta.test.ts` (browser tier), then `pnpm build`.

## Done when

- [ ] `grep -c "beta: 'allow'" packages/runner/src/routes/schedules.ts` prints 1 (the tick row).
- [ ] On a beta copy a key-only caller gets 403 `ERR_BETA` on the four schedule rows, and an `AUDIT_OWNER_EMAILS` sign-in gets through (tests).
- [ ] `grep -n "MAX_HOSTED_SCHEDULES" packages/runner/src/server.ts` finds the constant and its use in `handleAddSchedule`.
- [ ] `docs/API.md` and ADR 0039 say who owns schedules on the hosted copy.
- [ ] The changed tests and the runner unit tests pass; `beta.test.ts` passes; `pnpm build` passes.

## Notes

- Audit finding H3 (audit of 11 Nov 2026 on `d225418`).
- The tick row (`access: 'scheduler'`) and the cleanup row in `routes/sessions.ts` keep `beta: 'allow'`: they are the Cloud Scheduler's, proven by its Google token.
- The wizard shows the generic "Couldn’t create the scheduled check-up." for the 429 (`addSchedule` in `packages/wizard/src/api.ts`). Showing the runner's message there is a wizard change, not in this ticket.
- Follow-ups: T-299 (reports of scheduled runs on the hosted copy are visible to nobody) builds on this decision. T-354 also edits the schedule store (`scheduler.ts`), not the files here.
- Related: T-297 (the access key alone is not an audit owner on a beta copy).
