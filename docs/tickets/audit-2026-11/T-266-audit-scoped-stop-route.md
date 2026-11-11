# T-266: `POST /api/audits/:id/stop`, a Stop that only touches that Website Audit

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | runner | bug | todo |

**Files you may edit (no others):**

- `packages/types/src/website-audit.ts`
- `packages/runner/src/routes/audit-crawl.ts`
- `packages/runner/tests/audit-crawl-route.test.ts`
- `packages/types/tests/website-audit.test.ts`
- `docs/API.md`

**Do not build in parallel with:** nothing open (T-95 and T-109, the last tickets to edit `audit-crawl.ts`, are built). Do not run it beside any new ticket that edits `audit-crawl.ts`, `packages/types/src/website-audit.ts` or `docs/API.md`.

## Problem

T-93, T-96 and T-189 each end with "out of scope: an audit-scoped stop route". It does not exist. The Website Audit Stop button calls the shared `POST /api/runner/stop`. That route stops "whatever is running":

1. If a Website Audit is active it stops that one, whichever audit the caller meant.
2. If no audit is active it falls through to `checkupRun.stop(...)`, so a Stop pressed on an old audit screen can stop a Check-up that someone else started, or discard its plan (`discard` in the body).
3. On a shared beta copy, `betaScope` answers it with "No run currently active" for a caller who does not own the current run, so an audit owner may get a false "nothing to stop".

An audit-scoped route names the audit in the address, can only ever stop that audit's run, and never touches a Check-up.

## Current code

Branch `worktree-audit-followup-tickets`. Find with `grep -n "handleAbortRun" packages/runner/src/server.ts` and `grep -n "export function createAuditCrawlRoutes" packages/runner/src/routes/audit-crawl.ts`.

`packages/runner/src/server.ts`, in `handleAbortRun` (leave this route as it is):

```ts
// Check if an active Website Audit run is present and stop it (STK-001)
const activeAudit = getAuditRunsForServer(this)?.active;
if (activeAudit) {
  activeAudit.controller.abort();
  this.sendJson(res, 200, { aborted: true, code: 'ERR_RUN_ABORTED', message: 'Website Audit stopped successfully' });
  return;
}
const result = await this.checkupRun.stop(body);
```

`packages/runner/src/session/audit-run.ts` (already there):

```ts
export class AuditRuns {
  get(auditId: string): AuditRun | undefined { ... }
  /** The run that has not ended yet, if any. */
  get active(): AuditRun | undefined { ... }
}
// AuditRun: get finished(): boolean   (true once 'done' or 'failed' was sent)
//           stop(): void             (asks the run to stop; the run records the outcome)
```

`packages/runner/src/routes/audit-crawl.ts`:

```ts
function row(key: 'start' | 'stream', handle: Route['handle']): Route & { method: string; access: AuditAccess } {
  const { method, path: routePath, access } = AUDIT_API[key];
  // Closed on a beta copy (D-004): only 'public' Shared Link rows are served there.
  return { method, path: routePath, access, beta: 'closed', handle };
}
```

```ts
export function createAuditCrawlRoutes(deps: AuditCrawlRouteDeps): Route[] {
  const runs = deps.runs ?? new AuditRuns();
  ...
  const start = row('start', async (context) => {
    const { req, res } = context;
    const caller = await deps.caller(context);
    if (!caller.owner) return refuse(res, 403, 'ERR_FORBIDDEN', AUDIT_FORBIDDEN_START);
  ...
  return [start, stream];
}
```

`packages/types/src/website-audit.ts`:

```ts
  rerun: { method: 'POST', path: '/api/audits/:id/rerun', replies: 'json', access: 'owner' },
```

and in `AuditApiShapes`:

```ts
rerun: {
  query: NoQuery;
  body: undefined;
  reply: AuditStartReply;
}
```

`packages/runner/tests/audit-crawl-route.test.ts` has `describe('route rows')` asserting `expect(rows).toHaveLength(2)` and a `'a stop marks the version stopped...'` test that stops a run through `runs.get(id)!.stop()`.

## Change

1. `packages/types/src/website-audit.ts`: add after `rerun` in `AUDIT_API`:

```ts
  /**
   * Stops the Website Audit's running version and nothing else. 202 `AuditStopReply { stopped: true }` when the
   * stop was asked for (the version is saved as 'stopped' a moment later); 200 `{ stopped: false, message }` when
   * that audit is not running. Never touches a Check-up.
   */
  stop: { method: 'POST', path: '/api/audits/:id/stop', replies: 'json', access: 'owner' },
```

Add the reply type next to `AuditStartReply`:

```ts
export interface AuditStopReply {
  /** True when a running version was asked to stop. */
  stopped: boolean;
  /** Set when `stopped` is false: why nothing was stopped. */
  message?: string;
}
```

and in `AuditApiShapes` after `rerun`: `stop: { query: NoQuery; body: undefined; reply: AuditStopReply };`.

2. `audit-crawl.ts`: widen `row`'s key type to `'start' | 'stream' | 'stop'`. Add the constant next to `AUDIT_STOPPED`:

```ts
export const AUDIT_FORBIDDEN_STOP = 'Only the owner of this QA Tool can stop a Website Audit.';
export const AUDIT_NOT_RUNNING = 'This Website Audit is not running, so there is nothing to stop.';
```

