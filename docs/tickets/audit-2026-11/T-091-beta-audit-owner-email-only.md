# T-91: On a beta copy only a signed-in owner email is an audit owner

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P0 | S | runner | security | todo |

**Files you may edit (no others):**
- `packages/runner/src/server.ts`
- `packages/runner/src/routes/route.ts` (comment only)
- `packages/runner/tests/route-access-server.test.ts`

**Do not build in parallel with:** T-92, T-94, T-96, T-97, T-99, T-100, T-106, T-108, T-110, T-112 (all edit `server.ts`).

## Problem

`RunnerServer.isAuditOwner(req)` is true for anyone who carries the access key (and for any loopback caller when no key is set). The route dispatch passes that value as `auditOwner`. In `authorizeRoute`, `auditOwner === true` opens every `owner`, `view`, `edit` and `export` row on a beta copy.

Scenario: on the hosted beta every tester has the `?access=` key. Tester A can list, read and delete tester B's Website Audits, PUT `/api/audit-settings`, and create Shared Links.

Owner decision (2026-11-10): on a beta copy only a signed-in Google account whose email is in `AUDIT_OWNER_EMAILS` is an audit owner. The access key alone is not. This matches ADR 0037 D-004 and `docs/API.md`.

## Current code

`packages/runner/src/server.ts:1015-1025` (branch `worktree-audit-cleanup`)

```ts
  public isAuditOwner(req: http.IncomingMessage): boolean {
    if (this.carriesAccessKey(req)) return true;
    const session = this.helperAccess?.session(req);
    if (!session?.email) return false;
    return this.isAuditOwnerEmail(session.email);
  }

  public isAuditOwnerEmail(email?: string): boolean {
    if (!email) return false;
    return this.auditOwnerEmails.includes(email.trim().toLowerCase());
  }
```

`packages/runner/src/server.ts:1188-1194` (inside the request handler)

```ts
            const decision = authorizeRoute(matched.route, {
              hasAccessKey: this.carriesAccessKey(req),
              beta: this.beta,
              helper: (permission) => granted.has(permission),
              scheduler,
              auditOwner: isAuditOwner,
            });
```

`packages/runner/src/routes/route.ts:138-142`

```ts
  /**
   * The caller is an audit owner (holds the access key, or a Google sign-in whose email is in
   * AUDIT_OWNER_EMAILS, ADR 0042 / T-86). Passes 'owner' and audit rows on a beta copy.
   */
  auditOwner?: boolean;
```

## Change

1. In `server.ts`, in the `authorizeRoute(...)` call shown above, replace the `auditOwner` line with:

```ts
              // Email only: on a beta copy every tester holds the access key, so the key is not ownership.
              auditOwner: this.isAuditOwnerEmail(this.helperAccess?.session(req)?.email),
```

2. Do not change `isAuditOwner`, the `ownerAllowed` line (`server.ts:1169`), `helperRefusal`, or the three `auditOwner: this.isAuditOwner(req)` lines in the status replies (`server.ts:1319`, `1340`, `1620`). Off beta, a key holder still passes because `authorizeRoute` checks `hasAccessKey` separately.

3. In `routes/route.ts`, replace the comment above `auditOwner?: boolean;` with:

```ts
  /**
   * The caller is signed in with a Google account whose email is in AUDIT_OWNER_EMAILS (ADR 0042 / T-86).
   * The access key is `hasAccessKey`, never this. Passes 'owner' and audit rows on a beta copy.
   */
```

## Tests

Edit `packages/runner/tests/route-access-server.test.ts`. Copy the setup of the existing test `"AC-5: on a beta copy a row whose beta policy is not 'allow' is refused; a 'public' 'allow' row is served"` (it calls `call(BETA_PORT, ...)`).

Add one test in the same `describe`:

- Name: `'a beta caller with only the access key is not an audit owner'`.
- If the beta test server in this file has no access key, it is reached over loopback, which counts as "carries the key". So call `call(BETA_PORT, 'GET', '/api/t/owner-closed')` and `call(BETA_PORT, 'GET', \`/api/t/audits/${AUDIT_ID}\`)`.
- Expect both: `status` 403 and `JSON.parse(body).code === 'ERR_BETA'`.

Run: `pnpm exec vitest run packages/runner/tests/route-access-server.test.ts packages/runner/tests/route-access.test.ts`

Then `pnpm build`.

## Done when

- [ ] The `authorizeRoute` call passes an email-only `auditOwner`.
- [ ] The new test passes; every existing test in both files still passes.
- [ ] `pnpm build` passes.

## Notes

- Do not add a new ADR: this restores what ADR 0037 D-004 already says.
- If an existing test now fails because it relied on a key holder being an audit owner on beta, stop and set the ticket to `blocked` with the test name. Do not weaken the check.
- Out of scope: `docs/API.md` wording (T-107).
