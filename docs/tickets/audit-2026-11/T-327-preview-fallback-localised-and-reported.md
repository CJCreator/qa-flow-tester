# T-327: The preview template is localised, filters claim words, and the result says when it fell back

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/audit/preview/template.ts`
- `packages/core/src/audit/preview/generate.ts`
- `packages/core/tests/audit-preview.test.ts`

**Do not build in parallel with:** none.

## Problem

When the AI cannot write the improved-homepage preview (no key, failure, claim words twice), `generatePreview` builds it from `buildTemplateHtml` (`packages/core/src/audit/preview/generate.ts:95`). The template has four problems:

1. **Claim words.** Menu link text goes into the page as it is, in the header and again in the footer (`packages/core/src/audit/preview/template.ts:35`, `:117`). Every other text passes `stripClaimWords`. The menu that `buildNodes` adds for links the AI left out does the same (`generate.ts:156`). Nothing checks the final page for claim words on the template path (`generate.ts:95`), while the AI path is checked with `findClaimWords` (`generate.ts:69`). A menu item called "Secure checkout" reaches a page that ADR 0018 says must never claim "secure".
2. **Fixed English.** The headings "Actions" and "Suggested improvements" (`template.ts:73`, `:90`), the fallback title "Welcome" (`:45`) and the labels "Site menu" / "Footer navigation" (`:33`, `:115`, and `generate.ts:149`) are English whatever the audit's document language. A Tamil preview gets English headings.
3. **Reserved names.** The template uses `qa-preview-menu`, `qa-preview-lead`, `qa-preview-actions`, `qa-preview-suggestions` and `qa-preview-gallery` (`template.ts:33`, `:49`, `:72`, `:89`, `:103`). The sanitiser drops every id and class that starts with the reserved `qa-preview` prefix (`packages/core/src/audit/preview/sanitize.ts:385`, `:433-439`), because the page frame owns them. So the template's names never reach the page, and its menu never gets the frame's menu style.
4. **Silent fallback.** `GeneratedPreview` declares `{ ok: false; problem }` (`generate.ts:50-52`) but `generatePreview` never returns it: every failure becomes `{ ok: true, html }` from the template. The caller cannot tell the person that the AI was asked (up to two requests, paid for with their key) and its answer was not used.

## Current code

Branch from `main`.

`packages/core/src/audit/preview/template.ts` (`grep -n "qa-preview\|Welcome\|Actions\|Suggested improvements\|aria-label" packages/core/src/audit/preview/template.ts`):

```ts
    parts.push('  <nav class="qa-preview-menu" aria-label="Site menu">');
    for (const link of facts.menu) {
      parts.push(`    <a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a>`);
    }
```

```ts
  const title = facts.title || (facts.headings.length > 0 ? facts.headings[0].text : 'Welcome');
```

```ts
    parts.push('  <section id="qa-preview-actions">');
    parts.push('    <h2>Actions</h2>');
```

```ts
    parts.push('  <section id="qa-preview-suggestions">');
    parts.push('    <h2>Suggested improvements</h2>');
```

and the footer repeats the menu under `<nav aria-label="Footer navigation">`.

`packages/core/src/audit/preview/generate.ts` (`grep -n "GeneratedPreview\|buildTemplateHtml(facts)\|'Site menu'\|text: link.text" packages/core/src/audit/preview/generate.ts`):

```ts
export type GeneratedPreview = { ok: true; html: string } | { ok: false; problem: PreviewProblem };
```

```ts
  // Fall back to template when AI fails or key is missing
  const page = chosen ?? buildNodes(buildTemplateHtml(facts), facts);
```

```ts
        ['class', 'qa-preview-menu'],
        ['aria-label', 'Site menu'],
...
      { kind: 'text', text: link.text },
