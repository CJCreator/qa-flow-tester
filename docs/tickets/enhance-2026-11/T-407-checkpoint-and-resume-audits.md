# T-407: Checkpoint and Resume for audits

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | L | core, runner, wizard | reliability | todo |

**Files you may edit (no others):**
- core: `packages/core/src/audit/crawl/crawl.ts`, `packages/core/src/discovery/frontier.ts` (serialize/restore), `packages/core/src/audit/pipeline/pipeline.ts`, `packages/core/src/audit/store/audit-store.ts`
- runner: `packages/runner/src/server.ts` (`recoverRunningAudits`), `packages/runner/src/routes/audit-crawl.ts` (a resume route)
- wizard: `packages/wizard/src/screens/audit/results/AnalysisScreen.tsx`, `packages/wizard/src/screens/audit/saved/AuditHistoryScreen.tsx`
- `docs/API.md`
- tests

**Depends on:** T-406.

## Problem

- **A restart loses the run:** on start-up, versions left running are marked stopped with reason `tool-restarted` (`docs/ARCHITECTURE.md:45`). Nothing can be resumed.
- **Closing the tab stalls a hosted audit:** it gets CPU only while its progress stream is open (ADR 0043:6), and `deploy.yml` has no `--no-cpu-throttling`.
- **Verify first:** whether the hosted crawl runs inside the 3600 s request.

## Change

- **Checkpoint:** every 25 recorded pages, save a checkpoint to the audit store. It holds the frontier (queued, visited, shape counts), the recorded pages, the skipped pages, and which stage each page has finished.
- **On start-up:** a version that has a checkpoint is marked `paused` (reason `tool-restarted`), not `stopped`.
- **Resume:** `POST /api/audits/:id/resume` continues from the checkpoint with the same limits.
- **Hosted copy:** the progress screen shows "Keep this tab open: on this shared copy the audit pauses when the tab closes. You can resume it later."
- **Paused audits:** shown in Saved audits with a **Resume** button.

## Tests

- Stopping after 60 of 100 routed pages, then resuming, records 100 pages with no duplicates.
- A runner restart leaves the version `paused` and resumable.

## Done when

The tests pass. On the hosted copy, an audit whose tab was closed for 5 minutes resumes and finishes.
