# T-93: A Website Audit must not overwrite the Check-up's run id

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | todo |

**Files you may edit (no others):**
- `packages/runner/src/session/run-slot.ts`
- `packages/runner/tests/run-slot.test.ts`

**Do not build in parallel with:** none.

## Problem

`RunSlot.begin(..., 'audit')` promises: "The Check-up's phase, run id and report stay as they are". But `setRunId`, called by the audit start route (`routes/audit-crawl.ts`, `slot.setRunId(version.auditId)`), writes `_runId` even while an audit holds the slot.

Scenario: finish a Check-up (run id `run-1`), then start a Website Audit. `/api/runner/status.runId` now reports the audit id. On a beta copy `isMine(currentRunId)` fails for the Check-up's owner, and the audit owner gets "No run currently active" from `/api/runner/abort`.

## Current code

`packages/runner/src/session/run-slot.ts:126-131` (branch `worktree-audit-cleanup`)

```ts
  setRunId(runId: string | null): void {
    this._runId = runId;
    if (this._other && runId) {
      this._other.runId = runId;
    }
  }
```

## Change

Replace the method with:

```ts
  setRunId(runId: string | null): void {
    // While an audit (or another non-Check-up run) holds the slot, the id is that run's: the Check-up's stays.
    if (this._other) {
      if (runId) this._other.runId = runId;
      return;
    }
    this._runId = runId;
  }
```

## Tests

Edit `packages/runner/tests/run-slot.test.ts`. Copy the setup from an existing test that calls `begin(..., 'audit')`. Add:

- Name: `'setRunId during an audit leaves the Check-up run id alone'`.
- Steps: create the slot; `slot.setRunId('run-1')`; `slot.begin('audit-tmp', 'https://example.com', 'audit')` (expect `true`); `slot.setRunId('audit_00001')`.
- Expect: `slot.runId === 'run-1'` and `slot.running` equals `{ kind: 'audit', href: '/audits/audit_00001' }`.

If `begin` refuses because of the slot's state in your setup, release or reset the slot the way the neighbouring tests do before `begin`.

Run: `pnpm exec vitest run packages/runner/tests/run-slot.test.ts packages/runner/tests/status-and-run-events.test.ts`, then `pnpm build`.

## Done when

- [ ] `setRunId` no longer writes `_runId` while `_other` is set.
- [ ] New test passes; the two test files pass.

## Notes

- If a test elsewhere expects `status.runId` to be the audit id during an audit, stop and set the ticket to `blocked` with the test name.
- Out of scope: an audit-scoped stop route.