Add the handler after `stream` and return it:

```ts
const stop = row('stop', async (context) => {
  const { res } = context;
  const caller = await deps.caller(context);
  if (!caller.owner) return refuse(res, 403, 'ERR_FORBIDDEN', AUDIT_FORBIDDEN_STOP);
  const run = runs.get(context.params?.id ?? '');
  if (!run || run.finished) {
    const reply: AuditStopReply = { stopped: false, message: AUDIT_NOT_RUNNING };
    return sendJson(res, 200, reply);
  }
  run.stop();
  const reply: AuditStopReply = { stopped: true };
  sendJson(res, 202, reply);
});

return [start, stream, stop];
```

Import `type AuditStopReply` from `@qa/types` with the other type imports. Update the doc comment above `createAuditCrawlRoutes` to say "start, stream and stop rows".

3. The route table is built from the contract, so `routes/index.ts` needs no change: `contractRows` adds the row and `buildAuditRoutes` finds the handler by `POST /api/audits/:id/stop`. `docs/API.md`: add under the `POST /api/audits/:id/rerun` row:

```
| `POST /api/audits/:id/stop`                    | owner      | Stops that audit's running version only, never a Check-up. `202 { stopped: true }`; `200 { stopped: false, message }` when it is not running. |
```

Then `pnpm exec prettier --write docs/API.md` (it realigns the table).

4. Run `pnpm exec prettier --write` on the changed source files and `pnpm build` (types first, then runner: the build order does this).

## Tests

`packages/runner/tests/audit-crawl-route.test.ts`:

- In `describe('route rows')`, change `toHaveLength(2)` to `3`, destructure `const [start, stream, stop] = rows;` and add `expect([stop.method, stop.path, stop.access]).toEqual([AUDIT_API.stop.method, AUDIT_API.stop.path, 'owner']);` and `expect(stop.beta).toBe('closed');`.
- Add `describe('POST /api/audits/:id/stop', ...)` with these tests. Add a helper `async function stopPost(base: string, id: string) { const res = await fetch(\`${base}/api/audits/${id}/stop\`, { method: 'POST' }); return { status: res.status, json: await res.json() }; }`. Start runs the way the test `'a stop marks the version stopped...'`does (a`crawlImpl`that rejects with`abortError()`on abort,`post(base, VALID)`, `waitFor(() => crawlCalls.length === 1)`).
  - `'stops the running audit and saves the version as stopped'`: start a run; `stopPost(base, json.auditId)` gives status 202 and body `{ stopped: true }`; `await waitFor(runEnded(json.auditId))`; `(await store.getVersion(json.auditId, 1))?.status` is `'stopped'`; `slot.kind` is null.
  - `'says so when the audit is not running'`: after a run has finished (use the default crawl and `waitFor(runEnded(id))`), `stopPost` gives 200 and `{ stopped: false, message: AUDIT_NOT_RUNNING }` (import `AUDIT_NOT_RUNNING`).
  - `'says so for an audit this runner has no run for'`: `stopPost(base, 'audit_99999')` gives 200 `stopped: false`. (Use an id that matches `AUDIT_ID_PATTERN`; copy the shape of the ids the other tests use.)
  - `'never stops a Check-up'`: a Check-up holds the slot and no audit run exists: `slot.begin('run-1', 'https://example.com')` then `slot.setIsRunning(true)` (check `slot.kind === 'checkup'` before you go on; see `run-slot.test.ts`). `stopPost(base, 'audit_00001')` gives `stopped: false` and `slot.kind` is still `'checkup'`.
  - `'refuses a caller who is not the owner'`: `caller = { owner: false, helperEmail: 'helper@example.com' }`; status 403 and `json.code` `'ERR_FORBIDDEN'`; the run keeps going (start one first and check `runs.get(id)!.finished` is false before releasing the crawl gate).
  - `'a second stop while the first is still ending is fine'`: two `stopPost` calls in a row both answer without a 5xx.

`packages/types/tests/website-audit.test.ts`: in the `'lists every audit endpoint the later tasks use'` list add `['POST', '/api/audits/:id/stop']` after the rerun entry.

Run: `pnpm exec vitest run packages/runner/tests/audit-crawl-route.test.ts packages/runner/tests/audit-route-registration.test.ts packages/types/tests/website-audit.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "stop: {" packages/types/src/website-audit.ts` shows the `AUDIT_API` entry and the `AuditApiShapes` entry.
- [ ] `POST /api/audits/:id/stop` appears in `docs/API.md`.
- [ ] `audit-route-registration.test.ts` passes (exactly one row per contract entry, closed on beta).
- [ ] The three test files pass and `pnpm build` passes.

## Notes

- Do not change `POST /api/runner/stop` or `/abort`: the Check-up Stop button and the beta scope rules still use them, and their audit branch stays as a fallback until the wizard moves over.
- Follow-up (not in this ticket, needs its own wizard ticket): `stopAudit` in `packages/wizard/src/screens/audit/start/audit-start-api.ts` (used by `LivePageList.tsx` and the progress screen, T-189) should call `POST /api/audits/:id/stop` with the audit id and read `stopped` instead of `aborted`.
- ADR 0042 covers the one-run-at-a-time slot; this route does not change it. No new ADR.
