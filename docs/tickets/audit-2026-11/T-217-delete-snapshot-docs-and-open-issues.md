# T-217: Delete the dated snapshot docs and `OPEN_ISSUES.md`, and fix what points at them

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | dead-code | built |

**Files you may edit (no others):**
- `PRODUCT_REVIEW.md` (delete)
- `Requirements.txt` (delete)
- `docs/SELF_AUDIT.md` (delete)
- `docs/VERIFICATION_JOURNEY.md` (delete)
- `docs/LANDING_AUDIT_REPORT.md` (delete)
- `docs/Audit QA checkup.md` (delete)
- `docs/Website audits.md` (delete)
- `docs/OPEN_ISSUES.md` (delete)
- `docs/README.md`
- `docs/PRODUCT_GUIDE.md`
- `docs/tickets/INDEX.md` (line 21 only)
- `docs/adr/0011-ai-asked-only-what-facts-cannot-say.md` (line 6 only)
- `docs/adr/0033-website-audit-entry-point.md` (line 6 only)
- `docs/adr/0044-expansion-platform-scope-and-roadmap.md` (line 5 only)

**Do not build in parallel with:** T-218 (`docs/tickets/INDEX.md`), T-221 (`docs/README.md`), T-224 (ADR 0044).
Build T-217 first.

## Problem
Seven files are one-off snapshots that nothing indexes and whose claims cannot be checked from the repository:

| file | what it is |
|---|---|
| `PRODUCT_REVIEW.md` | product review dated 2026-09-30; links to `.review-shots/*.png`, which are not committed |
| `Requirements.txt` | tab-separated FR-1..FR-33 list for the Website Audit; the name looks like a Python file |
| `docs/SELF_AUDIT.md`, `docs/VERIFICATION_JOURNEY.md`, `docs/LANDING_AUDIT_REPORT.md` | 2026-11-06 notes claiming a "READY TO RELEASE (PASS)" verdict, "100% Lighthouse", "3m 42s at $0.00" |
| `docs/Audit QA checkup.md`, `docs/Website audits.md` | pasted QA reports on arocord.com and httpbin.org; the only docs with spaces in their names |

`docs/OPEN_ISSUES.md` is titled "Open issues" and indexed as "Known problems not yet fixed", but its body is a
table of closed items that ends "There are no remaining open issues. The repository is production-ready." It
competes with `docs/tickets/INDEX.md`, which `CLAUDE.md` names as the open-work list. Several of its rows
describe things this ticket series removes (SARIF export, self-healing, release publishing, paid tiers).

Owner decision (2026-11-10): delete all of them. They stay in git history.

## Current code
Every reference (branch `worktree-audit-cleanup`):

`docs/README.md:19`
```markdown
| [`OPEN_ISSUES.md`](OPEN_ISSUES.md)                 | Known problems not yet fixed, with file locations                               |
```
`docs/PRODUCT_GUIDE.md:116`
```markdown
- **Save key** (AI key field): off until the key checks as valid. No reason line yet; the status line under the field shows the error for a wrong key (OPEN_ISSUES W20, the rest of the screens).
```
`docs/tickets/INDEX.md:21` (last sentence of the line)
```markdown
Gap ids and other ids resolve in the linked plan; open issues with no ticket are in [../OPEN_ISSUES.md](../OPEN_ISSUES.md).
```
`docs/adr/0011-ai-asked-only-what-facts-cannot-say.md:6`
```markdown
The product review of 2026-09-30 (PRODUCT_REVIEW.md, T1–T3) found that free AI models rarely produced a usable plan:
```
`docs/adr/0033-website-audit-entry-point.md:6` (start of the line)
```markdown
`Requirements.txt` (FR-1 to FR-33) describes a tool that audits other people's websites in order to pitch repair or redesign work:
```
`docs/adr/0044-expansion-platform-scope-and-roadmap.md:5`
```markdown
**Context:** G23–G26 in `docs/OPEN_ISSUES.md` identify future platform expansion directions:
```

## Change
1. Delete the eight files (quote the two names with spaces):
   ```
   git rm PRODUCT_REVIEW.md Requirements.txt docs/SELF_AUDIT.md docs/VERIFICATION_JOURNEY.md docs/LANDING_AUDIT_REPORT.md "docs/Audit QA checkup.md" "docs/Website audits.md" docs/OPEN_ISSUES.md
   ```
2. `docs/README.md`: delete the whole `OPEN_ISSUES.md` table row (line 19).
3. `docs/PRODUCT_GUIDE.md:116`: replace `(OPEN_ISSUES W20, the rest of the screens)` with
   `(gap W20, the rest of the screens)`.
4. `docs/tickets/INDEX.md:21`: replace
   `Gap ids and other ids resolve in the linked plan; open issues with no ticket are in [../OPEN_ISSUES.md](../OPEN_ISSUES.md).`
   with `Gap ids and other ids resolve in the linked plan.` Keep the rest of the line.
5. `docs/adr/0011-...md:6`: replace `(PRODUCT_REVIEW.md, T1–T3)` with
   `(findings T1–T3; the review file was removed in 2026-11 and is in git history)`.
6. `docs/adr/0033-...md:6`: replace the opening `` `Requirements.txt` (FR-1 to FR-33) describes `` with
   ``The requirements list FR-1 to FR-33 (`Requirements.txt`, removed in 2026-11, in git history) describes ``.
   Keep the rest of the line.
7. `docs/adr/0044-...md:5`: replace ``G23–G26 in `docs/OPEN_ISSUES.md` identify`` with
   `Gaps G23–G26 of the 2026-11 gap analysis identify`.

## Tests
```
pnpm exec vitest run packages/runner/tests/config-docs.test.ts
pnpm exec prettier --write docs/README.md docs/PRODUCT_GUIDE.md
pnpm format:check
```
This grep must print nothing:
```
grep -rn "PRODUCT_REVIEW\.md\|SELF_AUDIT\|VERIFICATION_JOURNEY\|LANDING_AUDIT_REPORT\|Audit QA checkup\|Website audits\.md\|OPEN_ISSUES\.md" --include=*.md --include=*.ts --include=*.tsx --include=*.mjs --include=*.yml --include=*.json . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.claude --exclude-dir=tickets
grep -n "\.\./OPEN_ISSUES" docs/tickets/INDEX.md
```
(`--exclude-dir=tickets` skips `docs/tickets/`, whose ticket files name these docs; the second grep checks the
one link in `INDEX.md`. `Requirements.txt` stays named once, in ADR 0033, as history.)

## Done when
- [x] The eight files are gone.
- [x] `config-docs.test.ts` passes (it checks every link in `docs/README.md`).
- [x] Both greps print nothing.
- [x] `pnpm format:check` passes.

## Notes
- Leave these four code comments alone. They cite old issue ids (C1, C4, C5), not the file:
  `packages/core/tests/finding-groups-scope.test.ts:21`, `packages/core/tests/scoring.test.ts:285`,
  `packages/types/src/verdict.ts:147`, `packages/types/tests/verdict-gate.test.ts:88`.
- `docs/adr/` and `docs/tickets/` are in `.prettierignore`; do not run prettier on them.
- ADRs are records: change only the words named above, nothing else in those files.
- `docs/LEGAL_AND_LICENSES.md` and `docs/GTM_AND_PRICING.md` stay (T-219, T-225).
