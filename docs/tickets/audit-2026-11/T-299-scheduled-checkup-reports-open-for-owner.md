# T-299: Reports from scheduled Check-ups open for the schedule's owner on the hosted copy

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | runner | bug | todo |

**Files you may edit (no others):**

- `packages/runner/src/server.ts`
- `packages/runner/src/beta.ts`
- `packages/runner/tests/beta-scheduled-run-owner.test.ts` (new)

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-300, T-301, T-302, T-303, T-308, T-313, T-329, T-331, T-357 (all edit `server.ts`); T-259, T-300, T-301 (all edit `beta.ts`).

## Problem

On the hosted copy a run belongs to the visitor session that started it: `claimOwner` records `runOwners.set(runId, currentSessionId())` (`packages/runner/src/server.ts:759-767`), and `isMine` compares the request's session with that entry (`server.ts:773-777`). The past check-ups list, a run's report and its evidence are all filtered by `isMine` (`server.ts:2283`, `:2291`, and `betaScope` for `/api/report` and `/api/evidence/`).

A scheduled Check-up is started by the Cloud Scheduler's tick. The tick row is `access: 'scheduler'`, and dispatch skips `enterSession` for it (`server.ts:1089`), so `runSchedule` (`server.ts:1425`) starts the run with no session, `claimOwner` records nothing, and `isMine` is false for every visitor. The scheduled run's report is on disk, but nobody on the hosted copy can open it, the owner included. Its live events go to nobody either (`streamRunnerEvent`, `server.ts:806-809`).

This ticket depends on T-298. With T-298's default (A: on the hosted copy only an `AUDIT_OWNER_EMAILS` sign-in manages schedules), the owner of a scheduled run is "an owner of this copy".

## Current code

Branch from `main`.

`packages/runner/src/server.ts` (`grep -n "claimOwner: (runId) =>\|private isMine" packages/runner/src/server.ts`):

```ts
      claimOwner: (runId) => {
        if (this.beta) {
          const me = currentSessionId();
          if (me) {
            this.runOwners.set(runId, me);
            pinSession(me);
          }
        }
      },
```

```ts
  /** Beta: whether a run belongs to the visitor making this request. Outside beta every run is everyone's. */
  private isMine(runId: string | null | undefined): boolean {
    if (!this.beta) return true;
    const me = currentSessionId();
    return !!me && !!runId && this.runOwners.get(runId) === me;
  }
```

Dispatch (`grep -n "enterSession(sessionFor" packages/runner/src/server.ts`):

```ts
          if (this.beta && matched?.route.access !== 'scheduler' && matched?.route.access !== 'public') {
            const proto = req.headers['x-forwarded-proto'];
            try {
              enterSession(sessionFor(req, res, (Array.isArray(proto) ? proto[0] : proto)?.includes('https') ?? false));
```

`runSchedule` (`grep -n "await this.checkupRun.start({ body, authorization });" packages/runner/src/server.ts`, the first hit, line 1448):

```ts
      await this.checkupRun.start({ body, authorization });
```

`streamRunnerEvent` (`grep -n "const owner = this.beta && eventRun" packages/runner/src/server.ts`):

```ts
    const owner = this.beta && eventRun ? this.runOwners.get(eventRun) : undefined;
    for (const client of this.streamClients) {
      // Beta: a run's events go only to the visitor who started it.
      if (this.beta && (!owner || this.streamSessions.get(client) !== owner)) continue;
```

`packages/runner/src/beta.ts`: `interface Session` (line 31) has `secrets`, `lastSeen`, `usage`, `proofChecks`, `pinned`; nothing says whether the visitor is a signed-in owner.

## Change

1. `beta.ts`: add to `interface Session`:

```ts
  /** The visitor is signed in with an AUDIT_OWNER_EMAILS Google account; set on every request (T-299). */
  owner?: boolean;
```

   and export two functions next to `pinSession`:

```ts
/** Records, on every request, whether the visitor is signed in as an owner of this copy. */
export function markSessionOwner(sessionId: string, owner: boolean): void {
  const s = sessions.get(sessionId);
  if (s) s.owner = owner;
}

/** Whether a session (by default the current request's) is a signed-in owner of this copy. */
export function sessionIsOwner(sessionId: string | undefined = current.getStore()): boolean {
  return !!sessionId && sessions.get(sessionId)?.owner === true;
}
```

2. `server.ts`, dispatch: replace the `enterSession(sessionFor(...))` line with:

```ts
              const visitor = sessionFor(req, res, (Array.isArray(proto) ? proto[0] : proto)?.includes('https') ?? false);
              enterSession(visitor);
              markSessionOwner(visitor, this.isAuditOwnerEmail(this.helperAccess?.session(req)?.email));
```

   (Import `markSessionOwner` and `sessionIsOwner` from `./beta.js` with the other beta imports.)

3. `server.ts`: add a module constant near `SCHEDULE_RUN_CAP_MS`:

