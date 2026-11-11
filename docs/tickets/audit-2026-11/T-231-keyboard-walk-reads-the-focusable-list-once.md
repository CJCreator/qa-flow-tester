# T-231: the Tab walk rebuilds the list of focusable elements on every key press

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | speed | todo |

**Files you may edit (no others):**

- `packages/checkers/src/keyboard-a11y.ts`
- `packages/checkers/tests/keyboard-a11y.test.ts`

**Do not build in parallel with:** nothing.

## Problem

`KeyboardA11yChecker.walkTabOrder` presses Tab up to 60 times. After each press `readStop` runs one `page.evaluate` that finds every focusable element on the page and calls `getBoundingClientRect` and `getComputedStyle` on each one, only to learn the position (`idx`) of the focused element in that list. On a page with 300 focusable elements that is about 18,000 layout reads per walk, at every screen size and Role.

The list only changes when the page changes. Build it once per walk and rebuild it only when the page changed.

## Current code

Find it with `grep -n "const list = Array.from" packages/checkers/src/keyboard-a11y.ts` and `grep -n "async walkTabOrder" packages/checkers/src/keyboard-a11y.ts`.

`packages/checkers/src/keyboard-a11y.ts`, inside `readStop`:

```ts
const list = Array.from(
  document.querySelectorAll(
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]'
  )
).filter((e) => !(e as HTMLInputElement).disabled && e.getAttribute('tabindex') !== '-1' && visible(e));
const r = el.getBoundingClientRect();
```

`walkTabOrder` (same file):

```ts
  async walkTabOrder(page: Page, opts: { maxPresses?: number } = {}): Promise<TabWalk> {
    const max = opts.maxPresses ?? 60;
    await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body) a.blur();
    });
    const stops: TabStop[] = [];
    let leftPage = false;
    let wrapped = false;
    let focusableCount = 0;
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      const stop = await readStop(page);
      if (!stop) {
        leftPage = true;
        break;
      }
      focusableCount = stop.focusableCount;
      const first = stops[0];
      stops.push(stop);
      if (first && first.idx >= 0 && stop.idx === first.idx) {
        const distinct = new Set(stops.map((s) => s.idx)).size;
        if (distinct >= focusableCount - 1) {
          wrapped = true;
          break;
        }
      }
    }
    return { stops, leftPage, wrapped, focusableCount };
  }
```

`readStop` is also called once outside a walk (in the focus-trap check, `const after = await readStop(page);`). That call must keep reading the list fresh.

## Change

1. In `readStop`, add this type above the function (module level, after the `TabWalk` interface):

```ts
/** Kept on `window` during one Tab walk so the list of focusable elements is not rebuilt on every press. */
interface TabCache {
  list: Element[] | null;
  size: string;
  /** Set by the observer when anything in the page changed since the list was built. */
  dirty: boolean;
  observer: MutationObserver;
}
```

2. In `readStop`, replace the `const list = Array.from(...)...;` statement shown above (keep the `const r = el.getBoundingClientRect();` line after it) with:

```ts
const cache = (window as unknown as { __qaTabCache?: TabCache }).__qaTabCache;
const size = `${window.innerWidth}x${window.innerHeight}`;
// The cached list is good while nothing changed in the page and the window kept its size.
// `takeRecords` catches a change the observer has not reported yet.
const unchanged = !!cache && !cache.dirty && cache.observer.takeRecords().length === 0 && cache.size === size;
let list: Element[] | null = unchanged && cache!.list ? cache!.list : null;
// A focused element missing from the list may have just appeared (a menu that opens on focus): read again.
if (list && !list.includes(el)) list = null;
if (!list) {
  list = Array.from(
    document.querySelectorAll(
      'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]'
    )
  ).filter((e) => !(e as HTMLInputElement).disabled && e.getAttribute('tabindex') !== '-1' && visible(e));
  if (cache) {
    cache.list = list;
    cache.size = size;
    cache.dirty = false;
  }
}
```

Everything after it in `readStop` stays as it is (it uses `list.indexOf(el)` and `list.length`).

3. Replace the whole `walkTabOrder` method with this (the loop body is unchanged; it is wrapped in `try/finally` and the setup installs the cache):

