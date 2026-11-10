# T-95: Claim the daily audit start only when the audit really starts

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | built |

**Files you may edit (no others):**
- `packages/runner/src/routes/audit-crawl.ts`
- `packages/runner/src/routes/audit-rerun.ts`
- `packages/runner/tests/audit-crawl-route.test.ts`
- `packages/runner/tests/audit-rerun-route.test.ts`

**Do not build in parallel with:** T-109, T-111 (edit the same route files).

## Problem

`AUDIT_DAILY_LIMIT` caps Website Audit starts per owner email per day. Both start routes claim one start before they validate the body, check that the runner is free, and check the address.

Scenario: an owner with a limit of 3 sends three starts with a mistyped address. All three are refused with `ERR_DNS`, yet the day's limit is used up and a correct start gets 429.

## Current code

`packages/runner/src/routes/audit-crawl.ts:485-495` (branch `worktree-audit-cleanup`)

```ts
  const start = row('start', async (context) => {
    const { req, res } = context;
    const caller = await deps.caller(context);
    if (!caller.owner) return refuse(res, 403, 'ERR_FORBIDDEN', AUDIT_FORBIDDEN_START);

    if (deps.claimAuditLimit && caller.helperEmail) {
      const claim = deps.claimAuditLimit(caller.helperEmail);
      if (!claim.allowed) {
        return refuse(res, 429, 'ERR_BETA_LIMIT', claim.error ?? 'Daily limit of audit starts reached.');
      }
    }
```

and further down in the same handler:

```ts
    // Synchronous claim, no await before it after the check (BE-103).
    const tempRunId = `audit-${randomUUID()}`;
    if (!slot.begin(tempRunId, request.url, 'audit')) {
```

`packages/runner/src/routes/audit-rerun.ts:93-104` has the same claim block right after the `caller.owner` check, and further down:

```ts
    // Synchronous claim, no await before it after the check (BE-103).
    if (!slot.begin(auditId, request.url, 'audit')) {
```

## Change

In both files:

1. Cut the whole `if (deps.claimAuditLimit && caller.helperEmail) { ... }` block from its place after the `caller.owner` check.
2. Paste it directly above the comment `// Synchronous claim, no await before it after the check (BE-103).`, and put this comment above the pasted block:

```ts
    // The day's limit is claimed last, after every refusal above, so a refused start costs nothing.
```

The claim is synchronous, so the "no await before `slot.begin`" rule still holds. Do not add any `await` between the address check and `slot.begin`.

## Tests

No test covers `claimAuditLimit` yet. In `packages/runner/tests/audit-crawl-route.test.ts`, copy the setup of an existing test that builds the routes with `createAuditCrawlRoutes({...})` and gets a 422 for a bad address, and pass two more deps: `claimAuditLimit` and a `caller` that returns `{ owner: true, helperEmail: 'owner@example.com' }`. Add:

- Name: `'a refused start does not use up the daily limit'`.
- Arrange: `claimAuditLimit` is a `vi.fn(() => ({ allowed: true }))`; the caller has `helperEmail: 'owner@example.com'`; `checkAddress` resolves `{ ok: false, code: 'ERR_DNS', reason: 'x' }`.
- Act: POST the start route with a valid body.
- Expect: status 422 and `claimAuditLimit` called 0 times.

Add the same case in `packages/runner/tests/audit-rerun-route.test.ts` with `createAuditRerunRoutes({...})`. Also add, in the start-route file, `'a start over the limit answers 429'`: `claimAuditLimit` returns `{ allowed: false, error: 'limit' }`, `checkAddress` resolves `{ ok: true }` (copy the shape the passing tests use), expect status 429 and code `ERR_BETA_LIMIT`.

Run: `pnpm exec vitest run packages/runner/tests/audit-crawl-route.test.ts packages/runner/tests/audit-rerun-route.test.ts`, then `pnpm build`.

## Done when

- [x] In both routes the claim sits immediately before `slot.begin`.
- [x] A start refused for a bad body, a busy runner or a bad address does not call `claimAuditLimit`.
- [x] Both test files pass.

## Notes

- If `slot.begin` then loses a race and answers 409, one claim is spent. That is accepted: it needs two starts in the same tick.
