# Codebase cleanup summary

Branch work, no commits made. Package `src/` dead-code removals are done by per-package agents; merge their lists below from `.claude/work/codebase-cleanup/03-dev-notes-<pkg>.md` (PENDING at time of writing).

## Removed

| Path                                                                      | Reason                                | Evidence                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.pipeline/` (8 files, `e2e-url-credentials-crawl`)                       | Finished work record ("Status: DONE") | Not linked from docs/ADRs; `scripts/clean.mjs` only names it in a protected set; recoverable from git history |
| `yaml` dep in `packages/core/package.json` (+ `pnpm-lock.yaml`, -3 lines) | Unused in core                        | 0 imports in core src/tests; `@qa/checkers` declares its own                                                  |
| Duplicate `.vscode/`, `.review-shots/` lines in `.gitignore`              | Duplicates                            | No ignore-set change                                                                                          |

## Doc fixes

- `docs/README.md` line 11: ADR 0027 "(proposed)" -> "(accepted)" (ADR says Accepted and implemented).
- `CHANGELOG.md`: Removed entry under Unreleased.

## Not removed

- `agent-dashboard/`, `dev-pipeline/`, `pngjs`, `.qa-baselines/`, `fixtures/`, `.claude/`: owner decision to keep (knip flags the first two as unused files; they are Claude plugins outside the workspace).
- `mammoth` in `@qa/core`: knip flags it unused; loaded via `createRequire`, so a dynamic reference.
- `scripts/ship-loop.mjs`: documented in `docs/AGENT_WORKFLOW.md`.
- `packages/wizard/public/*`: Vite source assets, not the generated root `/public`.
- Docs: all unlinked-looking docs are referenced elsewhere; none removed.
- knip unused exports (26 values, 11 types): not removed by this stream; left to package agents (route table, barrel, tests make many false positives).

## Measurements and commands

- `pnpm dlx knip`: no orphan source files in packages.
- `pnpm build` after dep/doc changes: exit 0, no TS errors. Final build after package merges: PENDING.
- `pnpm test`: timed out at 550s; one visible failure `sign-in as consent (ADR 0022) > wrong password` at ~12s (browser sign-in test, unrelated to deleted files; not re-run). Full test run: PENDING.
- No perf changes; nothing measured.
