# T-96: Shutdown stops a running Website Audit and closes its streams

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | todo |

**Files you may edit (no others):**
- `packages/runner/src/server.ts`

**Do not build in parallel with:** T-91, T-92, T-94, T-97, T-99, T-100, T-106, T-108, T-110, T-112 (all edit `server.ts`).

## Problem

`shutdown()` stops a running Check-up but not a running Website Audit, and `stop()` only ends the Check-up event streams. An open `GET /api/audits/:id/stream` connection keeps `server.close()` waiting.

Scenario: Cloud Run sends SIGTERM during a Website Audit. The audit's browser keeps running and the process only exits when the 15 s force-exit fires. The comment in `routes/index.ts:84` says shutdown stops audits; it does not.

## Current code

`packages/runner/src/server.ts` (branch `worktree-audit-cleanup`; find with `grep -n "public async shutdown" packages/runner/src/server.ts`)

```ts
  public async shutdown(): Promise<void> {
    await this.checkupRun.stop().catch(() => {});
    await this.stop();
  }
```

```ts
  public async stop(): Promise<void> {
    this.scheduler.stop();
    if (this.beta) setBrowserPolicy(null);
    // Open event streams would otherwise keep the server from ever finishing its close.
    for (const client of this.streamClients) client.end();
    this.streamClients.clear();
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
```

The way a Website Audit is stopped today, in the abort handler of the same file:

```ts
    const activeAudit = getAuditRunsForServer(this)?.active;
    if (activeAudit) {
      activeAudit.controller.abort();
```

## Change

1. Replace `shutdown()` with:

```ts
  public async shutdown(): Promise<void> {
    // A running Website Audit is stopped too: its browser must not outlive the server.
    getAuditRunsForServer(this)?.active?.controller.abort();
    await this.checkupRun.stop().catch(() => {});
    await this.stop();
  }
```

2. In `stop()`, replace the `return new Promise(...)` block with:

```ts
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        // Website Audit streams and idle keep-alive connections would keep close() waiting.
        this.server.closeAllConnections?.();
      } else {
        resolve();
      }
    });
```

`getAuditRunsForServer` is already imported in `server.ts`.

## Tests

No unit test starts a real audit at shutdown. Verify by build and by the existing suites:

`pnpm build`, then `pnpm exec vitest run packages/runner/tests/shutdown.test.ts packages/runner/tests/health-route.test.ts packages/runner/tests/status-and-run-events.test.ts`

Add no new test file.

## Done when

- [ ] `shutdown()` aborts the active Website Audit before stopping the server.
- [ ] `stop()` calls `closeAllConnections` after `close`.
- [ ] Build and the three test files pass.

## Notes

- `closeAllConnections` exists on Node 18.2+; the `?.` keeps test doubles working.
- Out of scope: an audit-scoped stop route.
