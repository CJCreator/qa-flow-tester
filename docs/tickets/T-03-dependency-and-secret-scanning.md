# T-03: Dependabot, audit, secret scan, coverage figure

## Goal
Dependabot, audit, secret scan, coverage figure.

## Gaps covered
G36

## In scope
Workflow files and config.

## Out of scope
Fixing every audit finding (list them; fix only what is trivial).

## Acceptance criteria
- [ ] `.github/dependabot.yml` covers npm and github-actions.
- [ ] CI runs `pnpm audit --prod` and fails on high/critical.
- [ ] CI runs a secret scanner (gitleaks or equivalent) with an allowlist for fixtures.
- [ ] CI prints a coverage summary.
- [ ] No key or `.env` content is read or printed while building this.

## Dependencies
T-01

## ADR needed
none

## Verification commands
```
pnpm audit --prod; actionlint if available
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Scanner false positives on fixtures; third-party actions must be pinned by version.

## Status
todo (wave 0)
