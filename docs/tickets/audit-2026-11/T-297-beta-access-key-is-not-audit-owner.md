# T-297: On a beta copy the access key alone is not an audit owner inside the audit handlers

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | security | todo |

**Files you may edit (no others):**

- `packages/runner/src/server.ts`
- `packages/runner/tests/helper-access.test.ts`
- `packages/runner/tests/beta-key-not-audit-owner.test.ts` (new)

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-298, T-299, T-300, T-301, T-302, T-303, T-308, T-313, T-329, T-331, T-357 (all edit `server.ts`).

## Problem

On the hosted copy every tester holds the shared access key (the deploy sets `RUNNER_ACCESS_TOKEN`). Dispatch knows this: it passes `authorizeRoute` an email-only owner flag, with the comment "on a beta copy every tester holds the access key, so the key is not ownership" (`packages/runner/src/server.ts:1073-1074`). `docs/API.md:128` says the same: "On a beta copy only that sign-in opens owner and audit rows; the access key alone does not."

The handlers do not follow it. `isAuditOwner` returns true for the key on every copy (`server.ts:895-900`), the audit wiring uses it as `isOwnerRequest` (`server.ts:735`), and every audit row reads `caller.owner = wiring.isOwnerRequest(req)` (`packages/runner/src/routes/index.ts:107-111`). A tester who holds the key and is also a Helper with any view grant passes dispatch on the id-less `view` rows (`helperHoldsAnyView`, `server.ts:856-858`), and then the handler treats them as the owner: `grantedAuditIds` returns `null` for an owner (`packages/runner/src/routes/audit-store.ts:65`), so `GET /api/audits` and `GET /api/shortlist` list every audit on the copy, and `GET /api/audits/:id/share` returns the Shared Link ids, which are bearer secrets (`packages/runner/src/routes/audit-share.ts:298-301`).

`/api/runner/status` tells every key holder `auditOwner: true` (`server.ts:1201`, `:1222`, and the beta reduced status at `:1523`), so the wizard shows them the Website Audit areas that then refuse them.

## Current code

Branch from `main`.

`packages/runner/src/server.ts` (`grep -n "public isAuditOwner" packages/runner/src/server.ts`):

```ts
  /**
   * Whether the request is from an audit owner (holds the access key, or is a signed-in Google account in
   * AUDIT_OWNER_EMAILS, ADR 0042 / T-86).
   */
  public isAuditOwner(req: http.IncomingMessage): boolean {
    if (this.carriesAccessKey(req)) return true;
    const session = this.helperAccess?.session(req);
    if (!session?.email) return false;
    return this.isAuditOwnerEmail(session.email);
  }
```

The wiring's doc comment (`grep -n "isOwnerRequest(req: http" packages/runner/src/server.ts`):

```ts
  /** The request is the owner's: it carries the access key, or, with none set, comes from this computer (DEC-004). */
  isOwnerRequest(req: http.IncomingMessage): boolean;
```

Dispatch (`grep -n "the key is not ownership" packages/runner/src/server.ts`):

```ts
              // Email only: on a beta copy every tester holds the access key, so the key is not ownership.
              auditOwner: this.isAuditOwnerEmail(this.helperAccess?.session(req)?.email),
```

`packages/runner/tests/helper-access.test.ts` asserts today's behaviour (`grep -n "keyRes" packages/runner/tests/helper-access.test.ts`):

```ts
    const keyRes = await call('GET', '/api/runner/status', undefined, ACCESS);
    expect(keyRes.status).toBe(200);
    expect(JSON.parse(keyRes.body).auditOwner).toBe(true);
```

## Change

1. `server.ts`, `isAuditOwner`: on a beta copy the key is not ownership. Replace the method and its comment with:

```ts
  /**
   * Whether the request is from an audit owner: a signed-in Google account in AUDIT_OWNER_EMAILS (ADR 0042 / T-86),
   * or, on a copy that is not beta, the access key (or this computer when no key is set, DEC-004). On a beta copy
   * every tester holds the key, so the key alone is not ownership there (T-297).
   */
  public isAuditOwner(req: http.IncomingMessage): boolean {
    if (!this.beta && this.carriesAccessKey(req)) return true;
    const session = this.helperAccess?.session(req);
    if (!session?.email) return false;
    return this.isAuditOwnerEmail(session.email);
  }
```

   Every reader follows: the audit handlers through `isOwnerRequest`, the three `auditOwner` fields of `/api/runner/status`, and `helperRefusal`. Dispatch is unchanged in effect: a key holder on an `owner` row still passes `grantAccess` (it checks the key itself), and `authorizeRoute` already got the email-only flag.

