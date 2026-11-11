# T-338: Spec Conformance: text expectations ignore case, URL patterns are capped wildcards, API paths match whole segments

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/spec-conformance.ts`
- `packages/checkers/tests/spec-url-pattern.test.ts`
- `packages/checkers/tests/spec-text-and-api-match.test.ts` (new)

**Do not build in parallel with:** T-343 (edits `spec-conformance.ts`).

## Problem

Three matching rules in `spec-conformance.ts` are looser or stricter than a person expects.

Text expectations (`:315`, `:350`) check `pageText.includes(contains)` against `innerText`. `innerText` applies CSS `text-transform`, so a button written "Sign up" and shown as "SIGN UP" is not found, and the checker raises a false Major "Expected text not found". The same happens with runs of spaces or a non-breaking space.

URL patterns (`urlMatchesPattern`, `:24-34`) build a regular expression from text that an AI or a source document wrote (`:30`). There is no length limit and no guard, so a hostile document can make a slow pattern, and `?` is read as a quantifier in the regex branch (`/inventory-item.html?id=4` is saved only because the wildcard reading is tried first).

The API path check (`:547`) uses `r.url.includes(apiPath)`, so `/api/users` also matches `/api/users-export`.

## Current code

Branch from `main`.

`packages/checkers/src/spec-conformance.ts` (`grep -n "pageText.includes\|new RegExp\|r.url.includes" packages/checkers/src/spec-conformance.ts`):

```ts
  const asWildcard = new RegExp('^' + pattern.split('*').map(escape).join('.*') + '$');
  ...
    asRegex = new RegExp('^(?:' + pattern.replace(/\*/g, '.*').replace(/\//g, '\/') + ')$');
  ...
      if (contains && !pageText.includes(contains)) {
  ...
      if (notContains && pageText.includes(notContains)) {
  ...
        .find((r) => r.method === method && r.url.includes(apiPath));
```

`packages/checkers/tests/spec-url-pattern.test.ts` already requires `/dashboard|/account` and `^/invoices/new$` to match. Keep those two working.

## Change

1. Add and export two small helpers in `spec-conformance.ts`:
   - `normaliseText(s: string): string` returns `s.replace(/\s+/g, ' ').trim().toLowerCase()` (non-breaking space is `\s` in JavaScript).
   - `apiPathMatches(requestUrl: string, apiPath: string): boolean`: parse the request with `new URL(requestUrl, 'http://x')`, take `pathname`, and match when it equals `apiPath`'s pathname or continues with `/` right after it (whole segments). If `apiPath` has a query part, also require every `key=value` of it in the request's `searchParams`. A `*` in `apiPath` is a wildcard for one or more characters (same `*` rule as URL patterns).
2. Text checks: compute `const haystack = normaliseText(pageText)` once, and compare `haystack.includes(normaliseText(contains))` and `haystack.includes(normaliseText(notContains))`. Keep the finding text showing the original wording.
3. `urlMatchesPattern`: remove the `new RegExp` of the whole pattern. New rule, in plain words: if the pattern is longer than 300 characters, return false. Split on `|` into alternatives; for each, drop one leading `^` and one trailing `$`, then treat `*` as "any characters" and every other character as itself (`?`, `.`, `(`, `+` are literal). Build the regular expression only from escaped pieces joined with `.*`, so it cannot backtrack badly. Match any alternative against any address.
4. API check: replace `r.url.includes(apiPath)` with `apiPathMatches(r.url, apiPath)`.
5. `spec-url-pattern.test.ts`: change `does not break on a pattern that is not a valid regular expression` only if it fails (it should still pass: `/search(1` is literal). Add cases listed below.
6. Run `pnpm exec prettier --write` on the touched files.

## Tests

- `packages/checkers/tests/spec-url-pattern.test.ts` (add): a 301-character pattern never matches (returns false at once); `/a+b` matches `/a+b` and not `/aab`; `/users?` matches `/users?` literally and not `/user`; `(a+)+$` against `'a'.repeat(5000) + '!'` returns within one second (use `Date.now()` before and after, expect under 1000 ms).
- `packages/checkers/tests/spec-text-and-api-match.test.ts` (new, unit tier): `normaliseText('  Sign\u00a0 UP ')` is `'sign up'`; `apiPathMatches('http://s.test/api/users?id=1', '/api/users')` is true; `'/api/users/7'` true; `'/api/users-export'` false; `'/api/user'` false; `'/api/v1/items?limit=5&x=1'` against `'/api/v1/items?limit=5'` true. If you can call `SpecConformanceChecker.check` with a fake page (`innerText`, `title`, `url` stubs), add one case where the page text is `SIGN UP` and the expectation is `Sign up`: no finding.

Run: `pnpm exec vitest run packages/checkers/tests/spec-url-pattern.test.ts packages/checkers/tests/spec-text-and-api-match.test.ts`, then `pnpm exec vitest run --project unit packages/checkers/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "new RegExp('^(?:'" packages/checkers/src/spec-conformance.ts` finds nothing.
- [ ] `grep -n "r.url.includes" packages/checkers/src/spec-conformance.ts` finds nothing.
- [ ] The new and changed tests pass; `pnpm build` passes.

## Notes

- Audit findings M22 (part), M23, L7 (part) (audit of 11 Nov 2026 on `d225418`).
- Behaviour change to record in the commit: a hand-written pattern that used real regex features (groups, `\d`, `+`) now reads as plain text. The documented forms (plain address, `*` wildcard, `a|b`, `^...$`) keep working.
- Related: T-337 (same package, different files), T-339 and T-340 (other checker matching bugs).
