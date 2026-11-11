# T-364: Unsaved Audit Document edits ask before Back or a palette jump

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | wizard | bug | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/router.ts`
- `packages/wizard/src/screens/audit/documents/ReviewDocumentsScreen.tsx`
- `packages/wizard/tests/navigation-block.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

On "Review the Audit Documents" a person edits Sections, findings and pages, then presses Save. While edits are unsaved (`dirty`, `ReviewDocumentsScreen.tsx:653`), the screen guards two exits only (`ReviewDocumentsScreen.tsx:656-687`): `beforeunload` (closing or reloading the tab) and a capture-phase click on an `<a href>` inside the app.

Two other exits skip the guard and throw the edits away without a word:

1. **Browser Back or Forward.** `popstate` goes straight to the router's `notify` (`lib/router.ts:160`), the route changes and the screen unmounts with its draft.
2. **The command palette** (Ctrl+K). Its "Go to" actions call `navigate()` directly (`components/CommandPalette.tsx:218-262`), not through a link, so the click guard never sees them.

The router has no way for a screen to say "ask first".

## Current code

Branch from `main`.

`grep -n "addEventListener('popstate'\|export function navigate" -A10 packages/wizard/src/lib/router.ts`:

```ts
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
if (typeof window !== 'undefined') window.addEventListener('popstate', notify);

/** Goes to an address in the app. `replace` swaps the current history entry, for moves the person didn't make. */
export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const here = window.location.pathname + window.location.search;
  if (to === here) return;
  if (options.replace) window.history.replaceState(null, '', to);
  else {
    window.history.pushState(null, '', to);
    window.scrollTo(0, 0);
  }
  notify();
}
```

`grep -n "Unsaved edits" -A32 packages/wizard/src/screens/audit/documents/ReviewDocumentsScreen.tsx` shows the effect with `beforeUnload`, the `onClick` capture handler that calls `confirm({ title: 'Leave without saving?', ... })` and then `navigate(href)`.

`Link` (`router.ts:188-217`) calls `navigate(to)` on a plain click, unless `e.defaultPrevented`.

## Change

1. `router.ts`: add a single navigation block and route every move through it.

```ts
/** Answers whether the person may leave the screen for `to`; true leaves. Set by a screen with unsaved work. */
export type LeaveCheck = (to: string) => Promise<boolean>;

let leaveCheck: LeaveCheck | null = null;
/** The address on screen, so Back can be undone while a screen holds unsaved work. */
let shownAddress = typeof window === 'undefined' ? '' : window.location.pathname + window.location.search;

/** Makes every move ask `check` first. Returns the function that lifts the block. The newest block wins. */
export function blockNavigation(check: LeaveCheck): () => void {
  leaveCheck = check;
  return () => {
    if (leaveCheck === check) leaveCheck = null;
  };
}
```

   - Move today's body of `navigate` (after the `to === here` test) into a private `go(to, options)` that also sets `shownAddress = to` before `notify()`.
   - `navigate`: when `leaveCheck` is null, call `go`. Otherwise call the check and, when it answers true, clear the block (if it is still the same check) and call `go(to, options)`. When it answers false, do nothing.
   - Replace the module-level `popstate` listener with `onPopState`:
     - No block: `shownAddress = location.pathname + location.search; notify();`.
     - Blocked: remember `target` (the new address), put the screen's address back at once with `window.history.pushState(null, '', shownAddress)` (no `notify`, so the screen stays and the address matches it), then ask the check with `target`. On true: clear the block and call `window.history.back()`; the next `popstate` finds no block and moves normally. On false: nothing more.
   - Doc comment on `blockNavigation`: Back while blocked adds one history entry for the screen; that is the price of keeping the address and the screen in step.
2. `ReviewDocumentsScreen.tsx`: import `blockNavigation` from the router. In the `dirty` effect:
   - Keep `beforeunload`.
   - Add `const unblock = blockNavigation(() => confirm({ ...the existing Leave without saving? options }));` and call `unblock()` in the cleanup.
   - Keep the capture-phase click handler for plain `<a href>` links inside the app, but make it only `e.preventDefault(); navigate(href);`. `navigate` now asks, so the confirm is shown once. (A `Link` click sees `defaultPrevented` and does nothing more.)
   - After Save or Discard `dirty` turns false, the effect cleans up and the block is lifted.
3. `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/wizard/tests/navigation-block.test.ts` (unit tier, no DOM library). Before each test: `vi.resetModules()`, then `vi.stubGlobal('window', fake)` and `const router = await import('../src/lib/router')`, so the router's `popstate` listener is attached to the fake. `afterEach`: `vi.unstubAllGlobals()`.

The fake window is an `EventTarget` with `location` (`pathname` and `search` read from the current history entry), `history` (`pushState` truncates forward entries and appends, `replaceState` swaps the current entry, `back()` moves one entry back and dispatches `new Event('popstate')`) and a no-op `scrollTo`. Start it on `/audits/a-1/versions/1/review`.

Cases:

- `'moves at once when nothing blocks'`: `navigate('/audits')`; pathname is `/audits`.
- `'stays when the person chooses to stay'`: block with `async () => false`; `navigate('/audits')`; after `await Promise.resolve()` twice, pathname is still the review address and the check was called with `'/audits'`.
- `'moves and lifts the block when the person chooses to leave'`: block with `async () => true`; `navigate('/audits')`; pathname is `/audits`; a second `navigate('/settings')` does not call the check again.
- `'the returned function lifts the block'`: `const unblock = blockNavigation(check); unblock(); navigate('/audits')`; check not called; pathname moved.
- `'Back while blocked puts the screen address back and asks'`: start on `/audits/a-1`, `navigate` to the review address, block with a check that resolves false; `fake.history.back()`; pathname is the review address again and the check was called with `/audits/a-1`.
- `'Back confirmed goes back'`: same, with a check that resolves true; after the promise settles pathname is `/audits/a-1`, and a later `navigate('/settings')` does not ask.

Run: `pnpm exec vitest run packages/wizard/tests/navigation-block.test.ts packages/wizard/tests/router.test.ts packages/wizard/tests/audit-documents-review.test.tsx`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "export function blockNavigation" packages/wizard/src/lib/router.ts` finds the function.
- [ ] `grep -n "blockNavigation" packages/wizard/src/screens/audit/documents/ReviewDocumentsScreen.tsx` finds its use.
- [ ] `grep -c "Leave without saving?" packages/wizard/src/screens/audit/documents/ReviewDocumentsScreen.tsx` is 1 (one confirm, used by the block).
- [ ] The new test, `router.test.ts` and the wizard unit tests pass; `pnpm build` passes.
- [ ] By hand: edit a Section, press browser Back: "Leave without saving?" appears; Stay keeps the edit. Ctrl+K, "Go to Settings": the same question.

## Notes

- Audit finding M43 (audit of 11 Nov 2026 on `d225418`).
- `CommandPalette.tsx` needs no change: its actions call `navigate()`, which now asks. So this ticket does not touch the palette, and T-368 does not have to wait for it.
- Other screens with unsaved work (the Plan editor) can use `blockNavigation` later; not in this ticket.
- No ADR: the router stays a few lines over the History API (comment at `router.ts:3-8`).
