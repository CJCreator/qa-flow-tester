# T-144: Two result notes are written when they are false

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core/audit | bug | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/tests/audit-pipeline.test.ts`

**Do not build in parallel with:** T-138, T-140, T-145, T-153, T-154, T-158 (all edit `pipeline.ts`).

## Problem

1. **"Only 1 page was read."** is added when one page was recorded and that page has any link at all. Links that leave the site and links back to the same page count. A real one-page site with a social media link always gets the note. ADR 0042 says the note is for "links list more on the same site".

2. **"The speed step did not finish, so speed was not measured."** is added when the speed step ran to the end but nothing could be measured (for example no PageSpeed key and no browser timing). The step did finish. The result then also gets "Speed was not measured.", so there are two notes and the first is false.

## Current code

`packages/core/src/audit/pipeline/pipeline.ts:366` (branch `worktree-audit-cleanup`)

```ts
  // Note for only 1 page recorded but more found / links seen (T-84, ADR 0042)
  if (
    crawl.pages.length === 1 &&
    (crawl.coverage.found > 1 || (crawl.pages[0]?.links && crawl.pages[0].links.length > 0))
  ) {
    const note = onlyOnePageNoteText();
    if (!notes.includes(note)) notes.push(note);
  }
```

Each link is `{ to: string; leavesSite?: boolean; ... }` and `crawl.pages[0].urlPath` is the page's own path.

`packages/core/src/audit/pipeline/pipeline.ts:551` (inside the speed `try`)

```ts
    record(
      'speed',
      'measuring-speed',
      speedSource !== 'not-measured',
      speedSource === 'not-measured' ? NOTES.speed : undefined
    );
  } catch (err) {
```

The same `record(...)` call appears a second time at the end of the `catch` block; that one is correct (the step threw) and stays.

## Change

1. Add `skipKey` to the imports at the top of `pipeline.ts`:

```ts
import { skipKey } from '../analysis/broken-links.js';
```

(`skipKey(path: string): string` is exported from `packages/core/src/audit/analysis/broken-links.ts`; it normalises a path for comparison.)

2. Replace the one-page block with:

```ts
  // Note for only 1 page recorded but more found, or links to other pages of the same site (T-84, ADR 0042)
  const onlyPage = crawl.pages.length === 1 ? crawl.pages[0] : undefined;
  const linksToOtherPages =
    !!onlyPage && (onlyPage.links ?? []).some((l) => !l.leavesSite && skipKey(l.to) !== skipKey(onlyPage.urlPath));
  if (onlyPage && (crawl.coverage.found > 1 || linksToOtherPages)) {
    const note = onlyOnePageNoteText();
    if (!notes.includes(note)) notes.push(note);
  }
```

3. In the speed `try` block only, replace the `record(...)` call with:

```ts
    // The step ran to its end: when nothing could be measured, the "Speed was not measured." note below says so.
    record('speed', 'measuring-speed', speedSource !== 'not-measured');
```

Do not touch the `record(...)` in the `catch` block.

## Tests

Edit `packages/core/tests/audit-pipeline.test.ts`. The existing one-page test (it expects `result.notes` to contain `'Only 1 page was read.'`, about line 846) uses `found: 5`; it must still pass. Copy its setup.

Add:

- `'a one-page site with only a link that leaves the site gets no one-page note'`: one recorded page `/`, `coverage.found: 1`, its links `[{ to: 'https://facebook.com/shop', leavesSite: true }]`. Expect `result.notes` not to contain `'Only 1 page was read.'`.
- `'a one-page site that only links to itself gets no one-page note'`: links `[{ to: '/' }]`, `found: 1`. Expect no note.
- `'one page read but a link to another page of the site gets the note'`: links `[{ to: '/about' }]`, `found: 1`. Expect the note.
- `'speed that could not be measured gives one note, not two'`: stages where `measureSampleSpeeds` returns not-measured for every page and no page has browser timing. Expect `result.notes` to contain `'Speed was not measured.'` and not to contain `'The speed step did not finish, so speed was not measured.'`, and the `speed` step to have `status: 'not-done'`.

Run: `pnpm exec vitest run packages/core/tests/audit-pipeline.test.ts`, then `pnpm build`.

## Done when

- [ ] The four new tests pass; existing tests pass.
- [ ] The "speed step did not finish" note is written only when the speed step threw.
- [ ] `pnpm build` passes.

## Notes

- If importing `skipKey` from `broken-links.js` causes an import cycle warning in the build, import it from `'../analysis/index.js'` instead only if that index already exports it; otherwise keep the direct import.
