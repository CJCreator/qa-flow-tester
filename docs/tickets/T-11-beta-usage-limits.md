# T-11: Per-visitor and daily limits on the hosted beta

## Goal
Per-visitor and daily limits on the hosted beta.

## Gaps covered
G10

## In scope
`runner/src/beta.ts` and tests.

## Out of scope
Persistent storage; second host.

## Acceptance criteria
- [ ] Per-visitor (token/session, not raw IP only) and daily caps return a clear error; values come from env with documented defaults.
- [ ] Existing 50-session cap and 24 h life unchanged (test).
- [ ] Limits reset daily (test with injected clock).
- [ ] `docs/CONFIGURATION.md`, `docs/API.md`, `docs/DEPLOYMENT.md` updated.
- [ ] Real-run proof and the second host are in HUMAN_TODO.

## Dependencies
none

## ADR needed
none

## Verification commands
```
pnpm exec vitest run packages/runner -t "beta"
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
In-memory state resets on Render restart; document it.

## Status
todo (wave 1)
