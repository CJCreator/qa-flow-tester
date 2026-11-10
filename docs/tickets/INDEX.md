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

## Open: Website Audit reliability

Plan: [WEBSITE-AUDIT-RELIABILITY-PLAN.md](WEBSITE-AUDIT-RELIABILITY-PLAN.md). Decisions: [ADR 0042](../adr/0042-website-audit-reliability-and-access.md), [ADR 0043](../adr/0043-parallel-page-fetching-in-the-website-audit.md).

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-86](WEBSITE-AUDIT-RELIABILITY-PLAN.md#t-86-hosted-audits-for-the-signed-in-owner) | Hosted audits for the signed-in owner | A8 | P1 | M | 4 | built | - |
| [T-89](WEBSITE-AUDIT-RELIABILITY-PLAN.md#t-89-proving-the-audit-works) | Proving the audit works | A12 | P1 | M | 4 | todo | - |

## Open: carried over

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| T-23 | Split large files by area | G35 | P3 | L | 19 | later | - |
| QSP-009 | Wizard smoke option (qaskills-patterns F3) | - | - | - | - | later | - |

- **T-23:** later. Partly done: the plan, schedule, Website Audit and health routes live under `packages/runner/src/routes/`. `packages/runner/src/server.ts` is still about 4,100 lines and keeps the inline endpoints listed in `docs/API.md`. Splitting the rest is not scheduled.

## Built work

Built work is in git. Website Audit T-79 to T-85, T-87, T-88, T-90: `fdf287f`, `a4cb689`, `b237983`. Earlier tracks (demo readiness, review remediation, qaskills-patterns) are in earlier history. T-52 (container hardening and health): non-root runner and site images, `/healthz` health checks, `docker-compose.yml`, `docs/CONTAINER_DEPLOYMENT.md`.