2. `server.ts`, the `AuditWiring.isOwnerRequest` doc comment: change it to "The request is the owner's (`RunnerServer.isAuditOwner`): an AUDIT_OWNER_EMAILS sign-in, or, outside beta, the access key or this computer (DEC-004)."

3. `packages/runner/tests/helper-access.test.ts`: in the test "reports auditOwner: true on /api/runner/status for allow-listed owner", change `expect(JSON.parse(keyRes.body).auditOwner).toBe(true);` to `.toBe(false)` and add the comment `// T-297: on a beta copy the key alone is not an owner.`

4. Run `pnpm exec prettier --write` on the changed files and the new test, then `pnpm build`.

## Tests

New file `packages/runner/tests/beta-key-not-audit-owner.test.ts` (unit tier: a loopback `RunnerServer`, no Chromium). Set-up, modelled on `helper-access.test.ts`:

- `delete process.env.AUDIT_STORE_BUCKET`; a temp `dataDir`; `store = new AuditStore(new LocalAuditStoreBackend(dataDir))` (the same folder the server's own store uses); `access = createHelperAccess({ projectId: 'proj', accessToken: KEY, store, auditOwnerEmails: [OWNER] })`.
- `new RunnerServer({ port: await freePort(), outputDir, dataDir, beta: true, accessToken: KEY, helperAccess: access, auditOwnerEmails: [OWNER] })`.
- Two audits A and B (`store.createAudit(REQUEST)`, the `REQUEST` of `helper-access.test.ts`); `store.grantHelper(auditA, HELPER, ['view'])`; one Shared Link on A (`store.createShare(auditA, { version: 1, kind: 'pitch', language: 'en' })`; if it needs a finished version, save one as `finishedAudit()` in `audit-store-routes.test.ts` does).
- Cookies: `helperCookie = ${HELPER_COOKIE}=${signHelperSession(access.sessionKey(), { email: HELPER, sub: 'u1' }, new Date())}`, and the same for `OWNER`. Send the key as `x-qa-access: KEY`.

Cases:

- Key + Helper cookie, `GET /api/audits`: 200, the list holds A only.
- Key + Helper cookie, `GET /api/shortlist`: 200, nothing from B.
- Key + Helper cookie, `GET /api/audits/<A>/share`: 200, the link has no `id` field.
- Key only, `GET /api/runner/status`: 200, `auditOwner` is `false`.
- Owner cookie (with or without the key), `GET /api/audits`: both A and B; `GET /api/audits/<A>/share`: the link has its `id`; `GET /api/runner/status`: `auditOwner` is `true`.

Then a non-beta check in the same file: a `RunnerServer` without `beta`, same key: key only, `GET /api/runner/status` gives `auditOwner: true` (the local owner is unchanged).

Run: `pnpm exec vitest run packages/runner/tests/beta-key-not-audit-owner.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm exec vitest run packages/runner/tests/helper-access.test.ts packages/runner/tests/helper-wizard-access.test.ts` (browser tier, both start a runner), then `pnpm build`.

## Done when

- [ ] `grep -n "if (!this.beta && this.carriesAccessKey(req)) return true;" packages/runner/src/server.ts` finds the line in `isAuditOwner`.
- [ ] On a beta copy, key + Helper cookie lists only the Helper's audits and gets no Shared Link ids (new test).
- [ ] `/api/runner/status` gives `auditOwner: false` for a key-only tester on a beta copy and `true` on a local copy.
- [ ] The new test, the runner unit tests and `helper-access.test.ts` pass; `pnpm build` passes.

## Notes

- Audit finding H2 (audit of 11 Nov 2026 on `d225418`).
- The wizard needs no change: `AreaNav`, `CommandPalette` and `showsBetaAuditNotice` already read `status.auditOwner` (`packages/wizard/src/App.tsx:803`, `:999`, `:1025`). A tester with only the key stops seeing the Website Audit areas on the hosted copy, which is what `docs/API.md` already promises.
- `AuditDailyLimiter.claim` returns `allowed: true` without an email (`packages/runner/src/helpers/audit-limit.ts`). After this change no beta caller reaches an audit start without an owner email, so that branch only serves local copies.
- Related: T-298 (schedule rows on the hosted copy also treat the key as the owner).
