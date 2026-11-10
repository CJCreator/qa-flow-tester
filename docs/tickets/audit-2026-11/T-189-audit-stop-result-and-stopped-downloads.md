# T-189: Website Audit: say when Stop did nothing, and block downloads of a stopped version

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/audit/start/audit-start-api.ts`
- `packages/wizard/src/screens/audit/start/LivePageList.tsx`
- `packages/wizard/src/screens/audit/documents/export-api.ts`
- `packages/wizard/tests/audit-documents-export.test.tsx`
- `packages/wizard/tests/audit-progress.test.tsx`

**Do not build in parallel with:** T-196 (edits `LivePageList.tsx`).

## Problem

1. The audit's Stop button calls `POST /api/runner/stop` and only looks at `res.ok`. The runner answers HTTP 200 with `{ "aborted": false, "message": "No run currently active" }` when it stopped nothing (`packages/runner/src/server.ts:3477`). The button then returns to "Stop" with no message, and the audit keeps running.
2. `exportBlockedReason` blocks `running` and `failed` versions but not `stopped`. A stopped version has no results, so every Download fails with a runner error instead of a plain reason.

## Current code

`packages/wizard/src/screens/audit/start/audit-start-api.ts:130-141` (branch `worktree-audit-cleanup`)

```ts
/** Stops the active audit or Check-up by calling `POST /api/runner/stop`. */
export async function stopAudit(fetchImpl: Fetch = fetch): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetchImpl('/api/runner/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return { ok: res.ok };
  } catch {
    return { ok: false, message: NOT_ANSWERING };
  }
}
```

`packages/wizard/src/screens/audit/start/LivePageList.tsx:67-79`

```tsx
  const handleStop = async () => {
    if (stopping || stopped) return;
    setStopping(true);
    try {
      if (onStop) {
        await onStop();
      } else {
        await stopAudit();
      }
    } finally {
      setStopping(false);
    }
  };
```

and the button (lines 86-96):

```tsx
        {!stopped && (
          <button
            type="button"
            className="btn-quiet btn-sm text-fail"
            onClick={() => void handleStop()}
            disabled={stopping}
            data-testid="audit-stop-button"
          >
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
```

`packages/wizard/src/screens/audit/documents/export-api.ts:143-148`

```ts
/** The reason an export cannot start for a version with this status; null when it can. */
export function exportBlockedReason(status: AuditStatus | undefined): string | null {
  if (status === 'running') return 'This version is still running. Download it when it has finished.';
  if (status === 'failed') return 'This version did not finish, so there is nothing to download.';
  return null;
}
```

## Change

1. `audit-start-api.ts`: replace `stopAudit` with:

```ts
/** Shown when the runner answered but stopped nothing. */
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

2. `LivePageList.tsx`: add state next to the other `useState` calls in the component:

```tsx
  const [stopMessage, setStopMessage] = useState<string | null>(null);
```

3. Replace `handleStop` with:

```tsx
  const handleStop = async () => {
    if (stopping || stopped) return;
    setStopping(true);
    setStopMessage(null);
    try {
      if (onStop) {
        await onStop();
      } else {
        const outcome = await stopAudit();
        if (!outcome.ok) setStopMessage(outcome.message ?? null);
      }
    } finally {
      setStopping(false);
    }
  };
```

4. Directly after the closing `</div>` of the row that holds the Stop button (the `<div className="flex items-center justify-between gap-4 text-sm">` block), add:

```tsx
      {stopMessage && (
        <p role="alert" className="mt-2 text-sm text-fail" data-testid="audit-stop-message">
          {stopMessage}
        </p>
      )}
```

5. `export-api.ts`: replace the `failed` line of `exportBlockedReason` with:

```ts
  if (status === 'failed' || status === 'stopped') {
    return 'This version did not finish, so there is nothing to download.';
  }
```

## Tests

`packages/wizard/tests/audit-documents-export.test.tsx`: in the existing `exportBlockedReason` test (line 358 on), add:

```ts
    expect(exportBlockedReason('stopped')).toMatch(/did not finish/);
```

`packages/wizard/tests/audit-progress.test.tsx`: add `stopAudit` and `STOP_DID_NOTHING` to an import from `'../src/screens/audit/start/audit-start-api'`, then:

```ts
describe('stopAudit', () => {
  const reply = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('is ok only when the runner stopped something', async () => {
    expect(await stopAudit(reply(200, { aborted: true }))).toEqual({ ok: true });
  });
  it('says so when the runner stopped nothing', async () => {
    expect(await stopAudit(reply(200, { aborted: false, message: 'No run currently active' }))).toEqual({
      ok: false,
      message: STOP_DID_NOTHING,
    });
  });
  it('says so on a refusal', async () => {
    expect(await stopAudit(reply(403, { error: 'no' }))).toEqual({ ok: false, message: STOP_DID_NOTHING });
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/audit-documents-export.test.tsx packages/wizard/tests/audit-progress.test.tsx` then `pnpm build`.

## Done when

- [x] A Stop that stops nothing shows the message under the button.
- [x] A `stopped` version shows the "did not finish" reason and no Download request is sent.
- [x] Tests and `pnpm build` pass.

## Notes

- Out of scope (runner ticket): an audit-scoped stop route. Today the shared route can also stop a running Check-up when no audit is active; this ticket only reports the result truthfully.
- `STOP_DID_NOTHING` uses "Website Audit", the glossary term; do not write "run".
