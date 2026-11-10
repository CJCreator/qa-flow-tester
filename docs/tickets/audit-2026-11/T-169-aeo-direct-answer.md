# T-169: the direct-answer check measures the wrong block and states the wrong word range

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | built |

**Files you may edit (no others):**
- `packages/checkers/src/aeo.ts`
- `packages/checkers/tests/seo.test.ts`

**Do not build in parallel with:** T-178 (same source file), T-159, T-160, T-161, T-170 (same test file).

## Problem
For a question heading ("How do I reset my password?") the AEO check looks for a short answer right under it. Three faults:
1. The walk to the answer skips every element that is not `P`, `DIV` or `UL`, including later headings. A question heading with no answer of its own is judged by the paragraph under the next heading.
2. An answer written as a numbered list, a table or a definition list (`OL`, `TABLE`, `DL`), or a bullet list (`UL`), counts as "no answer". Steps and comparisons are valid direct answers.
3. The finding text says the ideal is "30–80 words" while the check accepts 10 to 100 words.

## Current code
`packages/checkers/src/aeo.ts:16-25` (branch `worktree-audit-cleanup`)
```ts
export interface AeoPageDetails {
  jsonLdScripts: string[];
  hasBreadcrumbsNav: boolean;
  questionHeadings: Array<{ text: string; nextParagraphWordCount: number; hasAnswerParagraph: boolean }>;
```
`packages/checkers/src/aeo.ts:153-170`
```ts
    // 4. Question Headings and Direct Answer Paragraphs
    for (const qh of details.questionHeadings) {
      if (!qh.hasAnswerParagraph || qh.nextParagraphWordCount < 10 || qh.nextParagraphWordCount > 100) {
```
```ts
            expected:
              'Question headings should be followed immediately by a concise direct answer paragraph (30–80 words) for answer snippet eligibility',
            actual: qh.hasAnswerParagraph
              ? `Answer paragraph is ${qh.nextParagraphWordCount} words (ideal is 30–80 words)`
              : 'Heading is not followed by an immediate answer paragraph',
```
`packages/checkers/src/aeo.ts:220-247`, inside `collectDetails` (runs in the page)
```ts
        const questionHeadings: Array<{ text: string; nextParagraphWordCount: number; hasAnswerParagraph: boolean }> =
          [];
        headings.forEach((h) => {
          const text = (h.textContent || '').trim();
          const isQuestion = text.endsWith('?') || /^(what|how|why|when|where|who)\b/i.test(text);
          if (isQuestion && text.length > 8) {
            let nextEl = h.nextElementSibling;
            // Skip over empty whitespace elements
            while (nextEl && nextEl.tagName !== 'P' && nextEl.tagName !== 'DIV' && nextEl.tagName !== 'UL') {
              nextEl = nextEl.nextElementSibling;
            }
            if (nextEl && nextEl.tagName === 'P') {
              const pText = (nextEl.textContent || '').trim();
              const words = pText ? pText.split(/\s+/).length : 0;
              questionHeadings.push({
                text,
                nextParagraphWordCount: words,
                hasAnswerParagraph: words > 0,
              });
            } else {
              questionHeadings.push({
                text,
                nextParagraphWordCount: 0,
                hasAnswerParagraph: false,
              });
            }
          }
        });
```

## Change
1. In the `AeoPageDetails` interface, change the `questionHeadings` line to:
```ts
  questionHeadings: Array<{
    text: string;
    nextParagraphWordCount: number;
    hasAnswerParagraph: boolean;
    /** True when the answer is a list or a table: its length is not judged. */
    answerIsStructured?: boolean;
  }>;
```
2. In the check, replace the `if` line with:
```ts
      const wrongLength =
        !qh.answerIsStructured && (qh.nextParagraphWordCount < 10 || qh.nextParagraphWordCount > 100);
      if (!qh.hasAnswerParagraph || wrongLength) {
```
3. In the finding text, replace both "30–80 words" strings:
```ts
            expected:
              'Question headings should be followed immediately by a concise direct answer (a paragraph of 10–100 words, or a list or table) for answer snippet eligibility',
            actual: qh.hasAnswerParagraph
              ? `Answer paragraph is ${qh.nextParagraphWordCount} words (the check accepts 10–100 words)`
              : 'Heading is not followed by an immediate answer',
```
4. In `collectDetails`, replace the declaration of `questionHeadings` and the body of the `if (isQuestion && text.length > 8) { ... }` block with:
```ts
        const questionHeadings: Array<{
          text: string;
          nextParagraphWordCount: number;
          hasAnswerParagraph: boolean;
          answerIsStructured?: boolean;
        }> = [];
        headings.forEach((h) => {
          const text = (h.textContent || '').trim();
          const isQuestion = text.endsWith('?') || /^(what|how|why|when|where|who)\b/i.test(text);
          if (isQuestion && text.length > 8) {
            // The answer is the first content block after the heading. Another heading ends the search:
            // what follows it answers that heading, not this one.
            const BLOCKS = ['P', 'DIV', 'UL', 'OL', 'TABLE', 'DL'];
            let nextEl = h.nextElementSibling;
            while (nextEl && !BLOCKS.includes(nextEl.tagName) && !/^H[1-6]$/.test(nextEl.tagName)) {
              nextEl = nextEl.nextElementSibling;
            }
            const tag = nextEl ? nextEl.tagName : '';
            const answerText = nextEl && tag !== 'DIV' && !/^H[1-6]$/.test(tag) ? (nextEl.textContent || '').trim() : '';
            const words = answerText ? answerText.split(/\s+/).length : 0;
            questionHeadings.push({
              text,
              nextParagraphWordCount: words,
              hasAnswerParagraph: words > 0,
              answerIsStructured: words > 0 && tag !== 'P',
            });
          }
        });
```
   A `DIV` still stops the search and counts as no answer, as before.

## Tests
Edit `packages/checkers/tests/seo.test.ts`. An existing AEO test passes mock page details containing
`{ text: 'How do I reset my password?', nextParagraphWordCount: 5, hasAnswerParagraph: true }` and expects a direct-answer finding; copy its set-up (search the file for `nextParagraphWordCount`). Add:

1. A list answer of any length is accepted: same details but `questionHeadings: [{ text: 'How do I reset my password?', nextParagraphWordCount: 150, hasAnswerParagraph: true, answerIsStructured: true }]`. Expect no finding whose title contains `lacks a concise direct answer`.
2. A paragraph of 150 words is still flagged: `{ ..., nextParagraphWordCount: 150, hasAnswerParagraph: true }`. Expect one such finding, and its `expectedVsActual.actual` to contain `10–100 words`.
3. The existing 5-word test must pass unchanged.

The in-page walk (step 4) runs inside `page.evaluate`, which the unit mock replaces, so it has no unit test; check it by reading.

Run: `pnpm exec vitest run packages/checkers/tests/seo.test.ts`

## Done when
- [x] New tests pass; existing tests pass unchanged.
- [x] No "30–80" remains in `aeo.ts`.
- [x] `pnpm build` passes.

## Notes
- Owner decision made here: the text is aligned to the code (10–100 words); the threshold does not change.
- Code inside `page.evaluate` cannot use variables from outside it; keep `BLOCKS` declared inside the callback.
