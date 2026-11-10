# T-148: The preview template does not remove every claim word it finds

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core/audit | bug | built |

**Files you may edit (no others):**
- `packages/core/src/audit/documents/wording.ts`
- `packages/core/src/audit/preview/template.ts`
- `packages/core/tests/audit-claim-words.test.ts`
- `packages/core/tests/audit-preview.test.ts`

**Do not build in parallel with:** T-151, T-152 (edit `template.ts` or the claim-word modules).

## Problem

The template fallback for the improved-homepage preview strips ADR 0018 claim words from site text with its own regular expression. It does not match what `findClaimWords` matches:

- `findClaimWords` accepts any run of white space inside a phrase ("passes  WCAG", or a line break between the words). The strip uses the phrase with one plain space, so the words are found but not removed, and the output is never checked again.
- The strip uses `\b`, which treats a hyphen as a boundary. Once "secure" is found anywhere, "secure" is also cut out of "secure-checkout", which `findClaimWords` does not treat as a claim.

Scenario: the home page says "Our shop passes\nWCAG checks". The template preview still contains the claim.

## Current code

`packages/core/src/audit/preview/template.ts:18` (branch `worktree-audit-cleanup`)

```ts
/** Strips any ADR 0018 prohibited claim words from untrusted text. */
function sanitizeClaimText(text: string): string {
  let cleaned = text;
  const claims = findClaimWords(cleaned);
  for (const claim of claims) {
    const re = new RegExp(`\\b${claim}\\b`, 'gi');
    cleaned = cleaned.replace(re, '');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}
```

`packages/core/src/audit/documents/wording.ts:26`

```ts
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole words only, any case, any run of spaces between words: "Secure" and "passes  WCAG" match;
// "insecure" and "safety" do not.
const PATTERNS = CLAIM_WORDS.map((word) => ({
  word,
  re: new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(word).replace(/ /g, '\\s+')}(?![\\p{L}\\p{N}_-])`, 'iu'),
}));

/** The claim words in `text`, each once, in `CLAIM_WORDS` order. Empty when the text makes no claim. */
export function findClaimWords(text: string): string[] {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.word);
}
```

## Change

1. `wording.ts`: add below `findClaimWords`:

```ts
/**
 * `text` with every claim word removed, using the same matcher as `findClaimWords` (so what is found is what
 * is removed). White space left behind is collapsed.
 */
export function stripClaimWords(text: string): string {
  let cleaned = text;
  for (const p of PATTERNS) cleaned = cleaned.replace(new RegExp(p.re.source, 'giu'), '');
  return cleaned.replace(/\s+/g, ' ').trim();
}
```

2. `template.ts`: replace the import `import { findClaimWords } from '../ai/claim-words.js';` with:

```ts
import { stripClaimWords } from '../documents/wording.js';
```

(Only if `findClaimWords` is not used anywhere else in `template.ts`. If it is, keep that import and add the new one.)

3. `template.ts`: replace the whole `sanitizeClaimText` function with:

```ts
/** Strips any ADR 0018 prohibited claim words from untrusted text. */
function sanitizeClaimText(text: string): string {
  return stripClaimWords(text);
}
```

## Tests

`packages/core/tests/audit-claim-words.test.ts`: add a `describe('stripClaimWords', ...)`:

| input | expected output |
|---|---|
| `'A secure shop'` | `'A shop'` |
| `'It passes  WCAG today'` | `'It today'` |
| `'It passes\nWCAG today'` | `'It today'` |
| `'Use our secure-checkout page'` | `'Use our secure-checkout page'` |
| `'An insecure page with safety notes'` | `'An insecure page with safety notes'` |
| `'Ready to release and Certified'` | `'and'` |

Also assert, for each input above, `findClaimWords(stripClaimWords(input))` equals `[]`.

Import `stripClaimWords` from `'../src/audit/documents/wording.js'` (follow the import style already used in that test file).

`packages/core/tests/audit-preview.test.ts`: add `'the template removes a claim written across a line break'`: build `PreviewFacts` the way the file's existing template test does, with a heading or Section text `'Our shop passes\nWCAG checks'`; call `buildTemplateHtml(facts)`; expect `findClaimWords(html)` to equal `[]`.

Run: `pnpm exec vitest run packages/core/tests/audit-claim-words.test.ts packages/core/tests/audit-preview.test.ts`, then `pnpm build`.

## Done when

- [x] `template.ts` has no regular expression of its own for claim words.
- [x] Tests and `pnpm build` pass.

## Notes

- Keep `template.ts`'s own `escapeHtml` for this ticket (T-152 handles duplicated helpers).
