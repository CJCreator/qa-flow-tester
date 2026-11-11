# T-369: The hosted copy's lost-contact text fits the hosted copy, and the timeout works on older browsers

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | wizard | bug | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/lost-contact.ts` (new)
- `packages/wizard/src/App.tsx`
- `packages/wizard/src/api.ts`
- `packages/wizard/tests/lost-contact-and-signal.test.ts` (new)

**Do not build in parallel with:** T-357, T-362, T-363, T-365, T-371, T-372 (all edit `App.tsx`).

## Problem

1. **Wrong advice on the hosted copy.** When the page loses the runner, App shows "Lost contact with Release check-up. Retrying…" with "Check that it’s still running in its terminal (start it with pnpm start). This page keeps trying." (`App.tsx:1002-1008`). On the shared online copy (`status.beta`) the visitor has no terminal and nothing to start; the runner is asleep, waking or being redeployed. The same advice is passed as the `suggestion` of every "isn’t responding" error (`api.ts:57-61`), although no screen ever shows a `RunnerError.suggestion` (`grep -rn "\.suggestion" packages/wizard/src` finds only the constructor and `checkReachable`'s own field).
2. **"Isn’t responding" on older browsers.** `call()` builds its signal with `AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])` when the caller passes a signal (`api.ts:52-54`). `AbortSignal.any` exists only from Safari 17.4 and Firefox 124. On older ones it throws a `TypeError` inside the `try`, which the `catch` turns into "Release check-up isn’t responding" (`api.ts:55-62`), with the runner fine. The one caller that passes a signal is the Verified Domain check on the new check-up screen (`api.ts:302-306`, `NewCheckupScreen.tsx:1247`), so on those browsers a Verified Domain can never be checked.

## Current code

Branch from `main`.

`grep -n "async function call" -A16 packages/wizard/src/api.ts`:

```ts
async function call(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  try {
    return await fetch(path, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
      // A caller's signal (a check for an address that has since changed) cancels the request too.
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new RunnerError(
      NOT_RESPONDING,
      'ERR_SERVER_UNRESPONSIVE',
      'Check that it’s still running in its terminal (start it with pnpm start).'
    );
  }
}
```

`grep -n "lostContact &&" -A6 packages/wizard/src/App.tsx`:

```tsx
        {lostContact && (
          <div className="mx-auto max-w-prose px-4 pt-4 sm:px-6">
            <Notice tone="warn" title="Lost contact with Release check-up. Retrying…">
              Check that it’s still running in its terminal (start it with pnpm start). This page keeps trying.
            </Notice>
```

## Change

1. New file `packages/wizard/src/lib/lost-contact.ts`:

```ts
/** What to do while the page has lost the runner: the hosted copy has no terminal to look at. */
export function lostContactHint(hosted: boolean): string {
  return hosted
    ? 'The online copy may be waking up or restarting after an update. This page keeps trying.'
    : 'Check that it’s still running in its terminal (start it with pnpm start). This page keeps trying.';
}
```

2. `App.tsx`: import it and replace the Notice body with `{lostContactHint(!!status?.beta)}`. Keep the title text in `App.tsx` as it is (`tests/sources-screens.test.tsx:300` looks for it there).
3. `api.ts`:
   - Add and export:

```ts
/**
 * AbortSignal.any where the browser has it (Safari 17.4+, Firefox 124+). Elsewhere a signal that aborts as soon as
 * any of the given signals does, with that signal's reason.
 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
```

   - In `call()`: `signal: init.signal ? anySignal([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)`.
   - Drop the third argument (the `pnpm start` suggestion) of the `ERR_SERVER_UNRESPONSIVE` error: no screen reads it, and it would be wrong on the hosted copy.
4. `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/wizard/tests/lost-contact-and-signal.test.ts` (unit):

- `'the hosted copy is not told to use a terminal'`: `lostContactHint(true)` contains neither `pnpm` nor `terminal`; `lostContactHint(false)` contains `pnpm start`.
- `'App picks the hint from the status'`: `src/App.tsx` as text contains `lostContactHint(!!status?.beta)`.
- For the fallback, hide the built-in in `beforeEach` with `const real = AbortSignal.any; Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });` and put `real` back in `afterEach`:
  - `'aborts when the first signal aborts, with its reason'`: two controllers; abort the first with `'gone'`; the combined signal is aborted and `reason` is `'gone'`.
  - `'aborts when the timeout fires'`: `anySignal([new AbortController().signal, AbortSignal.timeout(10)])`; after `await new Promise((r) => setTimeout(r, 30))` it is aborted.
  - `'is aborted at once when a signal already is'`: `AbortSignal.abort('x')` in the list gives an aborted signal right away.
- `'uses the built-in when there is one'`: without the override, `anySignal([a.signal])` aborts when `a` does.

Run: `pnpm exec vitest run packages/wizard/tests/lost-contact-and-signal.test.ts packages/wizard/tests/domain-proof-client.test.ts packages/wizard/tests/sources-screens.test.tsx`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "AbortSignal.any(\[" packages/wizard/src/api.ts` finds only the line inside `anySignal`.
- [ ] `grep -n "pnpm start" packages/wizard/src/api.ts` finds nothing.
- [ ] `grep -n "lostContactHint" packages/wizard/src/App.tsx` finds the Notice body.
- [ ] The new test and the wizard unit tests pass; `pnpm build` passes.

## Notes

- Audit finding L14 (part) (audit of 11 Nov 2026 on `d225418`).
- `AbortSignal.timeout` itself needs Safari 16 and Firefox 100. Those are older than `any`, so no fallback is added for it.
- `App.tsx` is also edited by T-357, T-362, T-363, T-365, T-371 and T-372.