```ts
/** The owner of a run a schedule started on the hosted copy: any signed-in owner of the copy. Never a session id (those are base64url). */
const SCHEDULE_RUN_OWNER = '(schedule)';
```

4. `server.ts`, `runSchedule`: replace `await this.checkupRun.start({ body, authorization });` with:

```ts
      const started = await this.checkupRun.start({ body, authorization });
      // The tick has no visitor session, so claimOwner recorded nothing: the run is the copy's owners' (T-299).
      if (this.beta) this.runOwners.set(started.runId, SCHEDULE_RUN_OWNER);
```

5. `server.ts`, `isMine`:

```ts
  private isMine(runId: string | null | undefined): boolean {
    if (!this.beta) return true;
    const owner = runId ? this.runOwners.get(runId) : undefined;
    // A scheduled run belongs to the copy's owners (T-298): any request signed in with an owner email.
    if (owner === SCHEDULE_RUN_OWNER) return sessionIsOwner();
    const me = currentSessionId();
    return !!me && !!owner && owner === me;
  }
```

6. `server.ts`, `streamRunnerEvent`: change the beta filter so a scheduled run's events reach owner streams:

```ts
      const mine =
        owner === SCHEDULE_RUN_OWNER
          ? sessionIsOwner(this.streamSessions.get(client))
          : !!owner && this.streamSessions.get(client) === owner;
      if (this.beta && !mine) continue;
```

7. Run `pnpm exec prettier --write` on the two source files and the new test, then `pnpm build`.

## Tests

New file `packages/runner/tests/beta-scheduled-run-owner.test.ts` (unit tier: a loopback `RunnerServer`, no Chromium). Reuse the shapes from `schedule-routes.test.ts` (`memoryStore`, `sched`, `publicNet`) and `helper-access.test.ts` (Helper cookies):

- Server: `beta: true`, `accessToken: KEY`, `hostChecks: publicNet`, `scheduleStore: memoryStore([sched({ id: 'sched_1_due', targetUrl: 'https://example.com/' })])`, `helperAccess` from `createHelperAccess({ projectId: 'proj', accessToken: KEY, store, auditOwnerEmails: [OWNER] })`, `auditOwnerEmails: [OWNER]`.
- No browser: `vi.spyOn(checkupRun, 'start').mockResolvedValue({ runId: 'run-1700000000000', awaitingReview: false })` and `vi.spyOn(checkupRun, 'waitFor').mockResolvedValue(undefined)` (reach `checkupRun` as `schedule-routes.test.ts` does through its `Spyable` cast).
- Write `summary.json` and `report.json` for `run-1700000000000` under `<outputDir>/runs/run-1700000000000/` the way `beta-privacy.test.ts` does.
- `await server.runScheduleTick()` returns `started: 1`.

Cases (each caller keeps the `qa_session` cookie of its first answer, as `newSession()` in `beta-privacy.test.ts` does, so the per-address session limit is not hit):

- Owner (`x-qa-access: KEY` + owner Helper cookie): `GET /api/runs` lists `run-1700000000000`; `GET /api/runs/run-1700000000000` answers 200.
- Tester with only the key: `GET /api/runs` does not list it; `GET /api/runs/run-1700000000000` answers 404 with `code: 'ERR_NOT_YOURS'`.
- A Helper who is not an owner (key + Helper cookie for another email): not listed.
- A run a tester started themselves (`runOwners` set to their session id, as `beta-privacy.test.ts` sets it) is still theirs only: the owner does not see it.

Run: `pnpm exec vitest run packages/runner/tests/beta-scheduled-run-owner.test.ts packages/runner/tests/schedule-routes.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm exec vitest run packages/runner/tests/beta-privacy.test.ts` (browser tier), then `pnpm build`.

## Done when

- [ ] `grep -n "SCHEDULE_RUN_OWNER" packages/runner/src/server.ts` finds the constant, `runSchedule`, `isMine` and `streamRunnerEvent`.
- [ ] `grep -n "export function markSessionOwner\|export function sessionIsOwner" packages/runner/src/beta.ts` finds both.
- [ ] On a beta copy an owner signed in with an `AUDIT_OWNER_EMAILS` account lists and opens a scheduled run's report; a key-only tester does not (new test).
- [ ] The new test, the runner unit tests and `beta-privacy.test.ts` pass; `pnpm build` passes.

## Notes

- Audit finding M3 (audit of 11 Nov 2026 on `d225418`).
- Depends on T-298. If the owner picks T-298 option B (each tester owns their schedules), record that schedule's owner as the run owner in step 4 instead of `SCHEDULE_RUN_OWNER`; if C (no schedules on the hosted copy), this ticket is not needed.
- An owner can also stop a scheduled run in progress on the hosted copy after this change (`betaScope` lets the run's owner stop it). That is intended.
- Not in this ticket: `runOwners` lives in memory, so after a restart no visitor sees any earlier run on the hosted copy, scheduled or not. That is a wider gap (run ownership is not stored with the run).
- Related: T-354 (the schedule store refuses an unreadable file) edits `scheduler.ts`, not the files here.
