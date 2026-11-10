# T-223: CHANGELOG points at two folders that do not exist

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | docs | todo |

**Files you may edit (no others):**
- `CHANGELOG.md`

**Do not build in parallel with:** none.

## Problem
Two CHANGELOG entries send the reader to files that are not in the repository:

- Line 10 ends "details in `docs/handoffs/codebase-cleanup-summary.md`". There is no `docs/handoffs/` folder.
- Line 59 says "its summary in `docs/research/`". There is no `docs/research/` folder.

## Current code
`CHANGELOG.md:10` (branch `worktree-audit-cleanup`)
```markdown
- Finished `.pipeline/e2e-url-credentials-crawl` records, unused `yaml` dependency from `@qa/core`, duplicate `.gitignore` lines; details in `docs/handoffs/codebase-cleanup-summary.md`
```
`CHANGELOG.md:59`
```markdown
- Docs: repeatable self Check-up of the landing page (`docs/TESTING.md`) and its summary in `docs/research/` (T-15)
```

## Change
1. Line 10: delete the tail `; details in `docs/handoffs/codebase-cleanup-summary.md``, so the line reads:
   ```markdown
   - Finished `.pipeline/e2e-url-credentials-crawl` records, unused `yaml` dependency from `@qa/core`, duplicate `.gitignore` lines
   ```
2. Line 59: delete ` and its summary in `docs/research/``, so the line reads:
   ```markdown
   - Docs: repeatable self Check-up of the landing page (`docs/TESTING.md`) (T-15)
   ```
3. Change nothing else. Do not add an entry for this ticket.

## Tests
```
pnpm format:check
pnpm exec vitest run packages/runner/tests/release-workflow.test.ts
```
This grep must print nothing:
```
grep -n "docs/handoffs\|docs/research" CHANGELOG.md
```

## Done when
- [ ] Neither folder is named in `CHANGELOG.md`.
- [ ] `release-workflow.test.ts` still passes (it requires a `## [0.1.0]` section in the CHANGELOG).

## Notes
- The entries are history: keep what was done, drop only the pointer to a file that is gone.
- `.prettierignore` also lists `docs/research/`; that is handled in T-228.
