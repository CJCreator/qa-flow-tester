# T-20: ADR 0016: redaction

## Goal
ADR 0016: redaction.

## Gaps covered
G27

## In scope
One ADR (via /adr).

## Out of scope
Behaviour change.

## Acceptance criteria
- [x] `docs/adr/0016-*.md` records the shipped redaction behaviour, citing the code files.
- [x] It is listed wherever ADRs are indexed.
- [x] Notes that 0013 and 0015 are written with G22 and G14, and 0014 and 0017 with T-12 and T-16.

## Dependencies
none

## ADR needed
0016

## Verification commands
```
grep -rn "0016" docs
```
Test runs are deferred (DEFER_TESTS): they happen in the wave's /verify-all, not during build.

## Risks
The ADR must describe the code as it is.

## Status
built (wave 3), docs only, not run (verify-all)
