# T-02: ESLint and Prettier configured and runnable

## Goal
ESLint and Prettier configured and runnable.

## Gaps covered
G5

## In scope
Config, deps, CI step, minimal fixes.

## Out of scope
Large rule-driven refactors; touching generated output.

## Acceptance criteria
- [ ] `eslint.config.*` and `.prettierrc` exist; ESLint is a devDependency.
- [ ] `pnpm lint` exits 0 on the repo (violations fixed or narrowly ignored with a reason, never blanket-disabled).
- [ ] Prettier check passes after one format commit.
- [ ] CI runs lint.
- [ ] `CONTRIBUTING.md` documents both.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm lint; pnpm exec prettier --check .
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
A first format pass makes a noisy diff; do it as its own commit. Ignore `.qa-*`, `public/`, build output.

## Status
todo (wave 0)
