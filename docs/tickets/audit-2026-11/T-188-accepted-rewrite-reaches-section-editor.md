# T-188: Website Audit: an accepted rewrite shows in the Section editor straight away

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/audit/ai/RewriteReview.tsx`
- `packages/wizard/src/screens/audit/documents/ReviewDocumentsScreen.tsx`
- `packages/wizard/tests/audit-rewrite-review.test.tsx`

**Do not build in parallel with:** none.

## Problem

Accepting new copy for a Section saves it on the runner as an edit, but the review screen's own copy of the edits (`edits` state in `ReviewDocumentsScreen`) is not refreshed. The Section editor above keeps showing the old text. Scenario: accept a rewrite, then change another field of the same Section by hand and Save; the hand edit is built on the stale text and overwrites the accepted copy.

## Current code

`packages/wizard/src/screens/audit/ai/RewriteReview.tsx:260-275` (branch `worktree-audit-cleanup`)

```tsx
export interface RewriteReviewProps {
  auditId: string;
  /** The version; the latest when not given. */
  version?: number;
  /** The page whose Sections are rewritten. */
  content: PageContent;
  /** The language of the new copy; the page's own when it is a listed language. */
  language?: DocumentLanguage;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
}

type Loaded = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded' };

/** Rewrite a page's Sections after approval (REQ-030). Mounted in the Website Audit result screen. */
export function RewriteReview({ auditId, version, content, language, fetchImpl }: RewriteReviewProps) {
```

`RewriteReview.tsx:341-352` (inside `accept`)

```tsx
    const outcome = await acceptNewCopy(auditId, { ...target(sectionId), text }, fetchImpl);
    if (outcome.ok) {
      setFor(setRewrites, sectionId, outcome.value);
      setFor<RewriteMessage>(setMessages, sectionId, {
        tone: 'pass',
        text: 'Accepted. The new copy is in the Audit Documents.',
      });
    } else {
```

`packages/wizard/src/screens/audit/documents/ReviewDocumentsScreen.tsx:344-352` (inside `ReviewDocumentsView`)

```tsx
      {content?.status === 'loaded' &&
        (aiConfigured === true ? (
          <RewriteReview
            key={content.content.urlPath}
            auditId={reply.summary.auditId}
            version={reply.version.version}
            content={content.content}
            fetchImpl={fetchImpl}
          />
```

`ReviewDocumentsViewProps` ends (lines 283-287):

```tsx
  /** An AI key is set up: true shows the Section rewrite, false shows how to add a key, null (not known yet) shows neither. */
  aiConfigured?: boolean | null;
  /** For tests: the requests of the Section rewrite. */
  fetchImpl?: Fetch;
}
```

In `ReviewDocumentsScreen` (line 562 on) the state is `const [edits, setEdits] = useState<EditOverlay | null>(null);` (line 571) and `loadEdits(auditId, versionNumber, fetchImpl)` is already used at line 636:

```tsx
      const stored = await loadEdits(auditId, versionNumber, fetchImpl);
      if (stored.ok) setEdits(stored.value);
```

## Change

1. `RewriteReview.tsx`: add to `RewriteReviewProps`, after `language`:

```tsx
  /** Called after new copy was accepted: the stored edits changed, so the caller re-reads them. */
  onAccepted?: () => void;
```

2. Add `onAccepted` to the destructured props of `RewriteReview`:

```tsx
export function RewriteReview({ auditId, version, content, language, onAccepted, fetchImpl }: RewriteReviewProps) {
```

3. In `accept`, inside `if (outcome.ok) {`, add as the last statement of that block:

```tsx
      onAccepted?.();
```

4. `ReviewDocumentsScreen.tsx`: add to `ReviewDocumentsViewProps`, before `fetchImpl`:

```tsx
  /** New copy was accepted for a Section: the stored edits are re-read. */
  onRewriteAccepted?: () => void;
```

5. Add `onRewriteAccepted,` to the destructured props of `ReviewDocumentsView` (before `fetchImpl,`), and pass it on:

```tsx
          <RewriteReview
            key={content.content.urlPath}
            auditId={reply.summary.auditId}
            version={reply.version.version}
            content={content.content}
            onAccepted={onRewriteAccepted}
            fetchImpl={fetchImpl}
          />
```

6. In `ReviewDocumentsScreen`, directly after the `save` function, add:

```tsx
  /** An accepted rewrite is a stored edit: show what is stored now, so a later hand edit starts from it. */
  const reloadEdits = async () => {
    const stored = await loadEdits(auditId, versionNumber, fetchImpl);
    if (stored.ok) setEdits(stored.value);
  };
```

7. Where `ReviewDocumentsScreen` renders `<ReviewDocumentsView … />`, add the prop `onRewriteAccepted={() => void reloadEdits()}`.

## Tests

Edit `packages/wizard/tests/audit-rewrite-review.test.tsx`. It reads source or renders views; add a source-level guard (copy the `readFileSync` pattern from `packages/wizard/tests/landing-audit.test.tsx` if this file has none):

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('accepted rewrite reaches the Section editor', () => {
  const review = readFileSync(resolve(__dirname, '../src/screens/audit/ai/RewriteReview.tsx'), 'utf8');
  const screen = readFileSync(resolve(__dirname, '../src/screens/audit/documents/ReviewDocumentsScreen.tsx'), 'utf8');
  it('tells the caller after an accept', () => {
    expect(review).toMatch(/onAccepted\?\.\(\);/);
  });
  it('re-reads the stored edits', () => {
    expect(screen).toMatch(/onAccepted=\{onRewriteAccepted\}/);
    expect(screen).toMatch(/onRewriteAccepted=\{\(\) => void reloadEdits\(\)\}/);
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/audit-rewrite-review.test.tsx packages/wizard/tests/audit-documents-review.test.tsx` then `pnpm build`.

## Done when

- [x] After accepting new copy, the Section editor shows the accepted text without a page reload.
- [x] Unsaved hand edits in the draft are kept (only `edits` is replaced, never `draft`).
- [x] Tests and `pnpm build` pass.

## Notes

- Do not parse `edits` out of the accept reply; re-reading with `loadEdits` reuses the checked path.
- Do not call `setDraft` in `reloadEdits`.
