# T-349: Marketing checks need a real call to action and contact link, and the cookie-notice scan is bounded

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/marketing.ts`
- `packages/checkers/tests/marketing-heuristics.test.ts` (new)
- `vitest.workspace.ts`

**Do not build in parallel with:** T-308, T-336, T-341, T-379, T-380 (all edit `vitest.workspace.ts`).

## Problem

`MarketingChecker` reads the page in one `page.evaluate` (`collectDetails`, `packages/checkers/src/marketing.ts:399`). Several of its yes/no answers are too easy to satisfy, so a missing basic is reported as present:

- Call to action (`:409-412`): any link or button of 40 characters or fewer that contains `start`, `try`, `free` or `learn more` counts. "Free shipping info" or "Getting started" is not a call to action.
- Contact route (`:415-419`): a link whose text contains `help` counts. "Help" alone is a docs link, not a way to reach a person.
- Trust signals (`:463-470`): any `<blockquote>` or any class containing `review` counts, and so does the text `3/5` anywhere. A quote in a blog post is not proof from customers.
- Cookie notice (`:480-495`): when no known banner selector matches, the code reads `textContent` of every visible `div`, `aside` and `footer` on the page. On a large page that is slow, and a long article that mentions cookies and "accept" matches.

The tests for this checker give `page.evaluate` a fake answer (`packages/checkers/tests/marketing.test.ts`), so none of this page code is tested today.

## Current code

Branch from `main`.

`packages/checkers/src/marketing.ts` (`grep -n "ctaWords\|contact|support|help\|hasCookieNotice =" packages/checkers/src/marketing.ts`):

```ts
        const ctaWords =
          /\b(get started|start|try|sign up|join|buy|book|schedule|request|demo|subscribe|download|shop|order|free|contact us|learn more)\b/i;
        const hasCallToAction = Array.from(document.querySelectorAll('a, button, [role="button"]')).some(
          (el) => visible(el) && textOf(el).length > 0 && textOf(el).length <= 40 && ctaWords.test(textOf(el))
        );
```

```ts
            /contact|support|help/i.test(textOf(a)) ||
```

```ts
          Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], aside, footer, div')).some(
```

## Change

1. Call to action: count only a `<button>`, an element with `role="button"`, or a link that is styled as a button (class containing `btn` or `button`, or `role="button"`). Use phrases, not single words: `get started`, `start (free|now|your)`, `try (it |for )?free`, `try (it|now)`, `sign up`, `join`, `buy`, `book`, `schedule`, `request`, `demo`, `subscribe`, `download`, `shop`, `order`, `contact us`. Drop bare `start`, `try`, `free` and `learn more`.
2. Contact route: drop `help` from the text test (keep `contact`, `support`, `mailto:` and `tel:`). A link to `/help` alone no longer counts.
3. Trust signals: drop the bare `blockquote` and `[class*="review" i]` selectors. Keep `testimonial`, `rating`, `itemprop=review|aggregateRating`, and add `blockquote` only when it sits inside an element whose class or id mentions `testimonial` or `review`. Require the rating text to read `rated \d(\.\d)? (out )?of 5` or `\d(\.\d)?\s?\/\s?5 stars`, not any `n/5`.
4. Cookie notice: after the known banner selectors, scan only `[role="dialog"], [role="alertdialog"]` and elements whose computed `position` is `fixed` or `sticky`, taken from a list capped at 200 nodes (`slice(0, 200)`). Remove the `aside, footer, div` scan.
5. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.
6. In `vitest.workspace.ts`, add `'marketing-heuristics'` to the `checkers` list of `BROWSER_TESTS` (the new test launches Chromium).

## Tests

New file `packages/checkers/tests/marketing-heuristics.test.ts`. It launches Chromium and sets pages with `page.setContent`, then calls `new MarketingChecker().checkPage(page, ctx)` and reads which "missing" findings appear (`ctx` as in `marketing.test.ts`). Cases:

- A page whose only button text is "Free shipping info": the call-to-action finding is present. A page with `<button>Get started</button>`: it is absent. A link with class `btn` and text "Try it free": absent.
- A page whose only link is "Help": the contact finding is present. A page with `mailto:` or a "Contact us" link: absent.
- A page with one `<blockquote>` in an article and text "scored 3/5": the trust finding is present. A page with a `.testimonial` block: absent.
- A page with a 5,000-word article that mentions cookies and "accept" in a plain `div`: the cookie finding is present (when analytics is on). A page with a fixed-position `div` "We use cookies. Accept": absent.

Run: `pnpm exec vitest run --project browser packages/checkers/tests/marketing-heuristics.test.ts`, then `pnpm exec vitest run packages/checkers/tests/marketing.test.ts packages/checkers/tests/marketing-review.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -n "help" packages/checkers/src/marketing.ts` no longer finds the contact regex.
- [ ] `grep -n "marketing-heuristics" vitest.workspace.ts` finds the browser entry.
- [ ] The four groups of cases above pass in Chromium; the existing marketing tests and `pnpm build` pass.

## Notes

- Audit finding L7 (audit of 11 Nov 2026 on `d225418`).
- These are heuristics that report "missing" facts as Suggestions or Minor; a stricter rule can only add findings. The wording of the findings does not change.
