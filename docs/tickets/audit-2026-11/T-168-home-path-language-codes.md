# T-168: any two-letter path is treated as the home page by the marketing checks

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | built |

**Files you may edit (no others):**
- `packages/checkers/src/marketing.ts`
- `packages/checkers/tests/marketing-review.test.ts`

**Do not build in parallel with:** none.

## Problem
`isHomePath` treats every path of two letters (optionally plus `-xx`) as a language home page, like `/en` or `/pt-br`. So `/ai`, `/go`, `/us` and `/hr` count as the home page. The home-only marketing rules then run there and report things like "The home page has no clear call to action" for a page that is not the home page.

## Current code
`packages/checkers/src/marketing.ts:248-258` (branch `worktree-audit-cleanup`)
```ts
/** The home page, or the page the run started from, or a language's home such as /en or /pt-br. */
export function isHomePath(urlPath: string, baseUrl?: string): boolean {
  const here = normalise(urlPath);
  if (HOME_PATHS.has(here) || /^\/[a-z]{2}(-[a-z]{2})?$/i.test(here)) return true;
  if (!baseUrl) return false;
  try {
    return normalise(new URL(baseUrl).pathname) === here;
  } catch {
    return false;
  }
}
```

## Change
1. Add this constant directly above `isHomePath`:
```ts
/** Language codes sites commonly use for a language home (/en, /fr, /pt-br). Not every two letters: /ai, /go, /us are pages. */
const LANGUAGE_HOME_CODES = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'nb', 'fi', 'pl', 'cs', 'sk', 'hu', 'ro', 'bg',
  'el', 'tr', 'ru', 'uk', 'ar', 'he', 'hi', 'ta', 'te', 'bn', 'ur', 'th', 'vi', 'id', 'ms', 'ja', 'ko', 'zh',
]);

/** `/en`, `/pt-br`: a known language code, with an optional two-letter region. */
function isLanguageHome(here: string): boolean {
  const m = here.match(/^\/([a-z]{2})(?:-[a-z]{2})?$/i);
  return !!m && LANGUAGE_HOME_CODES.has(m[1].toLowerCase());
}
```
2. Replace the second line of the `isHomePath` body with:
```ts
  if (HOME_PATHS.has(here) || isLanguageHome(here)) return true;
```
Run `pnpm exec prettier --write packages/checkers/src/marketing.ts` afterwards; it may reflow the Set onto different lines.

## Tests
Edit `packages/checkers/tests/marketing-review.test.ts`. The existing test `is the root, an index page, a language home, or the page the run started from` already checks `/`, `/index.html`, `/home`, `/en`, `/en/`, `/pt-br` as true and must pass unchanged. Add a test in the same `describe('What counts as the home page', ...)`:
```ts
  it('does not treat every two-letter path as a language home', () => {
    for (const path of ['/ai', '/go', '/us', '/hr', '/qa', '/xx-yy']) expect(isHomePath(path), path).toBe(false);
    for (const path of ['/fr', '/de', '/ta', '/zh-cn', '/EN']) expect(isHomePath(path), path).toBe(true);
    // The page the run started from is still the home page, whatever its name.
    expect(isHomePath('/ai', 'https://example.com/ai')).toBe(true);
  });
```

Run: `pnpm exec vitest run packages/checkers/tests/marketing-review.test.ts packages/checkers/tests/marketing.test.ts`

## Done when
- [x] The new test passes; both marketing test files pass unchanged otherwise.
- [x] `pnpm build` passes.

## Notes
- `hr` (Croatian) is left out on purpose: `/hr` is far more often a Human Resources page.
- The start address of the Check-up always counts as home through the `baseUrl` branch, so a site whose home is `/us` still works when the Check-up starts there.
