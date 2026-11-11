# T-155: Redesign-or-repair asks the AI one page at a time; the preview and Pitch Glimpse are built twice

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | M | core/audit | speed | built |

**Files you may edit (no others):**
- `packages/core/src/audit/ai/page-recommendation.ts`
- `packages/core/src/audit/preview/generate.ts`
- `packages/core/src/audit/documents/pitch.ts`
- `packages/core/src/audit/documents/write-all.ts`
- `packages/core/tests/audit-page-recommendation.test.ts`

**Do not build in parallel with:** T-138, T-151 (edit `page-recommendation.ts`); T-150 (edits `write-all.ts`).

## Problem

1. `recommendPages` sends its AI requests one after another: up to two per Sample Page. ADR 0043 says AI work after the crawl runs in a pool. With 20 Sample Pages this step alone takes 20 to 40 request times.
2. `generatePreview` runs `buildNodes` (the HTML sanitiser) on the chosen AI answer once to check it for claim words, throws the result away and runs it again on the same text.
3. `write-all.ts` builds the Pitch Glimpse document, then calls `buildPitchGlimpse`, which builds the same document a second time before rendering it.

None of these changes what is produced.

## Current code

Branch `worktree-audit-cleanup`.

`packages/core/src/audit/ai/page-recommendation.ts:83`

```ts
/** Exactly one recommendation per Sample Page, in input order; one AI request at a time. */
export async function recommendPages(input: RecommendPagesInput, ai: AuditAiResolution): Promise<PageRecommendation[]> {
  const out: PageRecommendation[] = [];
  const seen = new Set<string>();
  for (const page of input.pages) {
    if (page.coverage !== 'sample' || seen.has(page.urlPath)) continue;
    seen.add(page.urlPath);
    stopIfAborted(input.signal);
    if (page.findings.length === 0 || !ai.ok) {
      out.push(ruleRecommendation(page));
      continue;
    }
    const proposed = await askForPage(ai.ai, page, input);
    out.push(proposed ?? ruleRecommendation(page));
  }
  return out;
}
```

`packages/core/src/audit/preview/generate.ts:59` (inside `generatePreview`)

```ts
  let pageText: string | null = null;
  if (options.ai) {
    const base = previewMessages(facts);
    try {
      const first = await askOnce(options, base);
      if (first.ok && first.text.trim()) {
        const candidate = buildNodes(first.text, facts);
        const claims = findClaimWords(previewNodesText(candidate.nodes));

        if (claims.length > 0) {
          const retry = await askOnce(options, [
            ...base,
            { role: 'assistant', content: first.text.slice(0, MAX_ANSWER_ECHO_CHARS) },
            { role: 'user', content: previewRetryPrompt(claims) },
          ]);
          if (retry.ok && retry.text.trim()) {
            const retriedCandidate = buildNodes(retry.text, facts);
            const retryClaims = findClaimWords(previewNodesText(retriedCandidate.nodes));
            if (retryClaims.length === 0) {
              pageText = retry.text;
            }
          }
        } else {
          pageText = first.text;
        }
      }
    } catch (err) {
      if (options.signal?.aborted) throw err;
      // AI failure: falls through to template fallback
    }
  }

  // Fall back to template when AI fails or key is missing
  const html = pageText ?? buildTemplateHtml(facts);
  const page = buildNodes(html, facts);
```

`packages/core/src/audit/documents/pitch.ts:231`

```ts
export function buildPitchGlimpse(view: EditedAuditView, options: PitchGlimpseOptions = {}): string {
  const html = renderHtml(pitchGlimpseDoc(view, options));
  return html.replace('</head>', () => `<style>${PITCH_CSS}</style>\n</head>`);
}
```

`packages/core/src/audit/documents/write-all.ts:213`

```ts
        const doc = pitchGlimpseDoc(view, pitchOpts);
        const customHtml = buildPitchGlimpse(view, pitchOpts);
        return { doc, customHtml };
```

## Change

1. `page-recommendation.ts`: replace `recommendPages` with a pooled version. Add the constant above it.

