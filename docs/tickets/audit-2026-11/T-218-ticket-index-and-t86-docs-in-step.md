# T-218: Ticket index and the T-86 "not yet built" lines agree with the code

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | inconsistency | todo |

**Files you may edit (no others):**
- `docs/tickets/INDEX.md`
- `docs/API.md` (line 127 and the blank line after it)
- `docs/ARCHITECTURE.md` (line 47 and the blank line after it)

**Do not build in parallel with:** T-217 (`docs/tickets/INDEX.md`; T-217 first), T-227 (`docs/ARCHITECTURE.md`).

## Problem
1. **T-86 is listed as `todo` and "not yet built", but it is in the code.** `AUDIT_OWNER_EMAILS` is read in
   `packages/runner/src/helpers/helper-access.ts:61` and `packages/runner/src/server.ts:824`, passed by
   `.github/workflows/deploy.yml:197`, and documented in `docs/CONFIGURATION.md:65` and `.env.example`.
   `docs/API.md:127` and `docs/ARCHITECTURE.md:47` still say "Not yet built".
2. **"Open: carried over" lists finished work.** T-52 is `done`. It is not open.
3. **T-23 is marked `done` but is not.** Its note says route handlers were split out and names modules that
   T-215 deletes. `packages/runner/src/server.ts` is still 4,110 lines, and `docs/API.md:17` says
   "Inline endpoints (not yet table rows)" remain.

## Current code
`docs/tickets/INDEX.md:29-30` (branch `worktree-audit-cleanup`)
```markdown
| [T-86](WEBSITE-AUDIT-RELIABILITY-PLAN.md#t-86-hosted-audits-for-the-signed-in-owner) | Hosted audits for the signed-in owner | A8 | P1 | M | 4 | todo | - |
| [T-89](WEBSITE-AUDIT-RELIABILITY-PLAN.md#t-89-proving-the-audit-works) | Proving the audit works | A12 | P1 | M | 4 | todo | - |
```

`docs/tickets/INDEX.md:34-45`
```markdown
| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| T-52 | Container hardening and health | DEP-3, 6, 7, 8, 9 | P1 | M | 8 | done | - |
| T-23 | Split large files by area | G35 | P3 | L | 19 | done | - |
| QSP-009 | Wizard smoke option (qaskills-patterns F3) | - | - | - | - | later | - |

- **T-52:** done. Hardened `packages/runner/Dockerfile` with non-root `USER qa`, `/healthz` HEALTHCHECK, and container isolation over Chromium `--no-sandbox`. Hardened `site/Dockerfile` with non-root `nginx-unprivileged` and native `HEALTHCHECK`. Provided full-stack `docker-compose.yml` and `docs/CONTAINER_DEPLOYMENT.md`.
- **T-23:** done. Modularized `server.ts` route handlers into dedicated controllers under `packages/runner/src/routes/` (`health.ts`), decoupled network intelligence and self-healing modules in `@qa/core`, maintaining 100% backward-compatible public exports and green test suites.

## Built work

Built work is in git. Website Audit T-79 to T-85, T-87, T-88, T-90: `fdf287f`, `a4cb689`, `b237983`. Earlier tracks (demo readiness, review remediation, qaskills-patterns) are in earlier history.
```

`docs/API.md:127`
```markdown
Not yet built (ADR 0042, T-86): owner sign-in on the hosted copy (`AUDIT_OWNER_EMAILS`).
```

`docs/ARCHITECTURE.md:47`
```markdown
Not yet built (ADR 0042, T-86): signed-in owner access on the hosted copy (`AUDIT_OWNER_EMAILS`).
```

## Change
1. `docs/tickets/INDEX.md`, T-86 row: change the status cell from `todo` to `built`. Leave the T-89 row.
2. `docs/tickets/INDEX.md`, "Open: carried over" table: delete the `T-52` row. Change the `T-23` row's status
   cell from `done` to `later`. Leave the `QSP-009` row.
3. Delete the `- **T-52:** done. ...` bullet.
4. Replace the `- **T-23:** done. ...` bullet with exactly:
   ```markdown
   - **T-23:** later. Partly done: the plan, schedule, Website Audit and health routes live under `packages/runner/src/routes/`. `packages/runner/src/server.ts` is still about 4,100 lines and keeps the inline endpoints listed in `docs/API.md`. Splitting the rest is not scheduled.
   ```
5. In `## Built work`, append one sentence to the end of the existing paragraph (same line):
   ```markdown
    T-52 (container hardening and health): non-root runner and site images, `/healthz` health checks, `docker-compose.yml`, `docs/CONTAINER_DEPLOYMENT.md`.
   ```
6. `docs/API.md`: delete line 127 and one of the two blank lines around it, so exactly one blank line separates
   the table from `## Adding a route`.
7. `docs/ARCHITECTURE.md`: delete line 47 and one of the two blank lines around it, so exactly one blank line
   separates the paragraph above from `## Routes and access`.

## Tests
```
pnpm exec prettier --write docs/API.md docs/ARCHITECTURE.md
pnpm format:check
```
These greps must print nothing:
```
grep -n "Not yet built" docs/API.md docs/ARCHITECTURE.md
grep -n "T-52 |\|self-healing\|network intelligence" docs/tickets/INDEX.md
```

## Done when
- [ ] T-86 is `built`; T-52 is out of the open table and named under "Built work"; T-23 is `later` with a note
      that matches the code.
- [ ] Neither `docs/API.md` nor `docs/ARCHITECTURE.md` says T-86 is not yet built.
- [ ] Both greps print nothing; `pnpm format:check` passes.

## Notes
- `built` is the right status, not `done`: per the index's own table, only `/verify-all` sets `done`.
- Do not add, remove or reorder any other row. Other tickets of this series add their own rows to the index.
- `docs/tickets/` is in `.prettierignore`; do not run prettier on `INDEX.md`.
- The `../OPEN_ISSUES.md` sentence on line 21 is removed by T-217, not here.
- Which callers count as the audit owner on a beta copy is a runner-batch ticket (owner decision: signed-in
  owner emails only). This ticket changes docs only.