```ts
  async walkTabOrder(page: Page, opts: { maxPresses?: number } = {}): Promise<TabWalk> {
    const max = opts.maxPresses ?? 60;
    await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body) a.blur();
      // One list of focusable elements for the whole walk; any change in the page marks it stale.
      const w = window as unknown as { __qaTabCache?: TabCache };
      w.__qaTabCache?.observer.disconnect();
      const cache: TabCache = {
        list: null,
        size: '',
        dirty: false,
        observer: new MutationObserver(() => {
          cache.dirty = true;
        }),
      };
      cache.observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      w.__qaTabCache = cache;
    });
    const stops: TabStop[] = [];
    let leftPage = false;
    let wrapped = false;
    let focusableCount = 0;
    try {
      for (let i = 0; i < max; i++) {
        await page.keyboard.press('Tab');
        const stop = await readStop(page);
        if (!stop) {
          leftPage = true;
          break;
        }
        focusableCount = stop.focusableCount;
        const first = stops[0];
        stops.push(stop);
        if (first && first.idx >= 0 && stop.idx === first.idx) {
          const distinct = new Set(stops.map((s) => s.idx)).size;
          if (distinct >= focusableCount - 1) {
            wrapped = true;
            break;
          }
        }
      }
    } finally {
      // Drop the cache so a later `readStop` (the focus-trap check) reads the page fresh.
      await page
        .evaluate(() => {
          const w = window as unknown as { __qaTabCache?: TabCache };
          w.__qaTabCache?.observer.disconnect();
          delete w.__qaTabCache;
        })
        .catch(() => {});
    }
    return { stops, leftPage, wrapped, focusableCount };
  }
```

The `TabCache` type is erased at compile time, so using it inside `page.evaluate` is fine.

4. Run `pnpm exec prettier --write packages/checkers/src/keyboard-a11y.ts packages/checkers/tests/keyboard-a11y.test.ts`.

## Tests

Add to `packages/checkers/tests/keyboard-a11y.test.ts`, inside `describe('keyboard traversal', ...)` (the file's `open(html)` helper and `checker` are already in scope). This file is in the browser tier (it launches Chromium).

1. `it('reads each element's size about once per walk, not once per press', ...)`:
   - `const page = await open(Array.from({ length: 12 }, (_, i) => `<button>${i}</button>`).join(''));`
   - Before the walk, count the layout reads:

```ts
await page.evaluate(() => {
  const w = window as unknown as { __rects: number };
  w.__rects = 0;
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    w.__rects++;
    return original.call(this);
  };
});
```

- `const walk = await checker.walkTabOrder(page);` then `const rects = await page.evaluate(() => (window as unknown as { __rects: number }).__rects);` then `await page.close();`
- Assert `walk.focusableCount` is `12`, `walk.stops.length` is at least `12`, and `rects` is less than `60`. (Before this change the count is above 150.)

2. `it('picks up an element that appears during the walk', ...)`:
   - HTML: `<button id="a">A</button><button id="b">B</button><button id="c">C</button>` plus `<script>document.getElementById("b").addEventListener("focus",()=>{if(!document.getElementById("late")){const l=document.createElement("button");l.id="late";l.textContent="L";document.body.appendChild(l);}});</script>`
   - `const walk = await checker.walkTabOrder(page);` then close the page.
   - Assert `walk.stops.some((s) => s.selector === '#late')` is true and `walk.focusableCount` is `4`.

Run: `pnpm exec vitest run --project browser packages/checkers/tests/keyboard-a11y.test.ts` (install Chromium first if needed: `pnpm --filter @qa/core exec playwright install chromium`). Then `pnpm build`.

## Done when

- [ ] `grep -c "__qaTabCache" packages/checkers/src/keyboard-a11y.ts` is at least 4.
- [ ] Both new tests pass and every other test in `keyboard-a11y.test.ts` passes unchanged.
- [ ] `pnpm build` passes.

## Notes

- Why the observer sets a flag: a `MutationObserver` delivers its records to the callback before the next `page.evaluate` runs, so `takeRecords()` alone would always be empty. The `dirty` flag is the real signal; `takeRecords()` only covers a change that has not been delivered yet.
- Known small difference: an element that becomes visible only through a CSS rule such as `:focus-within`, with no change to the page's markup, is not seen until the focus lands on it (then the "not in the list" rule rebuilds the list). Before this change it was seen one press earlier. This only moves `idx` and `focusableCount` of stops in that window; the findings come from the same data.
- Do not change `detectTrap`, `TabStop` or the checks that use the walk.
