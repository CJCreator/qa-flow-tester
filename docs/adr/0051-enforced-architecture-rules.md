# 0051: Architecture Rules Checked by a Test

Status: Proposed, 2026-11-28 (architecture clean-up, branch `worktree-entropy-reduction`; waiting for the owner's review).

## Context

- The packages already form a clean stack: `types` ← `checkers` ← `core` ← `runner`, with the wizard reading only `@qa/types`. Nothing checked it, and one exception had crept in: the wizard imported `@qa/core/src/audit/improve/fix-rules.js` by path, guarded only by a comment.
- Two pairs of files imported each other (`core/live-site.ts` ↔ `core/competitive/safe-crawler.ts`, `wizard/lib/translate.ts` ↔ `wizard/lib/plan-translate.ts`).
- "Is this host on this machine or a private network?" had four copies (`safe-crawler.ts`, `same-site.ts`, `safe-net.ts` as `isLocalOriginHost`, inline in `browser.ts`). They gave the same answers today, but this is a safety boundary (ADR 0014) and copies drift.

## Decision

- **One test holds the rules:** `packages/runner/tests/architecture.test.ts`, in the `unit` tier, so it runs on every PR and before every deploy. No new dependency.
  1. Each package's source imports only the `@qa` packages below it (table `ALLOWED`).
  2. No import cycle between source files inside a package (type-only imports are ignored).
  3. A helper listed in `CANONICAL` is defined only in its home file; a name in `RETIRED` is never defined again.
- **When copies are merged into one helper, the same change adds a `CANONICAL` row** (and a `RETIRED` row for a dropped name), so the merge cannot quietly come undone.
- **Browser-safe shared rules live in `@qa/types`.** `fix-rules.ts` (rule-based fix options, ADR 0049) moved from `core/src/audit/improve/` to `packages/types/src/` and is exported from both the main and the `browser.js` entry. Core and the wizard import it from `@qa/types`.
- **`isPrivateHost` lives in `core/src/address-class.ts`**, beside the address classifier it is built on. The other copies and the name `isLocalOriginHost` are gone.

## Consequences

- A change that adds a wrong-direction import, a cycle, or a second copy of a listed helper fails `pnpm test` with the file names.
- The rules are a text scan, not a full parser: a dynamic `require` or an import built from a string is not seen. Good enough for this codebase, which uses static ESM imports.
- `@qa/types` is now explicitly "shared types plus browser-safe shared rules", which it already was in practice (`problems.ts`, `display.ts`).
