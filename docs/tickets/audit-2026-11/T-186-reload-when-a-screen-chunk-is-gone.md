# T-186: Reload once when a screen's code file no longer exists after a deploy

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | todo |

**Files you may edit (no others):**
- `packages/wizard/src/main.tsx`
- `packages/wizard/src/lib/chunk-reload.ts` (new)
- `packages/wizard/tests/chunk-reload.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

Most screens are loaded with `lazy(() => import(...))` (`App.tsx:78-126`) inside one `<Suspense>` (`App.tsx:1023`). There is no error boundary. After a deploy the file names of those chunks change. A tab opened before the deploy that then goes to the report, Settings or a Website Audit screen requests a file that is gone; the dynamic import rejects and React unmounts the whole app to a blank page.

Vite fires a `vite:preloadError` event on `window` when a dynamic import fails. Reloading the page fetches the new `index.html` and the new chunks.

## Current code

`packages/wizard/src/main.tsx:9-22` (branch `worktree-audit-cleanup`)

```tsx
// The public landing page is what most first visits open, so it loads without the app's code (the
// runner connection, the plan editor, the report). Its links are page loads, which fetch the app.
const root = ReactDOM.createRoot(document.getElementById('root')!);
const isLanding = matchRoute(window.location.pathname).name === 'landing';
// A saved light or dark choice is set before the first paint, so the page never flashes the other theme.
applyTheme(readTheme(), document.documentElement);
const Entry = isLanding ? import('./LandingRoot') : import('./App');
void Entry.then(({ default: Page }) =>
  root.render(
    <React.StrictMode>
      <Page />
    </React.StrictMode>
  )
);
```

## Change

1. Create `packages/wizard/src/lib/chunk-reload.ts`:

```ts
/** A screen's code file can be gone after a deploy. The page reloads once to fetch the new files. */

const KEY = 'qa-chunk-reload-at';
/** A second failure this soon after a reload means reloading does not help: stop, so the page never loops. */
const MIN_GAP_MS = 60_000;

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** True when a reload is worth trying now; records the time so the next call inside a minute says no. */
export function shouldReloadForChunk(store: Store, now: number): boolean {
  const last = Number(store.getItem(KEY));
  if (Number.isFinite(last) && last > 0 && now - last < MIN_GAP_MS) return false;
  store.setItem(KEY, String(now));
  return true;
}

/** Reloads the page when Vite reports that a code file could not be loaded. */
export function reloadOnMissingChunk(win: Window = window): void {
  win.addEventListener('vite:preloadError', (event) => {
    let store: Store;
    try {
      store = win.sessionStorage;
    } catch {
      return; // Storage is blocked: without it a loop cannot be ruled out, so do nothing.
    }
    if (!shouldReloadForChunk(store, Date.now())) return;
    event.preventDefault(); // The reload handles it: the import error is not thrown as well.
    win.location.reload();
  });
}
```

2. In `main.tsx`, add the import after the `theme` import:

```tsx
import { reloadOnMissingChunk } from './lib/chunk-reload';
```

   and add this line directly before `const Entry = …`:

```tsx
reloadOnMissingChunk();
```

## Tests

New file `packages/wizard/tests/chunk-reload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldReloadForChunk } from '../src/lib/chunk-reload';

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('reload when a code file is gone', () => {
  it('reloads the first time', () => {
    expect(shouldReloadForChunk(memoryStore(), 1_000_000)).toBe(true);
  });
  it('does not reload again inside a minute, so the page cannot loop', () => {
    const store = memoryStore();
    expect(shouldReloadForChunk(store, 1_000_000)).toBe(true);
    expect(shouldReloadForChunk(store, 1_030_000)).toBe(false);
  });
  it('reloads again after a minute', () => {
    const store = memoryStore();
    shouldReloadForChunk(store, 1_000_000);
    expect(shouldReloadForChunk(store, 1_061_000)).toBe(true);
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/chunk-reload.test.ts` then `pnpm build`.

## Done when

- [ ] `main.tsx` calls `reloadOnMissingChunk()` before the first import.
- [ ] A failed dynamic import reloads the page once; a second failure within 60 s does not reload.
- [ ] New test and `pnpm build` pass.

## Notes

- Do not add a React error boundary in this ticket.
- `vite:preloadError` is a Vite runtime event; in TypeScript the listener's `event` is a plain `Event`, which is all this code needs.
