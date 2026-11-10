# T-107: `docs/API.md` matches what the runner serves

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | docs | todo |

**Files you may edit (no others):**
- `docs/API.md`
- `docs/ARCHITECTURE.md`

**Do not build in parallel with:** any other ticket that edits `docs/API.md` or `docs/ARCHITECTURE.md` (the docs batch may have one; check `docs/tickets/INDEX.md`).

## Problem

`docs/API.md` and `docs/ARCHITECTURE.md` disagree with the runner in five places.

1. `GET|HEAD /health` exists (`packages/runner/src/routes/health.ts`) and is not documented. It answers JSON `{ "status": "ok", "uptimeSeconds": <number> }` with `Cache-Control: no-store`.
2. Both docs say owner sign-in on the hosted copy (`AUDIT_OWNER_EMAILS`, T-86) is "not yet built". It is built: `packages/runner/src/server.ts` reads `AUDIT_OWNER_EMAILS` and `isAuditOwnerEmail` checks the signed-in email.
3. `POST /api/audits` and `POST /api/audits/:id/rerun` can answer `429 ERR_BETA_LIMIT` when `AUDIT_DAILY_LIMIT` is reached. Not documented.
4. `POST /api/runner/abort` also stops a running Website Audit (it then ignores `finish` and `discard`). The doc says only "Stops the current run."
5. The `GET /s/:linkId` row says "Any other `/s/...` path is 404." A malformed `/s/...` path is not matched by any row: with an access key set it answers 401, with none it serves the wizard page.

## Current text

`docs/API.md` (branch `worktree-audit-cleanup`)

Line 32:

```
- `GET /healthz`: `200 ok`, no key, no data. Cloud Run's front end does not forward it; the deploy checks `/`.
```

Line 45 (table row):

```
| `POST /api/runner/abort`, `/stop` | Stops the current run.
```

Line 93 (table row, ends with):

```
`409 ERR_RUN_IN_PROGRESS`.
```

Line 98 (table row):

```
| `POST /api/audits/:id/rerun`                   | owner      | `202`: new version, same address and limits.
```

Line 113 (table row, ends with):

```
`410` when expired, revoked or deleted. Any other `/s/...` path is 404.
```

Line 127:

```
Not yet built (ADR 0042, T-86): owner sign-in on the hosted copy (`AUDIT_OWNER_EMAILS`).
```

`docs/ARCHITECTURE.md` line 47:

```
Not yet built (ADR 0042, T-86): signed-in owner access on the hosted copy (`AUDIT_OWNER_EMAILS`).
```

## Change

Keep each table row on one line and keep the column bars; the table's padding spaces may change (run Prettier at the end).

1. After `docs/API.md` line 32 add:

```
- `GET /health`: `200` JSON `{ "status": "ok", "uptimeSeconds": <number> }`, `no-store`, no key. `HEAD` answers the headers only.
```

2. Line 45 description becomes:

```
Stops the current Check-up, or the running Website Audit when there is one (then `finish` and `discard` are ignored).
```

3. Line 93: after `` `409 ERR_RUN_IN_PROGRESS` `` and before the final full stop add `` ; `429 ERR_BETA_LIMIT` when `AUDIT_DAILY_LIMIT` starts are used up for the day ``.

4. Line 98 description becomes:

```
`202`: new version, same address and limits. `409 ERR_AUDIT_RUNNING`, `ERR_RUN_IN_PROGRESS`; `429 ERR_BETA_LIMIT`.
```

5. Line 113: replace the sentence `Any other `/s/...` path is 404.` with:

```
A malformed `/s/...` path matches no row: `401` when an access key is set, the wizard page otherwise.
```

6. Replace `docs/API.md` line 127 with:

```
Owner sign-in on the hosted copy (ADR 0042, T-86): a Google account whose email is in `AUDIT_OWNER_EMAILS` is an audit owner. On a beta copy only that sign-in opens owner and audit rows; the access key alone does not. `AUDIT_DAILY_LIMIT` caps audit starts per owner email per UTC day.
```

7. Replace `docs/ARCHITECTURE.md` line 47 with:

```
Signed-in owner access on the hosted copy (ADR 0042, T-86): a Google account whose email is in `AUDIT_OWNER_EMAILS` is an audit owner.
```

8. Run `pnpm exec prettier --write docs/API.md docs/ARCHITECTURE.md`.

## Tests

None. Check: `pnpm exec prettier --check docs/API.md docs/ARCHITECTURE.md`, and `grep -n "Not yet built" docs/API.md docs/ARCHITECTURE.md` prints nothing.

## Done when

- [ ] All seven edits are in.
- [ ] No "Not yet built" line about T-86 remains in either file.
- [ ] Prettier check passes.

## Notes

- Step 6 states the rule that T-91 enforces. Build T-91 first if it is not built; if T-91 is `blocked`, leave out the sentence "On a beta copy only that sign-in opens owner and audit rows; the access key alone does not."
- If another ticket already changed the "Not yet built" lines, skip steps 6 and 7.
- Do not set `docs/tickets/INDEX.md` T-86 status here.
