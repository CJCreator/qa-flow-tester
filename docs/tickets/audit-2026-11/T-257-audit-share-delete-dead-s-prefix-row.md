# T-257: Delete the dead `GET /s` prefix row in the Shared Link routes

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | runner | dead-code | todo |

**Files you may edit (no others):**

- `packages/runner/src/routes/audit-share.ts`
- `packages/runner/tests/audit-share-routes.test.ts`

**Do not build in parallel with:** T-262, T-263 (both edit `audit-share.ts`).

## Problem

`auditShareRoutes` returns a row `{ method: 'GET', path: '/s', prefix: true, ... handle: sharedNotFound }` meant to answer any malformed `/s/...` path with the "not found" page. It never runs. The real route table is built from the contract (`AUDIT_API`) in `routes/index.ts` (`contractRows`), and the handlers are looked up by `METHOD path` from the contract. `GET /s` is not in the contract, so no table row points at this handler. T-107 already corrected `docs/API.md`: a malformed `/s/...` path matches no row, so it answers 401 when an access key is set and serves the wizard page otherwise. Deleting the row keeps today's behaviour.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "sharedNotFound" packages/runner/src/routes/audit-share.ts`.

```ts
/** Any other GET under `/s/` (a malformed id) gets the same 404 body as an unknown id. */
const sharedNotFound = (c: RouteContext): void => sendSharedPage(c.res, 404, SHARED_NOT_FOUND_PAGE);
```

and the last row of the returned array:

```ts
    { method: 'GET', path: '/s', prefix: true, access: 'public', beta: 'allow', handle: sharedNotFound },
  ];
```

`packages/runner/tests/audit-share-routes.test.ts`:

```ts
const isShared = typeof row.path === 'string' && (row.path === '/s' || row.path.startsWith('/s/'));
```

## Change

1. In `audit-share.ts` delete the `sharedNotFound` constant with its comment, and delete the `{ method: 'GET', path: '/s', prefix: true, ... }` row.
2. Check `RouteContext` is still used in the file: `grep -n "RouteContext" packages/runner/src/routes/audit-share.ts`. Keep its import if other lines use it. `SHARED_NOT_FOUND_PAGE` stays (used by `sharedPage` and by tests).
3. In the test, change that line to `row.path.startsWith('/s/')` only:

```ts
const isShared = typeof row.path === 'string' && row.path.startsWith('/s/');
```

4. Run `pnpm exec prettier --write packages/runner/src/routes/audit-share.ts packages/runner/tests/audit-share-routes.test.ts` and `pnpm build`.

## Tests

Edit `packages/runner/tests/audit-share-routes.test.ts`. Add after the test `'only the /s/ rows are public and served on a beta copy; the others need the access key'`:

- Name: `'the Shared Link rows are exactly the four contract rows'`. Assert `routes.map((r) => \`${r.method} ${r.path}\`)`toEqual`['GET /api/audits/:id/share', 'POST /api/audits/:id/share', 'DELETE /api/audits/:id/share/:linkId', 'GET /s/:linkId']`. (If the array order in the file differs, assert with `expect.arrayContaining`plus`toHaveLength(4)`.)

Run: `pnpm exec vitest run packages/runner/tests/audit-share-routes.test.ts packages/runner/tests/audit-route-registration.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "sharedNotFound\|path: '/s'" packages/runner/src/routes/audit-share.ts` prints nothing.
- [ ] The two test files pass and `pnpm build` passes.

## Notes

- No owner decision: behaviour does not change. If the owner later wants a malformed `/s/...` path to show the "not found" page, that is a new contract row plus an ADR note, not this ticket.
- `docs/API.md` already describes the real behaviour. Do not edit it.
