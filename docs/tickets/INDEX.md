# Tickets

Statuses: todo, planned, approved, built, done, blocked.

## Open tickets

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-52](REVIEW-REMEDIATION-PLAN.md#t-52-container-hardening-and-health) | Container hardening and health | DEP-3, 6, 7, 8, 9 | P1 | M | 8 | human (Docker checks remaining) | T-49, T-51 |
| [T-23](REVIEW-REMEDIATION-PLAN.md#t-23-split-large-files-by-area) | Split large files by area | G35 | P3 | L | 19 | later (deferred class-size refactor) | T-63 |
| QSP-009 | F3 wizard smoke option | - | - | - | - | deferred | - |
| [T-65](FRONTEND-ENHANCEMENT-PLAN.md#t-65-website-audit-in-the-app-navigation) | Website Audit in the app navigation | F1, F2 | P0 | M | 1 | todo | - |
| [T-66](FRONTEND-ENHANCEMENT-PLAN.md#t-66-undefined-style-classes-app-wide) | Undefined style classes, app-wide | F3, F4 | P0 | S | 1 | todo | - |
| [T-68](FRONTEND-ENHANCEMENT-PLAN.md#t-68-helpers-can-load-the-hosted-copy-runner) | Helpers can load the hosted copy (runner) | F5 | P0 | M | 1 | todo | - |
| [T-67](FRONTEND-ENHANCEMENT-PLAN.md#t-67-website-audit-on-the-beta-copy-wizard-side) | Website Audit on the beta copy (wizard side) | F6 | P0 | S | 2 | todo | T-65 |
| [T-69](FRONTEND-ENHANCEMENT-PLAN.md#t-69-audit-journey-links) | Audit journey links | F8, F9, F10, F20 | P1 | M | 2 | todo | - |
| [T-71](FRONTEND-ENHANCEMENT-PLAN.md#t-71-check-up-gaps-from-the-last-session) | Check-up gaps from the last session | F16, F17, F18 | P1 | M | 2 | todo | T-66, T-68 |
| [T-70](FRONTEND-ENHANCEMENT-PLAN.md#t-70-export-downloads-that-report-failure) | Export downloads that report failure | F11 | P1 | S | 3 | todo | T-69 |
| [T-72](FRONTEND-ENHANCEMENT-PLAN.md#t-72-analysis-summary-and-site-areas) | Analysis summary and site areas | F7, F8 | P1 | L | 3 | todo | T-69 |
| [T-74](FRONTEND-ENHANCEMENT-PLAN.md#t-74-mount-the-ai-rewrite-review) | Mount the AI rewrite review | F12 | P1 | S | 3 | todo | T-69 |
| [T-75](FRONTEND-ENHANCEMENT-PLAN.md#t-75-website-audit-settings-complete-and-reachable) | Website Audit settings, complete and reachable | F13 | P1 | S | 3 | todo | T-69, T-71 |
| [T-73](FRONTEND-ENHANCEMENT-PLAN.md#t-73-per-page-detail-and-findings-cards) | Per-page detail and findings cards | F7, F14 | P1 | M | 4 | todo | T-66 |
| [T-76](FRONTEND-ENHANCEMENT-PLAN.md#t-76-helper-aware-audit-screens) | Helper-aware audit screens | F15 | P2 | S | 4 | todo | T-68, T-69 |
| [T-78](FRONTEND-ENHANCEMENT-PLAN.md#t-78-landing-page-and-product-guide) | Landing page and product guide | D2 | P2 | S | 4 | todo | T-71 |
| [T-77](FRONTEND-ENHANCEMENT-PLAN.md#t-77-audit-screens-match-the-shared-ui) | Audit screens match the shared UI | F19 | P2 | M | 5 | todo | all above |

Later (no ticket yet): G6, G14, G18-G22, G23-G26, G45, G48.

## Completed ticket tracks (archived in git history)

- **Demo readiness (T-30 to T-40)**: Built. Residual gaps carried forward into review remediation. Ticket files archived in commit `811ab97`.
- **Review remediation (T-41 to T-64)**: 23 of 24 tickets built and verified (commits `e7a6e94` and `6c4b7ce`). See [REVIEW-REMEDIATION-PLAN.md](REVIEW-REMEDIATION-PLAN.md) for full completion status and summary table.
- **qaskills-patterns (QSP-001 to QSP-016)**: Built (except deferred QSP-009). Completed ticket files archived in git history.