```

`labelsFor(language)` in `packages/core/src/audit/documents/labels/index.ts` gives the document wording, English for a language that is not document-ready yet. Its `headings.topIssues` ("Top issues") and `headings.navigationLinks` ("Navigation links") exist in every table. `stripClaimWords` and `findClaimWords` share one matcher (`packages/core/src/audit/documents/wording.ts`).

The runner's `PreviewGenerator` type (`packages/runner/src/routes/audit-preview.ts:81-84`) is `Promise<{ ok: true; html: string } | { ok: false; problem: string }>`. The new return type below is assignable to it, so no runner file changes (T-244 owns that route).

## Change

1. `template.ts`:
   - `import { labelsFor } from '../documents/labels/index.js';` and at the top of `buildTemplateHtml`: `const { labels } = labelsFor(facts.language);`.
   - Header menu: `<nav aria-label="${escapeHtml(labels.headings.navigationLinks)}">` (no class), and link text `escapeHtml(sanitizeClaimText(link.text) || pathOf(link.href))`, where `pathOf` returns `new URL(href).pathname` (or `href` when it does not parse).
   - Remove the footer `<nav>` (it repeated the header menu). Keep an empty `<footer></footer>` only if a test needs it; otherwise drop the footer block.
   - Title fallback: `facts.title || facts.headings[0]?.text || facts.host` (no fixed English word).
   - Lead paragraph: `<p>` without a class.
   - Calls to action: `<section>` with no id and no heading (a list of the page's own buttons and links needs no English title).
   - Findings: `<section>` with no id and `<h2>${escapeHtml(labels.headings.topIssues)}</h2>`.
   - Gallery: `<section>` with no id.
   - After the change `grep -n "qa-preview" packages/core/src/audit/preview/template.ts` finds nothing.

2. `generate.ts`:
   - Change the result type and keep the problem when the AI was asked:

```ts
export type GeneratedPreview = {
  ok: true;
  html: string;
  /** 'ai' when the AI's page was used; 'template' when the page was built from the findings and Page Content. */
  source: 'ai' | 'template';
  /** Set when the AI was asked but its answer was not used: why the template was used instead. */
  problem?: PreviewProblem;
};
```

   - In `generatePreview`, keep `let problem: PreviewProblem | undefined;` and set it on each AI path that ends without a page: `first.problem` when the first ask fails, `retry.problem` when the retry fails, `'claim-words'` when the retry still has claim words, `'failed'` in the `catch`. Return `{ ok: true, html, source: chosen ? 'ai' : 'template', ...(chosen || !problem ? {} : { problem }) }`.
   - Template path: after `buildNodes(buildTemplateHtml(facts), facts)`, run the same check the AI path has: when `findClaimWords(previewNodesText(page.nodes))` is not empty, replace the nodes with `scrubClaimWords(page.nodes)`. Add `scrubClaimWords` in this file: a text node, or an `alt`, `title` or `aria-*` attribute value, that holds a claim word goes through `stripClaimWords` (import it with `findClaimWords` from `../ai/claim-words.js`); everything else is kept as it is.
   - `buildNodes`: pass the language in (`buildNodes(answer, facts)` already has `facts`), use `labelsFor(facts.language).labels.headings.navigationLinks` for the added menu's `aria-label` (the `qa-preview-menu` class stays: these nodes are added after sanitising and the frame styles them), and `{ kind: 'text', text: stripClaimWords(link.text) || pathOf(link.href) }` for each link.
   - Update the function's doc comment: "Returns `source: 'template'` and, when the AI was asked, the `problem`."

3. Run `pnpm exec prettier --write` on the two files and `pnpm build`.

## Tests

`packages/core/tests/audit-preview.test.ts`:

- `'no AI provided: builds preview copy...'`: replace `toContain('Suggested improvements')` with `toContain(labelsFor('en').labels.headings.topIssues)` and add `expect(out.source).toBe('template')` and `expect(out.problem).toBeUndefined()`.
- `'claim words in both answers...'`: add `expect(out.source).toBe('template')` and `expect(out.problem).toBe('claim-words')`.
- `'a failed or empty AI answer...'`: `failedOut.problem` is `'failed'`, both outcomes have `source: 'template'`.
- `'claim words: one retry that names them; the clean retry is kept'`: `out.source` is `'ai'`, no `problem`.
- New `'the template filters claim words from menu text and keeps no reserved names'`: facts with a menu item "Secure checkout" (href `https://shop.example.in/checkout`); `generatePreview(input-with-that-menu, {})` gives html where `findClaimWords(out.html)` is `[]`, the link to `/checkout` is still there, and `out.html` does not match `/id="qa-preview-(actions|suggestions|gallery)"|class="qa-preview-lead"/`.
- New `'the template uses the document language for its headings'`: `buildTemplateHtml({ ...previewFacts(input()), language: 'ta' })` contains `labelsFor('ta').labels.headings.topIssues` and does not contain "Suggested improvements", "Actions", "Site menu" or "Welcome".
- New `'a menu link the AI left out keeps its link but loses its claim words'`: an AI page without the menu, facts with a "Certified bakers" menu item; the added nav has the link and no claim word.
- `'the template removes a claim written across a line break'` keeps passing.

The `if (!out.ok) throw new Error(out.problem);` guards in the file still compile (`GeneratedPreview` is one object type now, so there is no narrowing to `never`); leave them or delete them, either is fine.

Run: `pnpm exec vitest run packages/core/tests/audit-preview.test.ts packages/core/tests/audit-preview-sanitize.test.ts packages/runner/tests/audit-preview-routes.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build` and `pnpm typecheck`.

## Done when

- [ ] `grep -n "qa-preview\|'Welcome'\|Suggested improvements\|Footer navigation\|'Site menu'" packages/core/src/audit/preview/template.ts` finds nothing.
- [ ] `grep -n "ok: false" packages/core/src/audit/preview/generate.ts` finds nothing.
- [ ] `grep -n "source: 'ai' | 'template'" packages/core/src/audit/preview/generate.ts` finds the result type.
- [ ] The tests above pass, the core unit tests pass, `pnpm build` and `pnpm typecheck` pass.

## Notes

- Audit findings L18 and L13, preview dead variant (audit of 11 Nov 2026 on `d225418`).
- Follow-up, not in this ticket: the runner route `POST /api/audits/:id/preview` can read `source` and `problem` and tell the person "The AI's page could not be used, so this preview uses template text" (with the problem). That route belongs to T-244; add the message after T-244 is built, in a runner ticket of its own.
- The preview frame note ("Preview of suggested changes", `sanitize.ts` `previewNote`) is outside this ticket.
