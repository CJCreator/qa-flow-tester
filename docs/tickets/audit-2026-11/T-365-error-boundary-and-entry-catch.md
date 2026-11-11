# T-365: A render error shows a message with Reload, not a blank page

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | bug | todo |

**Files you may edit (no others):**

- `packages/wizard/src/components/ErrorBoundary.tsx` (new)
- `packages/wizard/src/App.tsx`
- `packages/wizard/src/main.tsx`
- `packages/wizard/tests/error-boundary.test.tsx` (new)

**Do not build in parallel with:** T-357, T-362, T-363, T-369, T-371, T-372 (all edit `App.tsx`).

## Problem

The wizard has no React error boundary: `grep -rn "componentDidCatch\|getDerivedStateFromError\|ErrorBoundary" packages/wizard` finds nothing. Any exception thrown while a screen renders (a report with an unexpected shape, a lazy screen whose code file is gone) makes React unmount the whole tree. The person sees an empty page with no message and no way forward except guessing to reload.

Two more holes:

1. `main.tsx:17-24` loads the landing page or the app with `void Entry.then(...)` and no `.catch`. If that first import fails (a deploy replaced the files while the page was open, a flaky network), nothing is rendered at all.
2. `lib/chunk-reload.ts` (T-186) reloads once on `vite:preloadError`, but not twice within a minute (`:13-18`), and does nothing when session storage is blocked (`:24-28`). In both cases the import error then reaches React and the page goes blank.

T-186 left the boundary out on purpose ("Do not add a React error boundary in this ticket"). This is that follow-up.

## Current code

Branch from `main`.

`packages/wizard/src/main.tsx:17-24`:

```tsx
const Entry = isLanding ? import('./LandingRoot') : import('./App');
void Entry.then(({ default: Page }) =>
  root.render(
    <React.StrictMode>
      <Page />
    </React.StrictMode>
  )
);
```

`grep -n "<Suspense" packages/wizard/src/App.tsx` (`App.tsx:1023`):

```tsx
        <Suspense fallback={<Loading label="Opening…" />}>{body}</Suspense>
```

`Notice` is in `packages/wizard/src/components/text.tsx` (`export function Notice({ tone = 'fail', title, children, actions })`).

## Change

1. New file `packages/wizard/src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Notice } from './text';

/** What a person sees when a page could not be drawn: what happened and the one thing to do. */
export function PageError() {
  return (
    <div className="mx-auto max-w-prose px-4 py-16 sm:px-6">
      <Notice
        title="This page couldn’t be shown"
        actions={
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        }
      >
        Something on this page went wrong. Reloading usually fixes it. If it happens again, open Release check-up from
        its home page.
      </Notice>
    </div>
  );
}

interface Props {
  children: ReactNode;
  /** When this changes (the address), a page that failed is tried again. */
  resetKey?: string;
}
interface State {
  error: unknown;
  key: string | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Unknown render error') };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('A page could not be shown', error, info.componentStack);
  }

  render() {
    return this.state.error ? <PageError /> : this.props.children;
  }
}
```

   `Notice` with the default `tone="fail"` renders `role="alert"` (`components/text.tsx:65`), so the message is announced.
2. `App.tsx`: import `ErrorBoundary` and wrap the body: `<ErrorBoundary resetKey={pathname}><Suspense ...>{body}</Suspense></ErrorBoundary>`. The top bar and area navigation stay usable, and moving to another address tries again.
3. `main.tsx`: import `{ ErrorBoundary, PageError }` from `'./components/ErrorBoundary'`. Wrap `<Page />` in `<ErrorBoundary>` (no `resetKey`). Replace `void Entry.then(...)` with `Entry.then(..., () => root.render(<PageError />))`, so a failed first import also shows the message.
4. `eslint.config.mjs` has no `no-console` rule today, so `console.error` is allowed. Keep it: the error must reach the browser console.
5. `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/wizard/tests/error-boundary.test.tsx` (unit tier, `react-dom/server` like the other `.tsx` tests):

- `'the fallback names the problem and offers Reload'`: `renderToStaticMarkup(<PageError />)` contains "This page couldn’t be shown" and a `<button` with "Reload the page".
- `'an error switches to the fallback'`: `ErrorBoundary.getDerivedStateFromError(new Error('x'))` returns `{ error: <that error> }`; an instance with `state = { error: new Error('x'), key: undefined }` renders markup containing "This page couldn’t be shown" (call `instance.render()` and pass the result to `renderToStaticMarkup`).
- `'a new address clears the error'`: `ErrorBoundary.getDerivedStateFromProps({ children: null, resetKey: '/b' }, { error: new Error('x'), key: '/a' })` returns `{ error: null, key: '/b' }`; with the same key it returns `null`.
- `'children render when nothing failed'`: `renderToStaticMarkup(<ErrorBoundary><p>ok</p></ErrorBoundary>)` is `<p>ok</p>`.
- Source check: `src/main.tsx` contains `<ErrorBoundary>` and `root.render(<PageError />)`, and no longer contains `void Entry.then`; `src/App.tsx` contains `<ErrorBoundary resetKey={pathname}>`.

Run: `pnpm exec vitest run packages/wizard/tests/error-boundary.test.tsx packages/wizard/tests/chunk-reload.test.ts`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -rn "getDerivedStateFromError" packages/wizard/src` finds `ErrorBoundary.tsx`.
- [ ] `grep -n "PageError" packages/wizard/src/main.tsx` finds the catch.
- [ ] The new test and the wizard unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M44 (audit of 11 Nov 2026 on `d225418`).
- `chunk-reload.ts` is not changed: its once-a-minute reload still runs first; the boundary catches what it leaves.
- `App.tsx` is also edited by T-357, T-362, T-363, T-369, T-371 and T-372.
