# T-393: A redaction failure is never silent

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | security | todo |

**Files you may edit (no others):** `packages/core/src/orchestrator.ts` (the teardown block only), `packages/core/tests/orchestrator-redact-every-exit.test.ts`.

**Do not build in parallel with:** T-389, T-409, T-408 (orchestrator chain).

## Problem

`orchestrator.ts:383` reads `if (!redacted) await redactor.files(evidenceDirOf(options)).catch(() => {});`. If redaction throws after a stop or an error, the unredacted evidence stays on disk, with no log line and no note (ADR 0016).

## Change

When redaction fails:
- log the redacted error;
- delete the evidence files that were not redacted;
- add the run note "Could not verify: evidence redaction failed; evidence was deleted".

## Tests

Extend `orchestrator-redact-every-exit.test.ts` with a redactor that throws. Check that the evidence directory ends up empty and the note is present.

## Done when

The test passes, and no exit path keeps unredacted evidence.
