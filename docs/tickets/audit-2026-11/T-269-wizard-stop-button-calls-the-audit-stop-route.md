# T-269: The Website Audit Stop button calls the audit's own stop route

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | broken | todo |

**Files you may edit (no others):**

- `packages/wizard/src/screens/audit/start/audit-start-api.ts`
- `packages/wizard/src/screens/audit/start/LivePageList.tsx`
- `packages/wizard/src/screens/audit/start/AuditProgress.tsx`
- `packages/wizard/tests/audit-progress.test.tsx`
- `packages/wizard/tests/audit-start-form.test.ts`

**Do not build in parallel with:** T-289 (edits both test files). Build after T-266 is `built`: it adds the route this ticket calls.

## Problem

The Stop button on a running Website Audit calls `POST /api/runner/stop`. That route stops the current Check-up, not a Website Audit. So the button can stop someone's Check-up, and it reports "could not be stopped" for an audit that is running. T-266 adds `POST /api/audits/:id/stop`, which stops only that audit. The wizard must call it.

## Current code

Branch from `main` after T-266 is merged. `packages/wizard/src/screens/audit/start/audit-start-api.ts`:

```ts
export const STOP_DID_NOTHING = 'The Website Audit could not be stopped from here. It will finish on its own.';

/** Stops the active Website Audit by calling `POST /api/runner/stop`. `ok` is true only when it was stopped. */
export async function stopAudit(fetchImpl: Fetch = fetch): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetchImpl('/api/runner/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { ok: false, message: STOP_DID_NOTHING };
    const body = (await res.json().catch(() => null)) as { aborted?: unknown } | null;
    return body?.aborted === true ? { ok: true } : { ok: false, message: STOP_DID_NOTHING };
  } catch {
    return { ok: false, message: NOT_ANSWERING };
  }
}
```

`LivePageList.tsx` calls it with no audit id:

```tsx
export interface LivePageListProps {
  pages: readonly AuditPageState[];
  /** Controlled elapsed time for testing or fixed displays. */
  elapsedMs?: number;
  /** Override the stop action for testing. */
  onStop?: () => void | Promise<void>;
  /** Set to true when the audit has completed or stopped. */
  stopped?: boolean;
}
...
        const outcome = await stopAudit();
```

`AuditProgress.tsx` renders `<LivePageList pages=... elapsedMs=... onStop={onStop} stopped={!running} />`. Its state holds the audit id once the stream has sent it (`grep -n "auditId" packages/wizard/src/screens/audit/start/AuditProgress.tsx`).

The route from T-266 (read `docs/tickets/audit-2026-11/T-266-audit-scoped-stop-route.md` and confirm against `packages/types/src/website-audit.ts`): `POST /api/audits/:id/stop` replies 202 `{ stopped: true }` when the stop was asked for, and 200 `{ stopped: false, message }` when that audit is not running.

## Change

1. `audit-start-api.ts`: replace `stopAudit` with:

```ts
/** Stops this Website Audit by calling `POST /api/audits/:id/stop`. `ok` is true only when a stop was asked for. */
export async function stopAudit(auditId: string, fetchImpl: Fetch = fetch): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetchImpl(`/api/audits/${encodeURIComponent(auditId)}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { ok: false, message: STOP_DID_NOTHING };
    const body = (await res.json().catch(() => null)) as { stopped?: unknown } | null;
    return body?.stopped === true ? { ok: true } : { ok: false, message: STOP_DID_NOTHING };
  } catch {
    return { ok: false, message: NOT_ANSWERING };
  }
}
```

Keep `STOP_DID_NOTHING` as it is.

2. `LivePageList.tsx`: add a prop to `LivePageListProps`:

```ts
  /** The Website Audit being shown. Without it the Stop button is not offered. */
  auditId?: string;
```

Read it in the component's parameters. In `handleStop`, change the fallback call to `const outcome = await stopAudit(auditId);` and return early at the top of `handleStop` when there is neither `onStop` nor `auditId`. Where the Stop button is rendered, render it only when `onStop || auditId` is set. Do not change the button's text or classes.

3. `AuditProgress.tsx`: pass the id to the list: add `auditId={...}` to `<LivePageList ...>`, reading the audit id from the component's state the same way the file already reads it elsewhere (see the `auditId` grep above). If the state has no id yet, pass `undefined`.

4. Run `pnpm exec prettier --write` on the three source files.

## Tests

`packages/wizard/tests/audit-progress.test.tsx`, `describe('stopAudit')`: update the three tests to the new call and reply shape:

- `'is ok only when the runner stopped something'`: `stopAudit('audit_00001', reply(202, { stopped: true }))` equals `{ ok: true }`.
- `'says so when the runner stopped nothing'`: `stopAudit('audit_00001', reply(200, { stopped: false, message: 'not running' }))` equals `{ ok: false, message: STOP_DID_NOTHING }`.
- `'says so on a refusal'`: `stopAudit('audit_00001', reply(403, { error: 'no' }))` equals `{ ok: false, message: STOP_DID_NOTHING }`.

Add `'calls the audit stop route with the id escaped'`: with a `vi.fn` fetch, `stopAudit('a/b', fetchImpl)` calls `'/api/audits/a%2Fb/stop'` with `{ method: 'POST', headers: { 'Content-Type': 'application/json' } }`.

`packages/wizard/tests/audit-start-form.test.ts`: the test `'stops a running audit via stopAudit (POST /api/runner/stop)'` becomes `'stops a running audit via stopAudit (POST /api/audits/:id/stop)'`: reply `reply(202, { stopped: true })`, call `stopAudit('audit_00001', fetchImpl)`, and expect the fetch to be called with `'/api/audits/audit_00001/stop'` and the same options object.

If a rendering test in `audit-progress.test.tsx` expects the Stop button without an `onStop` or `auditId`, give that render an `auditId="audit_00001"`.

Run: `pnpm exec vitest run packages/wizard/tests/audit-progress.test.tsx packages/wizard/tests/audit-start-form.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -rn "api/runner/stop" packages/wizard/src/screens/audit` prints nothing.
- [ ] `stopAudit` takes the audit id first and reads `stopped` from the reply.
- [ ] The Stop button is not rendered when there is no `onStop` and no `auditId`.
- [ ] Both test files and `pnpm build` pass.

## Notes

- Do not touch the Check-up Stop button or `/api/runner/stop` callers outside `packages/wizard/src/screens/audit`.
- If `packages/types/src/website-audit.ts` has no `stop` entry in `AUDIT_API`, T-266 is not built yet: set this ticket to `blocked` and stop.
