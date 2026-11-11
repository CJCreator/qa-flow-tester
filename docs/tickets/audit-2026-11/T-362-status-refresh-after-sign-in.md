# T-362: The wizard reads the runner status again after a Helper or owner signs in

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/session-event.ts` (new)
- `packages/wizard/src/screens/audit/saved/helper-api.ts`
- `packages/wizard/src/App.tsx`
- `packages/wizard/tests/session-refresh.test.ts` (new)

**Do not build in parallel with:** T-357, T-363, T-365, T-369, T-371, T-372 (all edit `App.tsx`).

## Problem

On the hosted (beta) copy, App decides from the runner status whether a Website Audit screen is shown or replaced by the "Website Audits run on your own copy" notice: `showsBetaAuditNotice(route.name, !!status?.beta, !!status?.helper, !!status?.auditOwner)` (`packages/wizard/src/App.tsx:803`). `helper` and `auditOwner` come from `GET /api/runner/status`, which reads the Helper session cookie (`packages/runner/src/server.ts:1187-1202`, `isAuditOwner` at `:894-899`).

App reads the status once when the runner answers (`App.tsx:234-240`) and again only on the Check-up's own addresses (`App.tsx:266-270`: `if (checkAddress) void reconcile();`). Signing in on `/helper` (`HelperSignInScreen.tsx:198-202`) sets the cookie but never tells App. So a Helper who signs in and presses **Open** (`App.tsx:968`, `navigate(PATHS.audit(auditId))`) gets the notice, whose "Sign in with Google" button leads back to `/helper`. That loops until a manual reload. An owner (an email in `AUDIT_OWNER_EMAILS`) who signs in the same way still has the Website Audit links hidden in `TopBar`, `AreaNav` and the command palette (all take `auditOwner={!!status?.auditOwner}`), and gets the notice on every audit screen. Signing out (`HelperSignInScreen.tsx:204-213`) leaves the old status in place the same way.

## Current code

Branch from `main`.

`grep -n "if (checkAddress) void reconcile" -B3 -A2 packages/wizard/src/App.tsx`:

```ts
  const checkAddress = isCheckRoute(route);
  useEffect(() => {
    if (!reachable) return;
    if (checkAddress) void reconcile();
  }, [reachable, pathname, checkAddress, inProgress, reconcile]);
```

`grep -n "export function startHelperSession\|export function endHelperSession" -A9 packages/wizard/src/screens/audit/saved/helper-api.ts`:

```ts
export function startHelperSession(idToken: string, fetchImpl: Fetch = fetch): Promise<HelperOutcome<HelperSession>> {
  return call(
    auditPath(AUDIT_API.helperSignIn.path, {}),
    ...
    asSession
  );
}
...
export function endHelperSession(fetchImpl: Fetch = fetch): Promise<HelperOutcome<true>> {
  return call(
    auditPath(AUDIT_API.helperSignOut.path, {}),
    ...
  );
}
```

`App.tsx:67` already imports `BetaAuditNotice, showsBetaAuditNotice` from `./screens/audit/BetaAuditNotice`, which also exports `AUDIT_ROUTE_NAMES`.

## Change

1. New file `packages/wizard/src/lib/session-event.ts` (no imports, so App's first chunk stays small):

```ts
/** Sent on `window` when a Google sign-in for a Helper or owner starts or ends: App reads the runner status again. */
export const SESSION_CHANGED_EVENT = 'qa:session-changed';

/** Tells the page that the sign-in changed. Does nothing where there is no window (tests, server rendering). */
export function announceSessionChange(
  target: Pick<EventTarget, 'dispatchEvent'> | undefined = typeof window === 'undefined' ? undefined : window
): void {
  target?.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}
```

2. `helper-api.ts`: import `announceSessionChange` from `'../../../lib/session-event'`. In `startHelperSession` and `endHelperSession`, keep the `call(...)` and add `.then((outcome) => { if (outcome.ok) announceSessionChange(); return outcome; })`. A refused or failed request announces nothing.
3. `App.tsx`:
   - Import `SESSION_CHANGED_EVENT` from `'./lib/session-event'` and add `AUDIT_ROUTE_NAMES` to the `BetaAuditNotice` import.
   - After the `reconcile` callback, add:

```ts
  // A Helper or owner signing in or out on /helper changes what the shared copy shows: read the status again.
  useEffect(() => {
    const onSessionChange = () => void reconcile();
    window.addEventListener(SESSION_CHANGED_EVENT, onSessionChange);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, onSessionChange);
  }, [reconcile]);
```

   - Read the status on every Website Audit address too, which covers a sign-in in another tab and an expired session:

```ts
  const checkAddress = isCheckRoute(route);
  const auditAddress = AUDIT_ROUTE_NAMES.includes(route.name);
  useEffect(() => {
    if (!reachable) return;
    if (checkAddress || auditAddress) void reconcile();
  }, [reachable, pathname, checkAddress, auditAddress, inProgress, reconcile]);
```

   `reconcile` only moves the person on a Check-up address (`addressForPhase` returns null elsewhere, `lib/phase-address.ts:10-11`), so this never navigates away from an audit screen.
4. `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/wizard/tests/session-refresh.test.ts` (unit tier; `vi.stubGlobal('window', new EventTarget())` per test, `vi.unstubAllGlobals()` in `afterEach`):

- `'announceSessionChange sends the event on the given target'`: a fresh `EventTarget` with a listener for `SESSION_CHANGED_EVENT`; one call, one event.
- `'announceSessionChange does nothing without a window'`: `announceSessionChange(undefined)` does not throw.
- `'a successful sign-in announces the change'`: stub `window`; a fake fetch answering 200 with a valid session body (copy the `session` fixture and `fakeFetch` shape from `tests/audit-helpers.test.tsx:120-200`); `await startHelperSession('t', fetchImpl)`; the listener ran once.
- `'a refused sign-in announces nothing'`: 401 `{ code: 'ERR_SIGN_IN_FAILED' }`; listener count 0.
- `'signing out announces the change'`: 200 `{ signedOut: true }` through `endHelperSession`; listener ran once.
- `'App reads the status on the event and on audit addresses'`: read `src/App.tsx` as text; it contains `addEventListener(SESSION_CHANGED_EVENT` and `checkAddress || auditAddress`.

Run: `pnpm exec vitest run packages/wizard/tests/session-refresh.test.ts packages/wizard/tests/audit-helpers.test.tsx packages/wizard/tests/audit-routing.test.ts`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "announceSessionChange" packages/wizard/src/screens/audit/saved/helper-api.ts` finds two calls.
- [ ] `grep -n "SESSION_CHANGED_EVENT\|auditAddress" packages/wizard/src/App.tsx` finds the listener and the route check.
- [ ] The new test and the wizard unit tests pass; `pnpm build` passes.
- [ ] By hand on a beta copy with Helper sign-in configured: sign in on `/helper`, press Open: the Website Audit opens without a reload.

## Notes

- Audit finding H17 (audit of 11 Nov 2026 on `d225418`).
- A window event, not a callback prop, so `HelperSignInScreen.tsx` needs no change and any later sign-in place gets the refresh for free.
- `App.tsx` is also edited by T-357, T-363, T-365, T-369, T-371 and T-372.
- Out of scope: what the runner treats as owner on beta (T-297).
