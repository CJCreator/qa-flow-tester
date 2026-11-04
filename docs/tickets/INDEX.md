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

The order of work is `todo` → `planned` → `approved` → `building` → `built` → `done`.

Gap ids: `G*` resolve in [`../GAP_ANALYSIS.md`](../GAP_ANALYSIS.md). Every other id (`F*`, `D*`, `DEP-*`) resolves in the linked plan. Waves order tickets within one plan only. Build a wave once every ticket in the waves before it is `built`.

## Open: frontend enhancement (T-65 to T-78)

Plan: [FRONTEND-ENHANCEMENT-PLAN.md](FRONTEND-ENHANCEMENT-PLAN.md). It makes the Website Audit reachable and shows its results.

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-65](FRONTEND-ENHANCEMENT-PLAN.md#t-65-website-audit-in-the-app-navigation) | Website Audit in the app navigation | F1, F2 | P0 | M | 1 | built | - |
| [T-66](FRONTEND-ENHANCEMENT-PLAN.md#t-66-undefined-style-classes-app-wide) | Undefined style classes, app-wide | F3, F4 | P0 | S | 1 | built | - |
| [T-68](FRONTEND-ENHANCEMENT-PLAN.md#t-68-helpers-can-load-the-hosted-copy-runner) | Helpers can load the hosted copy (runner) | F5 | P0 | M | 1 | built | - |
| [T-67](FRONTEND-ENHANCEMENT-PLAN.md#t-67-website-audit-on-the-beta-copy-wizard-side) | Website Audit on the beta copy (wizard side) | F6 | P0 | S | 2 | built | T-65 |
| [T-69](FRONTEND-ENHANCEMENT-PLAN.md#t-69-audit-journey-links) | Audit journey links | F8, F9, F10, F20 | P1 | M | 2 | built | - |
| [T-71](FRONTEND-ENHANCEMENT-PLAN.md#t-71-check-up-gaps-from-the-last-session) | Check-up gaps from the last session | F16, F17, F18 | P1 | M | 2 | built | T-66, T-68 |
| [T-70](FRONTEND-ENHANCEMENT-PLAN.md#t-70-export-downloads-that-report-failure) | Export downloads that report failure | F11 | P1 | S | 3 | built | T-69 |
| [T-72](FRONTEND-ENHANCEMENT-PLAN.md#t-72-analysis-summary-and-site-areas) | Analysis summary and site areas | F7, F8 | P1 | L | 3 | built | T-69 |
| [T-74](FRONTEND-ENHANCEMENT-PLAN.md#t-74-mount-the-ai-rewrite-review) | Mount the AI rewrite review | F12 | P1 | S | 3 | built | T-69 |
| [T-75](FRONTEND-ENHANCEMENT-PLAN.md#t-75-website-audit-settings-complete-and-reachable) | Website Audit settings, complete and reachable | F13 | P1 | S | 3 | built | T-69, T-71 |
| [T-73](FRONTEND-ENHANCEMENT-PLAN.md#t-73-per-page-detail-and-findings-cards) | Per-page detail and findings cards | F7, F14 | P1 | M | 4 | built | T-66 |
| [T-76](FRONTEND-ENHANCEMENT-PLAN.md#t-76-helper-aware-audit-screens) | Helper-aware audit screens | F15 | P2 | S | 4 | built | T-68, T-69 |
| [T-78](FRONTEND-ENHANCEMENT-PLAN.md#t-78-landing-page-and-product-guide) | Landing page and product guide | D2 | P2 | S | 4 | built | T-71 |
| [T-77](FRONTEND-ENHANCEMENT-PLAN.md#t-77-audit-screens-match-the-shared-ui) | Audit screens match the shared UI | F19 | P2 | M | 5 | built | T-65 to T-76, T-78 |

## Open: carried over from earlier plans

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-52](REVIEW-REMEDIATION-PLAN.md#t-52-container-hardening-and-health) | Container hardening and health | DEP-3, 6, 7, 8, 9 | P1 | M | 8 | human | T-49, T-51 |
| [T-23](REVIEW-REMEDIATION-PLAN.md#t-23-split-large-files-by-area) | Split large files by area | G35 | P3 | L | 19 | later | T-63 |
| QSP-009 | Wizard smoke option (qaskills-patterns F3) | - | - | - | - | later | - |

Gaps with no ticket yet: G6, G14, G18-G22, G23-G26, G45, G48.

## Completed tracks

The ticket files are archived in git history.

- **Demo readiness (T-30 to T-40):** built. Leftover gaps moved to review remediation. Archived in `811ab97`.
- **Review remediation (T-41 to T-64):** built and verified in `e7a6e94` and `6c4b7ce`, except T-52 and T-23 above. Details are in [REVIEW-REMEDIATION-PLAN.md](REVIEW-REMEDIATION-PLAN.md).
- **qaskills-patterns (QSP-001 to QSP-016):** built, except QSP-009 above.
