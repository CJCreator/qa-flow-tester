# T-348: Console errors with no URL are not scored as first-party Blockers

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/bug-detection.ts`
- `packages/checkers/tests/bug-detection.test.ts`

**Do not build in parallel with:** none.

## Problem

The bug check lowers the severity of a console error that comes from another site's script (a chat widget, analytics). It decides that with `isThirdPartyUrl`, which answers "yes" only when both the page and the error have an origin and the origins differ (`packages/checkers/src/bug-detection.ts:40-43`). An error with no URL has no origin, so the answer is "no", and the error is scored as the site's own: `Major`, or `Blocker` when it is an uncaught exception.

A console message with no `url` is common for third-party noise. The browser gives a location for `console.error` calls, but a thrown error (`pageerror`) never has one: `core/src/evidence.ts:37-42` writes the entry with only `type`, `text` and `timestamp`. So a widget that throws on a page can fail a release as a Blocker. Two places also depend on the literal text "Uncaught Exception" (`:54`, `:111`), which `evidence.ts` writes; a message from a console call that happens to start with the same words is treated the same.

The text of an uncaught exception does carry the stack, and the stack names the script address of each frame. That is the one place the origin can be read from when `url` is missing.

## Current code

Branch from `main`.

`packages/checkers/src/bug-detection.ts` (`grep -n "isThirdPartyUrl\|Uncaught Exception" packages/checkers/src/bug-detection.ts`):

```ts
      const isThirdPartyUrl = (url: string | undefined) => {
        const origin = safeOrigin(url);
        return !!pageOrigin && !!origin && pageOrigin !== origin;
      };
```

```ts
        const isUnhandledException = consoleLog.text.includes('Uncaught Exception');
        // An error thrown inside another site's script (a chat widget, analytics) is theirs.
        const isThirdParty = isThirdPartyUrl(consoleLog.url);
```

## Change

1. Add `originOfConsoleEntry(c: ConsoleEntry): string | undefined` in `bug-detection.ts`: `safeOrigin(c.url)` when `c.url` is set; otherwise, for an uncaught exception, the origin of the first `https?://...` address in the stack lines of `c.text` (skip lines that are the message itself; only lines that start with `at `). Return `undefined` when none is found.
2. Add `isUncaught(c: ConsoleEntry): boolean`: `c.text.startsWith('Uncaught Exception')` (the form `evidence.ts` writes), replacing the three `includes('Uncaught Exception')` uses.
3. For a console entry (not a failed request), compute `origin = originOfConsoleEntry(c)`:
   - origin known and different from the page: third party, as today (`Minor`).
   - origin known and the same: first party, as today.
   - origin unknown and the entry is an uncaught exception: first party, `Major` (not `Blocker`), and say in `resolution` that the address of the failing script could not be read, so it may come from a third party.
   - origin unknown and a plain console error: `Minor`.
4. Keep failed-request handling (section 1 of the function) unchanged: a request always has a URL.
5. Run `pnpm exec prettier --write` on the two files, then `pnpm build`.

## Tests

In `packages/checkers/tests/bug-detection.test.ts` (unit, no Chromium; it builds step evidence by hand):

- A `console.error` entry with no `url`: severity `Minor`.
- An `Uncaught Exception` entry with a stack naming `https://widget.example-chat.com/w.js` on a page at `http://localhost:3000`: third party, `Minor`.
- An `Uncaught Exception` entry with a stack naming `http://localhost:3000/app.js`: first party, `Blocker`.
- An `Uncaught Exception` entry with no address in its stack: `Major`.
- The existing cases (the failed-request grouping and the "Uncaught Exception" title) still pass.

Run: `pnpm exec vitest run packages/checkers/tests/bug-detection.test.ts`, then the checkers unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "includes('Uncaught Exception')" packages/checkers/src/bug-detection.ts` finds nothing.
- [ ] A url-less plain console error is `Minor`; an uncaught exception from a third-party stack frame is `Minor` (tests).
- [ ] The tests and `pnpm build` pass.

## Notes

- Audit finding L7 (audit of 11 Nov 2026 on `d225418`).
- This ticket does not edit `core/src/evidence.ts`. A later change could record the stack's script address in `ConsoleEntry.url` at capture time; then step 1's stack reading becomes a fallback.
- Severity note: an unknown-origin uncaught exception drops from `Blocker` to `Major` on purpose. A crash with a first-party script address stays `Blocker`.
