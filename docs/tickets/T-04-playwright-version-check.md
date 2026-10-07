# T-04: Enforce Playwright version equals Docker image tag

## Goal
Enforce Playwright version equals Docker image tag.

## Gaps covered
G37

## In scope
Script, test, CI step.

## Out of scope
Bumping the version.

## Acceptance criteria
- [ ] A script (`scripts/check-playwright-version.mjs`) compares the package version with the `Dockerfile` tag and exits non-zero on mismatch.
- [ ] CI runs it.
- [ ] A unit test covers match and mismatch.
- [ ] Documented in `docs/DEPLOYMENT.md`.

## Dependencies
T-01

## ADR needed
none

## Verification commands
```
node scripts/check-playwright-version.mjs
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Lockfile format; read only the playwright lines.

## Status
todo (wave 0)
