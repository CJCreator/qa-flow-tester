# T-386: CONTRIBUTING drops stale ADR numbers, and CLAUDE.md says DEFER_TESTS is not enforced in a clone

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | docs | wrong-text | todo |

**Files you may edit (no others):**

- `CONTRIBUTING.md`
- `CLAUDE.md`

**Do not build in parallel with:** T-384 (edits `CLAUDE.md`).

## Problem

Two sentences say things that are not true.

1. `CONTRIBUTING.md:37-38` tells a contributor how to number a new decision record: "the latest is 0023; 0013 and 0015 are reserved and not written yet, so check before numbering". `docs/adr/` now goes up to `0044-expansion-platform-scope-and-roadmap.md`, and `0013-opt-in-ai-explorer-and-selector-fixes.md` and `0015-live-site-request-rules.md` both exist. A contributor who trusts the text would take number 0024, which is already used.
2. `CLAUDE.md:47` says, under "Deferred tests": "While `.claude/work/DEFER_TESTS` exists, do not run any tests (a hook blocks them)." `docs/AGENT_WORKFLOW.md:48` says the opposite: nothing in a clone enforces it, and the hook is not in `.claude/` (the whole `.claude/` folder is git-ignored and not part of a clone, as `CLAUDE.md` itself says under "More docs"). A reader of `CLAUDE.md` alone believes the tests are blocked and may run them anyway, or may think a failed run means something else is wrong.

## Current code

Branch from `main`. `grep -n "latest is" CONTRIBUTING.md` and `grep -n "a hook blocks" CLAUDE.md`.

`CONTRIBUTING.md:37-39`:

```markdown
`docs/adr/NNNN-short-title.md` with `# NNNN: Title`, `## Context and Decision`, `## Consequences`. Use the next unused
number (the latest is 0023; 0013 and 0015 are reserved and not written yet, so check before numbering). Superseded records
get a note at the top rather than being deleted.
```

`CLAUDE.md:45-48`:

```markdown
## Deferred tests

While `.claude/work/DEFER_TESTS` exists, do not run any tests (a hook blocks them). Write the tests, review by reading, builds are fine.
Tickets end `built`. Only `/verify-all`, after every ticket is built, runs tests. Delete the file to turn this off.
```

## Change

1. `CONTRIBUTING.md`: replace the parenthesis so the sentence reads "Use the next unused number: list `docs/adr/` and take the one after the highest." Remove "(the latest is 0023; 0013 and 0015 are reserved and not written yet, so check before numbering)". Keep the rest of the paragraph.
2. `CLAUDE.md`: replace "(a hook blocks them)" with "(a local hook may block them, but `.claude/` is not part of a clone, so nothing enforces this: follow it by hand)". Change nothing else in the file. T-384 edits line 3 of the same file; do not touch it.
3. Run `pnpm exec prettier --check CONTRIBUTING.md CLAUDE.md`.

## Tests

None. Wording only.

## Done when

- [ ] `grep -n "0023\|reserved" CONTRIBUTING.md` prints nothing about ADR numbers.
- [ ] `grep -n "a hook blocks" CLAUDE.md` prints nothing; `grep -n "nothing enforces" CLAUDE.md` finds the new text.
- [ ] Prettier check passes.

## Notes

- Audit finding L3 (audit of 11 Nov 2026 on `d225418`).
- `docs/AGENT_WORKFLOW.md:48` is already right in substance and is not edited. (It says `CLAUDE.md` names the hook file; `CLAUDE.md` does not. Fix that only if the owner wants the file tidied.)
- Conflicts with T-384 (it edits `CLAUDE.md` line 3): build one after the other.
