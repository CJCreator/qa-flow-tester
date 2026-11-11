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

## Open: audit follow-up (November 2026)

One file per ticket under [audit-2026-11/](audit-2026-11/). Each file names the files it may edit and the tickets it must not be built beside.

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-226](audit-2026-11/T-226-ci-and-deploy-share-audit-and-secret-scan.md) | CI and Deploy share one audit job and one secret-scan job | - | P3 | M | 1 | todo | - |
| [T-227](audit-2026-11/T-227-quality-gate-timeout-and-stale-comment.md) | Give the CI quality gate a workable timeout | - | P3 | S | 2 | todo | T-226 |
| [T-228](audit-2026-11/T-228-run-plugin-checks-in-ci.md) | Run the plugin checks in CI | - | P3 | S | 3 | todo | T-227 |
| [T-225](audit-2026-11/T-225-pin-third-party-actions-to-commit-sha.md) | Pin every GitHub Action to a commit SHA | - | P2 | S | 4 | todo | T-228 |
| [T-229](audit-2026-11/T-229-remove-unused-coverage-setup.md) | Remove the coverage setup nothing runs | - | P3 | S | 1 | todo | - |
| [T-230](audit-2026-11/T-230-test-run-completed-reaches-on-event.md) | Test that the finished-run event reaches `onEvent` | - | P3 | S | 1 | todo | - |

T-225 to T-228 all edit `.github/workflows/ci.yml`, so they are built one after another in the order above. T-229 and T-230 touch other files and can be built beside them.

## Open: carried over

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| T-23 | Split large files by area | G35 | P3 | L | 19 | later | - |
| QSP-009 | Wizard smoke option (qaskills-patterns F3) | - | - | - | - | later | - |

- **T-23:** later. Partly done: the plan, schedule, Website Audit and health routes live under `packages/runner/src/routes/`. `packages/runner/src/server.ts` is still about 4,100 lines and keeps the inline endpoints listed in `docs/API.md`. Splitting the rest is not scheduled.

## Built work

Built work is in git. Audit of November 2026, T-91 to T-224 (134 tickets, all built and verified on `d225418`): the ticket files stay under [audit-2026-11/](audit-2026-11/). Website Audit T-79 to T-85, T-87, T-88, T-90: `fdf287f`, `a4cb689`, `b237983`. Earlier tracks (demo readiness, review remediation, qaskills-patterns) are in earlier history. T-52 (container hardening and health): non-root runner and site images, `/healthz` health checks, `docker-compose.yml`, `docs/CONTAINER_DEPLOYMENT.md`.
