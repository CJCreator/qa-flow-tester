# T-350: The visual diff checks image size before decoding

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | speed | todo |

**Files you may edit (no others):**

- `packages/checkers/src/design-standards.ts`
- `packages/checkers/tests/visual-diff-size-cap.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

When a Plan Item has an approved visual baseline, the checker decodes the new full-page screenshot and the baseline with `PNG.sync.read` (`packages/checkers/src/design-standards.ts:236-237`), then compares them with pixelmatch and allocates a third image for the diff. All of that is synchronous. A very long page (an endless feed, a page with a 60,000 px scroll height) gives a PNG of hundreds of millions of pixels: each decoded copy is 4 bytes per pixel, so three copies can pass a gigabyte on the runner's 2 GiB instance, and the decode blocks the one Node event loop that also serves every other request, including Stop.

The width and height are in the first 24 bytes of every PNG. They can be read before decoding, and the work refused above a limit.

## Current code

Branch from `main`.

`packages/checkers/src/design-standards.ts` (`grep -n "PNG.sync.read" -B4 -A5 packages/checkers/src/design-standards.ts`):

```ts
    if (currentScreenshot.equals(baselineScreenshot)) {
      return { match: true, diffPercent: 0, diffPixels: 0, sizeMismatch: false };
    }

    const current = PNG.sync.read(currentScreenshot);
    const baseline = PNG.sync.read(baselineScreenshot);
    if (current.width !== baseline.width || current.height !== baseline.height) {
```

The caller (`packages/core/src/orchestrator.ts`, `grep -n "checkVisualDiff" packages/core/src/orchestrator.ts`) calls `this.designChecker.visualDiffFinding(diff, ...)` whenever `diff.match` is false, so a result with `match: false` reaches `visualDiffFinding`. This ticket changes only the checker, so it does not edit the orchestrator (T-252 and T-267 are editing around it).

## Change

1. In `design-standards.ts`, add `pngSize(buf: Buffer): { width: number; height: number } | null`: return null unless the first 8 bytes are the PNG signature (`89 50 4E 47 0D 0A 1A 0A`) and bytes 12-15 read `IHDR`; width is `buf.readUInt32BE(16)`, height `buf.readUInt32BE(20)`.
2. Add `export const MAX_VISUAL_DIFF_PIXELS = 25_000_000;` (about 100 MB per decoded copy) with a comment on why.
3. In `checkVisualDiff`, after the equal-buffer shortcut and before any `PNG.sync.read`: read `pngSize` of both. If either is null, or either has `width * height` above the limit, return `{ match: false, diffPercent: 0, diffPixels: 0, sizeMismatch: false, tooLarge: true }`. Add `tooLarge?: boolean` to `VisualDiffResult` with a one-line comment.
4. In `visualDiffFinding`, when `result.tooLarge` is true return `couldNotVerifyFinding('design-standards', 'whether the page still matches its approved look (the screenshot is too large to compare)', { testCaseId, role, breakpoint, urlPath })` (already imported in this file) instead of the `Visual regression` finding. This way the orchestrator needs no change and a refusal never reads as a regression.
5. Run `pnpm exec prettier --write` on the two files, then `pnpm build`.

## Tests

New unit file `packages/checkers/tests/visual-diff-size-cap.test.ts` (no Chromium; the test builds a 24-byte PNG header by hand, which the new code must refuse before decoding):

- A header for 1440 x 40,000 (57.6 million pixels) against the same header with a different trailing byte: `checkVisualDiff` returns `tooLarge: true` and does not throw (a real decode of those bytes would throw).
- Two real small PNGs (made with `pngjs` as in `design-ux-checkers.test.ts`) still compare as before: a match, a mismatch, a size mismatch.
- A buffer that is not a PNG gives `tooLarge: true`, not an exception.
- `visualDiffFinding({ ..., tooLarge: true }, ctx)` returns a finding whose title starts `Could not verify` and whose id starts `F-UNVERIFIED-design-standards`.

Run: `pnpm exec vitest run packages/checkers/tests/visual-diff-size-cap.test.ts packages/checkers/tests/visual-diff-finding.test.ts`, then the checkers unit tests, then `pnpm build`.

## Done when

- [ ] `grep -n "MAX_VISUAL_DIFF_PIXELS" packages/checkers/src/design-standards.ts` shows the limit and its use before `PNG.sync.read`.
- [ ] An oversized header is refused without decoding; a real small diff still works (tests).
- [ ] The tests and `pnpm build` pass.

## Notes

- Audit finding L8 (audit of 11 Nov 2026 on `d225418`).
- Moving the decode to a worker thread is a larger change and is not part of this ticket.
- Related: T-252 and T-267 (visual baselines). They edit other files; no overlap.
