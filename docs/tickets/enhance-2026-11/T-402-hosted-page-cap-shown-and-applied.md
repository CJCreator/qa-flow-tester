# T-402: The hosted page cap is shown and applied the same way

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner, wizard | ux, limits | todo |

**Files you may edit (no others):**
- `packages/runner/src/server.ts` (the `/api/runner/status` field only)
- `packages/runner/src/routes/audit-crawl.ts`, `packages/runner/src/routes/audit-rerun.ts`
- `packages/wizard/src/screens/audit/start/audit-start-form.ts`, `packages/wizard/src/screens/audit/start/AuditStartScreen.tsx`
- tests

**Do not build in parallel with:** T-392, T-394 (runner chain); T-396 (wizard).

## Problem

- **The form allows too much:** its bound is a fixed 1000 (`audit-start-form.ts:30-38`), and its hint reads "From 1 to 1000". The hosted copy then refuses anything above 200 with a 400 (`audit-crawl.ts:517-521`).
- **Start and re-run disagree:** a hosted re-run is cut down to the cap without a word (`:334-335`), while a start over the cap is refused.

## Change

- `/api/runner/status` returns `auditMaxPages`. The form uses it as the bound and the hint: "From 1 to 200 on this shared copy. Larger sites: run your own copy."
- A re-run over the cap is refused with the same message as a start.

## Tests

- The form bound follows the status value.
- A hosted re-run over the cap answers 400 with `AUDIT_HOSTED_PAGES`.

## Done when

Both tests pass.
