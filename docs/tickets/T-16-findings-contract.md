# T-16: Findings contract and its outputs

## Goal
Findings contract and its outputs.

## Gaps covered
G12, G27 (ADR 0017)

## In scope
Types, core report, runner CI command, docs.

## Out of scope
Trend strip and release record if they need persistence (split out).

## Acceptance criteria
- [ ] ADR 0017 approved first.
- [ ] `findings.json` has `schemaVersion` and a per-finding fingerprint; a JSON Schema under `docs/` validates real output (test).
- [ ] `fix-these.md`, `known-findings.json` and an AGENTS.md snippet are generated.
- [ ] GitHub annotations output from the CI command.
- [ ] Old shape stays compatible or the bump is documented.
- [ ] `docs/API.md` updated.

## Dependencies
none

## ADR needed
0017

## Verification commands
```
pnpm build; pnpm exec vitest run packages/core packages/runner packages/types
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Public contract: version it.

## Status
built (wave 3, tests deferred)
