# T-102: Two "bring back a waiting Plan" requests at once must not lose a Plan

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | todo |

**Files you may edit (no others):**
- `packages/runner/src/routes/plan.ts`
- `packages/runner/tests/plan-routes.test.ts`

**Do not build in parallel with:** T-104, T-109 (edit `routes/plan.ts`).

## Problem

`POST /api/runner/waiting-plans` brings back a Plan kept aside for another site. It reads the Plan now awaiting review (`waitingNow`), then takes the wanted Plan out of the kept-aside list (`unpark`, which deletes its file), then claims the slot, then parks `waitingNow`.

Two requests at the same time both read `waitingNow` before either claims the slot. The second request's `begin()` replaces the first request's record without parking it. Its file was already deleted by `unpark`, so that Plan is gone.

The approve handler in the same file already guards against this with a per-session set:

```ts
const approving = new WeakSet<CheckupSession>();
```

## Current code

`packages/runner/src/routes/plan.ts:1264-1297` (branch `worktree-audit-cleanup`)

```ts
  // The plan now waiting is set aside for the new one. On the shared copy that is only ever the
  // asker's own: someone else's plan is never moved, and nothing is taken out of the kept-aside
  // list until this is known.
  const current = await ensurePlanLoaded(session);
  const waitingNow = current && session.run.phase === 'awaiting-review' ? current : null;
  if (c.isBeta && waitingNow && c.isMine && !c.isMine(waitingNow.plan.runId)) {
    sendJson(res, 409, {
      error: 'Someone else is reviewing a plan on this shared copy. Try again in a few minutes.',
      code: 'ERR_RUN_IN_PROGRESS',
    });
    return;
  }
  const record = body.host ? await session.plan.unpark(body.host) : null;
  if (!record) {
    sendJson(res, 404, { error: 'There’s no plan kept for that site.' });
    return;
  }
  // The slot is claimed through begin(), with no await since the plan was taken out of the kept-aside list:
  // a run that began meanwhile keeps it, and the plan goes back where it was. begin() bumps the generation.
  if (!session.run.begin(record.plan.runId, record.plan.targetUrl)) {
    await session.plan.park(record);
    sendJson(
      res,
      409,
      otherRunBusy(session, c.isBeta) ?? {
        error: 'A check-up is running. Wait for it to finish, or stop it first.',
        code: 'ERR_RUN_IN_PROGRESS',
      }
    );
    return;
  }
  session.run.setPhase('awaiting-review');
  if (waitingNow) await session.plan.park(waitingNow);
  await session.plan.save(record);
```

## Change

1. Next to the existing `const approving = new WeakSet<CheckupSession>();` (line 928) add:

```ts
/** Sessions with a "bring back a waiting plan" request under way: a second one is refused, not interleaved. */
const resuming = new WeakSet<CheckupSession>();
```

2. Directly above the comment `// The plan now waiting is set aside for the new one.` add:

```ts
  if (resuming.has(session)) {
    sendJson(res, 409, {
      error: 'A plan is already being brought back. Try again in a moment.',
      code: 'ERR_RUN_IN_PROGRESS',
    });
    return;
  }
  resuming.add(session);
  try {
```

3. Indent everything from that comment down to the end of the handler's work for this POST (the last statement that sends the 200 reply for the resumed Plan) one level, and close with:

```ts
  } finally {
    resuming.delete(session);
  }
```

Every early `return` inside the block stays; `finally` runs for all of them.

## Tests

Edit `packages/runner/tests/plan-routes.test.ts`. Find an existing test of `POST /api/runner/waiting-plans` (search for `waiting-plans`) and copy its setup.

Add `'two resume requests at once: one wins, one is refused, no Plan is lost'`:

- Arrange: one Plan awaiting review for host `a.example`, and one Plan kept aside for host `b.example`.
- Act: send two `POST /api/runner/waiting-plans` with `{ host: 'b.example' }` without awaiting the first (`await Promise.all([...])`).
- Expect: the statuses, sorted, are `[200, 409]`; afterwards the current record is the Plan for `b.example` and the kept-aside list contains `a.example`.

If the file has no existing test of this route, add no test and say so in your notes.

Run: `pnpm exec vitest run packages/runner/tests/plan-routes.test.ts`, then `pnpm build`.

## Done when

- [ ] A second concurrent resume on one session answers 409 `ERR_RUN_IN_PROGRESS`.
- [ ] The guard is always released (`finally`).
- [ ] The test file and `pnpm build` pass.

## Notes

- Do not change the order of `unpark`, `begin`, `park`.
