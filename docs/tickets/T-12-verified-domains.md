# T-12: Verified Domains and hardened isTestHost

## Goal
Verified Domains and hardened isTestHost.

## Gaps covered
G11, G27 (ADR 0014)

## In scope
`live-site.ts`, runner routes, ADR, tests.

## Out of scope
Security Probes (G23).

## Acceptance criteria
- [ ] ADR 0014 written and approved before code.
- [ ] `isTestHost` resolves DNS and rejects private, loopback, link-local and metadata addresses, including via redirects and DNS rebinding (a test per class).
- [ ] A Verified Domain proof mechanism per the ADR gates anything beyond read-only on hosted use.
- [ ] Host confinement and read-only default unchanged unless the ADR says so (tests prove it).
- [ ] `SECURITY.md`, `docs/API.md`, `docs/CONFIGURATION.md` updated.

## Dependencies
none

## ADR needed
0014

## Verification commands
```
pnpm exec vitest run packages/core packages/runner -t "isTestHost"
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
Safety-critical: any loosening needs ADR + test. Owner approves the ADR.

## Status
todo (wave 1)