```ts
/** Pages asked at once (ADR 0043): the requests go to the AI Provider, not the audited site. */
const RECOMMEND_IN_FLIGHT = 4;

/** Exactly one recommendation per Sample Page, in input order; up to RECOMMEND_IN_FLIGHT pages are asked at once. */
export async function recommendPages(input: RecommendPagesInput, ai: AuditAiResolution): Promise<PageRecommendation[]> {
  const seen = new Set<string>();
  const pages = input.pages.filter((page) => {
    if (page.coverage !== 'sample' || seen.has(page.urlPath)) return false;
    seen.add(page.urlPath);
    return true;
  });
  const out: PageRecommendation[] = new Array(pages.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= pages.length) return;
      const page = pages[i];
      stopIfAborted(input.signal);
      if (page.findings.length === 0 || !ai.ok) {
        out[i] = ruleRecommendation(page);
        continue;
      }
      const proposed = await askForPage(ai.ai, page, input);
      out[i] = proposed ?? ruleRecommendation(page);
    }
  };
  await Promise.all(Array.from({ length: Math.min(RECOMMEND_IN_FLIGHT, pages.length) }, () => worker()));
  return out;
}
```

2. `generate.ts`: keep the sanitised result instead of the text. Replace `let pageText: string | null = null;` with:

```ts
  let chosen: ReturnType<typeof buildNodes> | null = null;
```

Replace `pageText = retry.text;` with `chosen = retriedCandidate;` and `pageText = first.text;` with `chosen = candidate;`.

Replace the two lines after the comment `// Fall back to template when AI fails or key is missing` with:

```ts
  const page = chosen ?? buildNodes(buildTemplateHtml(facts), facts);
```

3. `pitch.ts`: add an exported renderer and use it in `buildPitchGlimpse`:

```ts
/** Renders an already-built Pitch Glimpse document to its HTML page (with the Pitch Glimpse styles). */
export function renderPitchGlimpse(doc: AuditDoc): string {
  const html = renderHtml(doc);
  return html.replace('</head>', () => `<style>${PITCH_CSS}</style>\n</head>`);
}

export function buildPitchGlimpse(view: EditedAuditView, options: PitchGlimpseOptions = {}): string {
  return renderPitchGlimpse(pitchGlimpseDoc(view, options));
}
```

(Keep the existing doc comment above `buildPitchGlimpse`.)

4. `write-all.ts`: build the document once.

```ts
        const doc = pitchGlimpseDoc(view, pitchOpts);
        const customHtml = renderPitchGlimpse(doc);
        return { doc, customHtml };
```

Change the import: add `renderPitchGlimpse` to the import from `'./pitch.js'` and remove `buildPitchGlimpse` from it if `write-all.ts` no longer uses it.

## Tests

`packages/core/tests/audit-page-recommendation.test.ts`: add two tests. Copy the setup of the file's first test that passes a fake `AuditAi`.

- `'recommendations keep the input order when later pages answer first'`: five Sample Pages, each with one finding; the fake `ask` resolves page 1 after 30 ms and the others at once (use `vi.useFakeTimers()` or real short timers). Expect the returned `urlPath` list to equal the input order.
- `'at most four pages are asked at once'`: ten Sample Pages; the fake `ask` increments a counter on entry, records the maximum, waits one tick, decrements. Expect the recorded maximum to be `4` (or less) and greater than `1`.

Existing tests to keep green: `packages/core/tests/audit-preview.test.ts`, `audit-preview-sanitize.test.ts`, `audit-doc-pitch.test.ts`, `audit-doc-write-all.test.ts`.

Run: `pnpm exec vitest run packages/core/tests/audit-page-recommendation.test.ts packages/core/tests/audit-preview.test.ts packages/core/tests/audit-preview-sanitize.test.ts packages/core/tests/audit-doc-pitch.test.ts packages/core/tests/audit-doc-write-all.test.ts`, then `pnpm build`.

## Done when

- [x] `recommendPages` returns the same recommendations in the same order as before, asking up to four pages at once.
- [x] `generatePreview` calls `buildNodes` once per AI answer and once for the template.
- [x] The Pitch Glimpse document is built once in `write-all.ts`.
- [x] Tests and `pnpm build` pass.

## Notes

- If an existing test asserts that recommendation requests happen strictly one after another, change it to assert order of results instead.
- The AI Request Budget (`deps.budget.take()`) is counted inside `ask`, so the pool cannot overspend it.
