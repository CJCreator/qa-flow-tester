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

The order of work is `todo` → `planned` → `approved` → `building` → `built` → `done`. Waves order tickets within one plan only. Build a wave once every ticket in the waves before it is `built`. Gap ids and other ids resolve in the linked plan; open issues with no ticket are in [../OPEN_ISSUES.md](../OPEN_ISSUES.md).

## Open: Website Audit reliability

Plan: [WEBSITE-AUDIT-RELIABILITY-PLAN.md](WEBSITE-AUDIT-RELIABILITY-PLAN.md). Decisions: [ADR 0042](../adr/0042-website-audit-reliability-and-access.md), [ADR 0043](../adr/0043-parallel-page-fetching-in-the-website-audit.md).

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-86](WEBSITE-AUDIT-RELIABILITY-PLAN.md#t-86-hosted-audits-for-the-signed-in-owner) | Hosted audits for the signed-in owner | A8 | P1 | M | 4 | todo | - |
| [T-89](WEBSITE-AUDIT-RELIABILITY-PLAN.md#t-89-proving-the-audit-works) | Proving the audit works | A12 | P1 | M | 4 | todo | - |

## Open: carried over

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| T-52 | Container hardening and health | DEP-3, 6, 7, 8, 9 | P1 | M | 8 | done | - |
| T-23 | Split large files by area | G35 | P3 | L | 19 | later | - |
| QSP-009 | Wizard smoke option (qaskills-patterns F3) | - | - | - | - | later | - |

- **T-52:** done. Hardened `packages/runner/Dockerfile` with non-root `USER qa`, `/healthz` HEALTHCHECK, and container isolation over Chromium `--no-sandbox`. Hardened `site/Dockerfile` with non-root `nginx-unprivileged` and native `HEALTHCHECK`. Provided full-stack `docker-compose.yml` and `docs/CONTAINER_DEPLOYMENT.md`.
- **T-23:** deferred until verification is green. Split by file as sub-tickets T-23a.. (`server.ts`, `orchestrator.ts`, `types/src/index.ts`, `App.tsx`): pure structural moves, no behavior change, public exports unchanged, full suite green before and after, each file ends at an agreed smaller size.

## Built work

Built work is in git. Website Audit T-79 to T-85, T-87, T-88, T-90: `fdf287f`, `a4cb689`, `b237983`. Earlier tracks (demo readiness, review remediation, qaskills-patterns) are in earlier history.
