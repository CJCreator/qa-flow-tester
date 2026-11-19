# Tickets

The tracker for open work and the committed record of each ticket's status. When this file and `.claude/work/backlog.md` disagree, this file wins. The ticket body is the linked section of its plan, which holds the scope, files, tests and the reason for any `blocked`, `human` or `later` status.

## Statuses

The status cell holds exactly one of these keywords:

| Status | Meaning | Set by |
|---|---|---|
| `todo` | Ticket written, not yet planned | the plan author |
| `planned` | Plan written, waiting for approval | `/ship plan` |
| `approved` | Approved, ready to build | the human (`/ship approve`) |
| `building` | Being built | `/build-next` |
| `built` | Code written; tests wait for `/verify-all` | `/build-next` |
| `done` | Verified | `/verify-all` |
| `blocked` | Cannot proceed; the reason is in the plan | whoever hits the block |
| `human` | Code built; manual steps left for a person | the builder |
| `later` | Deferred by decision | the human |

The order of work is `todo` → `planned` → `approved` → `building` → `built` → `done`. Waves order tickets within one plan only. Build a wave once every ticket in the waves before it is `built`. Gap ids and other ids resolve in the linked plan.

## Open: carried over

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| T-23 | Split large files by area | G35 | P3 | L | 19 | later | - |
| QSP-009 | Wizard smoke option (qaskills-patterns F3) | - | - | - | - | later | - |
| T-432 | Approve and re-run a paused Sensitive Action | T-421 | P3 | M | - | later | T-421, T-422 |

- **T-23:** later. Partly done: the plan, schedule, Website Audit and health routes live under `packages/runner/src/routes/`. `packages/runner/src/server.ts` is still about 4,100 lines and keeps the inline endpoints listed in `docs/API.md`. Splitting the rest is not scheduled.
- **T-432:** later. When the Safety Filter pauses an unapproved Sensitive Action (T-421, T-422), the Test is marked Skipped. Approve and re-run button beside each paused Test in the report to mark it approved (`sensitiveApproved`) and re-run only that Test on a Test Copy. Owner decision 2026-11-19: keep the note for now, add the button later. Read ticket at `git show 5899275:docs/tickets/enhance-2026-11/T-432-approve-and-rerun-a-paused-sensitive-action.md`.

## Built work

Built work is in git. Audit follow-up of November 2026, T-225 to T-387 (146 tickets): the ticket files were removed; read one with `git show b176eb5:docs/tickets/audit-2026-11/<file>`. Enhancement plan of November 2026, T-388 to T-431 and T-396 (44 tickets, all built and verified on `5899275`): the ticket files were removed once built; read one with `git show 5899275:docs/tickets/enhance-2026-11/<file>`. T-432 is carried over. Audit of November 2026, T-91 to T-224 (134 tickets, all built and verified on `d225418`): the ticket files were removed once built; read one with `git show 409a01b:docs/tickets/audit-2026-11/<file>`. Open tickets that name a T-91 to T-224 ticket do so as background only. Website Audit T-79 to T-90 (12 tickets): `fdf287f`, `a4cb689`, `b237983`, `4d31e5e`, `783c71b`. Earlier tracks (demo readiness, review remediation, qaskills-patterns) are in earlier history. T-52 (container hardening and health): non-root runner and site images, `/healthz` health checks, `docker-compose.yml`, `docs/CONTAINER_DEPLOYMENT.md`.

## Open: hosted pilot ([plan](hosted-pilot-2026-11/PLAN.md), ADR 0050)

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| T-433 | Vercel forwards the runner's paths (prove the proxy first) | - | P1 | M | 1 | human | - |
| T-434 | A signed-in Google account is a way in | - | P1 | L | 2 | built | T-433 |
| T-435 | Limits and Verified Domain proof follow the account | - | P1 | M | 3 | built | T-434 |
| T-436 | Waiting line for the Check-up slot; runs finish after the tab closes | - | P1 | M | 4 | built | T-435 |
| T-437 | Check-up reports saved in the bucket for 30 days | - | P2 | M | 5 | built | T-436 |
| T-438 | Safe mode for sites without proof | - | P2 | S | 6 | built | T-437 |
| T-439 | Deploy: a runner that sleeps; site container retired | - | P1 | M | 2 | built | T-433 |
| T-440 | Get-started page and invite message | - | P2 | S | 3 | built | T-439 |
