# Tickets

Statuses: todo, planned, approved, built, done, blocked.

## Open tickets

| id | title | gaps | priority | size | wave | status | depends on |
|---|---|---|---|---|---|---|---|
| [T-52](REVIEW-REMEDIATION-PLAN.md#t-52-container-hardening-and-health) | Container hardening and health | DEP-3, 6, 7, 8, 9 | P1 | M | 8 | human (Docker checks remaining) | T-49, T-51 |
| [T-23](REVIEW-REMEDIATION-PLAN.md#t-23-split-large-files-by-area) | Split large files by area | G35 | P3 | L | 19 | later (deferred class-size refactor) | T-63 |
| QSP-009 | F3 wizard smoke option | - | - | - | - | deferred | - |

Later (no ticket yet): G6, G14, G18-G22, G23-G26, G45, G48.

## Completed ticket tracks (archived in git history)

- **Demo readiness (T-30 to T-40)**: Built. Residual gaps carried forward into review remediation. Ticket files archived in commit `811ab97`.
- **Review remediation (T-41 to T-64)**: 23 of 24 tickets built and verified (commits `e7a6e94` and `6c4b7ce`). See [REVIEW-REMEDIATION-PLAN.md](REVIEW-REMEDIATION-PLAN.md) for full completion status and summary table.
- **qaskills-patterns (QSP-001 to QSP-016)**: Built (except deferred QSP-009). Completed ticket files archived in git history.
