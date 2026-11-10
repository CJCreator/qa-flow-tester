# T-151: The AI prompts keep four copies of the claim-word list and of two helpers, and they have drifted

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core/audit | inconsistency | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/ai/claim-words.ts`
- `packages/core/src/audit/ai/stage-ai.ts`
- `packages/core/src/audit/ai/assessment.ts`
- `packages/core/src/audit/ai/page-recommendation.ts`
- `packages/core/src/audit/ai/rewrite.ts`
- `packages/core/src/audit/preview/prompt.ts`
- `packages/core/tests/audit-claim-words.test.ts`

**Do not build in parallel with:** T-138, T-145, T-149, T-155 (edit `assessment.ts`, `page-recommendation.ts` or `stage-ai.ts`); T-148 (same test file).

## Problem

Four prompt modules each tell the AI which words it must not use. Three of the lists leave out "release verdict" and "not ready yet", which `findClaimWords` flags. An answer that uses one of them is then rejected and costs a second (repair) request that the prompt could have prevented.

The same four modules each define an identical `languageName`. `assessment.ts` also has a `logAiFailure` that repeats the redaction regular expressions of `redactAiMessage` in `stage-ai.ts`.

## Current code

Branch `worktree-audit-cleanup`.

`packages/core/src/audit/ai/page-recommendation.ts:277` and `packages/core/src/audit/ai/rewrite.ts:158` (identical):

```ts
const NOT_ALLOWED =
  'compliant, compliance, certified, secure, safe, hack-proof, fully accessible, passes WCAG, ready to release, release-ready';
```

`packages/core/src/audit/preview/prompt.ts:137`:

```ts
const NOT_ALLOWED =
  'compliant, compliance, certified, secure, safe, hack-proof, fully accessible, passes WCAG, ready to release, release-ready, release verdict, not ready yet';
```

`packages/core/src/audit/ai/assessment.ts`, inside `basePrompt` (system text):

```ts
    'Never say a site or page is compliant, compliance, certified, secure, safe, hack-proof, fully accessible, ' +
    'passes WCAG, ready to release or release-ready. Output valid JSON only.';
```

and inside `repairPrompt`:

```ts
      `The notes for ${claim.join(', ')} use words that are not allowed (compliant, compliance, certified, ` +
        'secure, safe, hack-proof, fully accessible, passes WCAG, ready to release, release-ready). Rewrite them ' +
        'to say only what was checked and what was found, without those words.'
```

All four files (`assessment.ts:341`, `page-recommendation.ts:280`, `rewrite.ts:162`, `prompt.ts:140`):

```ts
function languageName(language: DocumentLanguage): string {
  return `${DOCUMENT_LANGUAGE_INFO[language]?.name ?? 'English'} (${language})`;
}
```

`packages/core/src/audit/ai/assessment.ts:297`:

```ts
export function logAiFailure(provider: string, err: unknown): void {
  const raw = err instanceof Error ? err.message : String(err);
  const safe = raw
    .replace(/key=[^&\s"']+/gi, 'key=[hidden]')
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [hidden]')
    .replace(/\b(sk-[\w-]{8,}|AIza[\w-]{20,}|ya29\.[\w.-]{8,})/g, '[hidden]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
  console.warn(`[Website Audit] AI request failed (${provider}): ${safe}`);
}
```

`packages/core/src/audit/ai/claim-words.ts` re-exports `CLAIM_WORDS` (an array: the ADR 0018 words followed by `'Ready to release', 'Not ready yet', 'release verdict', 'release-ready'`).

## Change

1. `claim-words.ts`: add at the end.

```ts
/** The claim words as one lower-case list for a prompt: the same words `findClaimWords` flags, so none is missed. */
export const CLAIM_WORDS_PROMPT = CLAIM_WORDS.map((w) => w.toLowerCase()).join(', ');
```

2. `stage-ai.ts`: add (import `DOCUMENT_LANGUAGE_INFO` and the type `DocumentLanguage` from `@qa/types` if not imported yet):

```ts
/** A language as the prompts name it: "Tamil (ta)". */
export function languageName(language: DocumentLanguage): string {
  return `${DOCUMENT_LANGUAGE_INFO[language]?.name ?? 'English'} (${language})`;
}
```

3. `page-recommendation.ts`, `rewrite.ts`, `prompt.ts`: delete the local `const NOT_ALLOWED = ...` and the local `languageName` function. Import instead and keep the name `NOT_ALLOWED` so the prompt strings need no other change:

```ts
import { CLAIM_WORDS_PROMPT as NOT_ALLOWED } from './claim-words.js'; // prompt.ts: '../ai/claim-words.js'
import { languageName } from './stage-ai.js'; // prompt.ts: '../ai/stage-ai.js'
```

Merge these into existing import lines from the same modules where one exists. Remove `DOCUMENT_LANGUAGE_INFO` from a file's `@qa/types` import if nothing else in that file uses it.

4. `assessment.ts`: delete the local `languageName`; import it from `'./stage-ai.js'`; import `CLAIM_WORDS_PROMPT` from `'./claim-words.js'`. Change the two strings:

```ts
    `Never say a site or page is any of: ${CLAIM_WORDS_PROMPT}. Output valid JSON only.`;
```

```ts
      `The notes for ${claim.join(', ')} use words that are not allowed (${CLAIM_WORDS_PROMPT}). Rewrite them ` +
        'to say only what was checked and what was found, without those words.'
```

(The first replaces the two-line string that starts `'Never say a site or page is compliant, ...`. Keep the string concatenation around it valid: the preceding line ends with `+`.)

5. `assessment.ts`, `logAiFailure` body becomes:

```ts
export function logAiFailure(provider: string, err: unknown): void {
  console.warn(`[Website Audit] AI request failed (${provider}): ${redactAiMessage(err, 300)}`);
}
```

`redactAiMessage` is already imported in `assessment.ts` from `'./stage-ai.js'`.

## Tests

`packages/core/tests/audit-claim-words.test.ts`: add `'the prompt list names every claim word'`: for every `w` of `CLAIM_WORDS`, expect `CLAIM_WORDS_PROMPT.split(', ')` to contain `w.toLowerCase()`; and expect it to contain `'release verdict'` and `'not ready yet'`.

Existing tests that must still pass unchanged: `packages/core/tests/audit-assessment.test.ts` (its `logAiFailure` cases near lines 366-411), `audit-page-recommendation.test.ts`, `audit-rewrite.test.ts`, `audit-preview.test.ts`. If one of them compares a whole prompt string that contained the old short list, update the expected string to the new list.

Run: `pnpm exec vitest run packages/core/tests/audit-claim-words.test.ts packages/core/tests/audit-assessment.test.ts packages/core/tests/audit-page-recommendation.test.ts packages/core/tests/audit-rewrite.test.ts packages/core/tests/audit-preview.test.ts`, then `pnpm build`.

## Done when

- [ ] One `languageName` and one claim-word prompt list exist under `packages/core/src/audit`.
- [ ] Every prompt names "release verdict" and "not ready yet".
- [ ] Tests and `pnpm build` pass.

## Notes

- `clip` and `MAX_FIELD_CHARS` are also duplicated in `assessment.ts` and `page-recommendation.ts`. Leave them: `preview/prompt.ts` uses a different cap (300), and sharing them is not worth a new module.
- `logAiFailure` now trims the text and logs an empty string instead of `undefined` for an undefined error. Console output only.
