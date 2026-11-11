# T-232: a missing page title counts as two problems (search check and accessibility scan)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | types | inconsistency | todo |

**Files you may edit (no others):**

- `packages/types/src/problems.ts`
- `packages/types/tests/problems-key.test.ts` (new)

**Do not build in parallel with:** nothing.

## Problem

A page with no `<title>` is reported twice: by the search check ("Page is missing a title tag", Major) and by the accessibility scan (axe rule `document-title`, serious, which becomes Major). Both read as "The page is missing a title" in plain words, but they are two problems in the report, the Release Verdict, the problem list and the recommendations. The person fixes one `<title>` tag and sees two problems go away.

`problemKey` is meant to group them, but in a Check-up every finding already carries an `issueKey` written by core's `mergeDuplicateFindings` (`checker|title|where`), and that key includes the checker. So the plain-title grouping never happens. T-180 only corrected the comment.

## Owner decision needed

Which problems that two checks both report should count once?

- A. Leave it: two problems. No change. (The comment already says so.)
- B. Count the missing page title once. (Recommended default. It is the one case where both findings are page-wide and say the same thing in the same words.)
- C. Also count missing image descriptions once. Not recommended now: the accessibility scan reports one finding per element, the search check one per page, so their keys cannot match without a bigger change to the keys.

The Change below is for B. For A, close this ticket.

Scope of B: the problem is counted once in the verdict, the problem list, the recommendations and the report's counts. Each area's grade still counts it in its own area (the scoring groups findings per area), so the missing title still lowers both the Findable and the Accessible grade. That is unchanged and is deliberate.

## Current code

Find it with `grep -n "export function problemKey" packages/types/src/problems.ts`.

`packages/types/src/problems.ts`:

```ts
/**
 * The key a problem is grouped by: its `issueKey` when it has one, else its plain title. A Check-up's
 * findings always have one (core's `mergeDuplicateFindings` writes `checker|title|where`), so there the
 * same problem found by two checkers stays two problems. The plain-title fallback serves findings that
 * were never merged.
 */
export function problemKey(f: Pick<Finding, 'title'> & { issueKey?: string }): string {
  return f.issueKey ?? plainTitleText(f.title).toLowerCase();
}
```

`plainTitleText` in the same file already turns both titles into `The page is missing a title`:
the search title `Page is missing a title tag`, and the accessibility title `WCAG ... violation: Page should have title element (document-title)`.

`problemKey` is used by `groupIntoProblems` (same file), by core's `scoring.ts` and `recommendations.ts`, and the wizard compares it in `ReportScreen.tsx`.

## Change

1. In `packages/types/src/problems.ts`, replace the comment and function shown above with:

```ts
/**
 * Plain titles of problems that two checks both report, and that are one problem for a person: a
 * missing page title is found by the search check and by the accessibility scan. They share one key.
 * Add a title here only when both findings are about the whole page, so no element or page is lost.
 */
const SHARED_BETWEEN_CHECKS = new Set(['The page is missing a title']);

/**
 * The key a problem is grouped by. A problem in `SHARED_BETWEEN_CHECKS` has the same key whichever
 * check found it. Any other problem has its `issueKey` when it has one (a Check-up's findings always
 * do: core's `mergeDuplicateFindings` writes `checker|title|where`, so the same problem found by two
 * checks stays two problems), else its plain title.
 */
export function problemKey(f: Pick<Finding, 'title'> & { issueKey?: string }): string {
  const plain = plainTitleText(f.title);
  if (SHARED_BETWEEN_CHECKS.has(plain)) return plain.toLowerCase();
  return f.issueKey ?? plain.toLowerCase();
}
```

2. Run `pnpm exec prettier --write packages/types/src/problems.ts packages/types/tests/problems-key.test.ts`.

## Tests

Create `packages/types/tests/problems-key.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Finding } from '../src/index.js';
import { groupIntoProblems, problemKey } from '../src/problems.js';

const finding = (id: string, checker: string, title: string, issueKey: string, urlPath = '/') =>
  ({
    id,
    checker,
    severity: 'Major',
    title,
    issueKey,
    where: { urlPath, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: { expected: '', actual: '' },
    stepsToReproduce: [],
    evidence: {},
  }) as unknown as Finding;

const seoTitle = (urlPath = '/') =>
  finding('F1', 'seo', 'Page is missing a title tag', 'seo|Page is missing a title tag|', urlPath);
const axeTitle = (urlPath = '/') =>
  finding(
    'F2',
    'ux-quality',
    'WCAG 2.4.2 Page Titled violation: Page should have title element (document-title)',
    'ux-quality|WCAG 2.4.2 Page Titled violation: Page should have title element (document-title)|',
    urlPath
  );

describe('problemKey: a missing page title', () => {
  it('is one key for the search check and the accessibility scan', () => {
    expect(problemKey(seoTitle())).toBe(problemKey(axeTitle()));
  });

  it('groups the two findings into one problem that lists both and counts toward the first area', () => {
    const problems = groupIntoProblems([seoTitle('/'), axeTitle('/'), seoTitle('/about')]);
    expect(problems).toHaveLength(1);
    expect(problems[0].findings).toHaveLength(3);
    expect(problems[0].pages).toEqual(['/', '/about']);
    expect(problems[0].aspects).toEqual(['Findable', 'Accessible']);
  });
});

describe('problemKey: everything else is unchanged', () => {
  it('keeps the issueKey of a finding that is not shared', () => {
    const f = finding('F3', 'seo', 'Page is missing a meta description', 'seo|Page is missing a meta description|');
    expect(problemKey(f)).toBe('seo|Page is missing a meta description|');
  });

  it('falls back to the lower-cased plain title without an issueKey', () => {
    expect(problemKey({ title: 'Page is missing a meta description' })).toBe(
      'the page is missing a summary for search results'
    );
  });

  it('keeps two different problems apart', () => {
    const other = finding('F4', 'seo', 'Page is missing a meta description', 'seo|Page is missing a meta description|');
    expect(groupIntoProblems([seoTitle(), other])).toHaveLength(2);
  });
});
```

Run: `pnpm exec vitest run packages/types/tests/problems-key.test.ts packages/types/tests/problems-title.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests` (scoring and recommendation tests must still pass), then `pnpm build`.

## Done when

- [ ] `packages/types/tests/problems-key.test.ts` passes (5 tests) and `problems-title.test.ts` still passes.
- [ ] The core unit tests pass unchanged and `pnpm build` passes.
- [ ] Owner decision recorded: option B chosen (or the ticket closed for option A).

## Notes

- Do not touch `packages/core/src/finding-groups.ts`: the merge key there must keep the checker so two findings are not merged into one record with the wrong evidence. Only the grouping key changes.
- The new test file name does not clash with `problems-title.test.ts` (that file belongs to T-164 and T-165).
- If a `groupIntoProblems` assertion fails on `aspects` order, the order is the order the findings are given, first area first. Keep the SEO finding first in the test.
