# T-224: ADR 0044 uses the same header as every other ADR and says it is a roadmap

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | inconsistency | built |

**Files you may edit (no others):**
- `docs/adr/0044-expansion-platform-scope-and-roadmap.md` (lines 3-9 only)

**Do not build in parallel with:** T-217 (same file, line 5). Build T-217 first.

## Problem
Every ADR opens with a title, a blank line, one `Status:` line, a blank line, then `## Context`. ADR 0044
opens with bold "Document Reference / Status / Context" lines instead, and its status reads
"Accepted (Architectural Roadmap)" although none of what it describes (Maestro phone-app checks, a public API,
an Electron desktop client) is built. A reader scanning statuses takes it for a built decision.

For comparison, `docs/adr/0043-parallel-page-fetching-in-the-website-audit.md:1-5`:
```markdown
# 0043: Parallel Page Fetching in the Website Audit

Status: Accepted, 2026-11-05 (owner's answers in a grilling session, 2026-11-05). Supersedes ...

## Context
```

## Current code
`docs/adr/0044-expansion-platform-scope-and-roadmap.md:1-13` (branch `worktree-audit-cleanup`; line 5 is shown
as T-217 leaves it)
```markdown
# 0044: Expansion Platform Scope and Architecture Roadmap

**Document Reference:** G23, G24, G25, G26  
**Status:** Accepted (Architectural Roadmap), 2026-11-06  
**Context:** Gaps G23–G26 of the 2026-11 gap analysis identify future platform expansion directions:
- G23: Security Probes on verified test copies
- G24: Phone apps (Maestro integration)
- G25: Public API as an App (programmatic headless execution)
- G26: Desktop client (Electron packaging)

---

## 1. Context & Motivation
```

## Change
1. Replace lines 3-9 (the three bold lines and the four `- G2x` bullets) with exactly:
   ```markdown
   Status: Accepted as a roadmap, 2026-11-06. Nothing in it is built. Each direction needs its own ADR before any code is written.

   Gaps G23 to G26 of the 2026-11 gap analysis name four directions this record scopes:

   - G23: Security Probes on verified test copies
   - G24: Phone apps (Maestro integration)
   - G25: Public API as an App (programmatic headless execution)
   - G26: Desktop client (Electron packaging)
   ```
2. Leave line 1, the `---` line and everything from `## 1. Context & Motivation` down unchanged.

## Tests
`docs/adr/` is in `.prettierignore`, so prettier does not check this file.
```
pnpm exec vitest run packages/runner/tests/adr-0036.test.ts packages/runner/tests/adr-0037-0015.test.ts
```
These greps must print nothing:
```
grep -n "Document Reference\|OPEN_ISSUES" docs/adr/0044-expansion-platform-scope-and-roadmap.md
```
And this must print one line, line 3:
```
grep -n "^Status: " docs/adr/0044-expansion-platform-scope-and-roadmap.md
```

## Done when
- [x] Line 3 is a plain `Status:` line that says nothing is built.
- [x] No "Document Reference" line and no `OPEN_ISSUES` mention.
- [x] The body from `## 1. Context & Motivation` on is unchanged (`git diff` shows changes in lines 3-9 only).

## Notes
- If line 5 still names `docs/OPEN_ISSUES.md`, T-217 has not been built: build it first.
- An ADR is a record. Do not rewrite its sections or renumber its headings.
