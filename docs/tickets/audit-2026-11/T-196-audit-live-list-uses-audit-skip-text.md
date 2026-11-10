# T-196: Website Audit live page list: use the audit's own Skipped Page wording, not shown as a failure

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | inconsistency | todo |

**Files you may edit (no others):**
- `packages/wizard/src/screens/audit/start/LivePageList.tsx`
- `packages/wizard/tests/audit-progress.test.tsx`

**Do not build in parallel with:** T-189 (edits `LivePageList.tsx`).

## Problem

1. The live list of a Website Audit takes its skip reasons from the Check-up's `skipReasonText` (`lib/coverage-text.ts`). Those texts speak of signing in ("Signed-out part-way"), which a Website Audit never does. The audit results use a different table, `skipText` in `screens/audit/results/SkippedPagesView.tsx`, so the same Skipped Page reads differently while running and afterwards.
2. The reason is coloured `text-fail` (red). `CONTEXT.md` (Skipped Page, line 183 on) treats a Skipped Page as not checked, never a failure.
3. The `startedAt` prop is passed by no caller and no test. It is dead.

## Current code

`packages/wizard/src/screens/audit/start/LivePageList.tsx` (branch `worktree-audit-cleanup`)

Lines 1-17:

```tsx
import { useEffect, useState } from 'react';
import type { AuditPageState } from '@qa/types/src/browser.js';
import { skipReasonText } from '../../../lib/coverage-text';
import { formatDuration } from '../../../lib/format';
import { stopAudit } from './audit-start-api';

export interface LivePageListProps {
  pages: readonly AuditPageState[];
  /** Controlled elapsed time for testing or fixed displays. */
  elapsedMs?: number;
  /** Timestamp when the audit started. */
  startedAt?: number;
  /** Override the stop action for testing. */
  onStop?: () => void | Promise<void>;
  /** Set to true when the audit has completed or stopped. */
  stopped?: boolean;
}
```

Lines 51-62:

```tsx
export function LivePageList({ pages, elapsedMs, startedAt, onStop, stopped = false }: LivePageListProps) {
  const [stopping, setStopping] = useState(false);
  const [liveElapsed, setLiveElapsed] = useState(0);

  useEffect(() => {
    if (elapsedMs !== undefined || stopped) return;
    const start = startedAt ?? Date.now();
    const interval = setInterval(() => {
      setLiveElapsed(Date.now() - start);
    }, 1000);
    return () => clearInterval(interval);
  }, [elapsedMs, startedAt, stopped]);
```

Line 102 and line 113:

```tsx
            const skipReason = p.state === 'skipped' && p.reason ? skipReasonText(p.reason) : null;
```

```tsx
                  {skipReason && <span className="text-fail">({skipReason})</span>}
```

The audit's own table, `packages/wizard/src/screens/audit/results/SkippedPagesView.tsx:4-19` and `:49-51`:

```tsx
export const SKIP_REASON_TEXT: Readonly<Record<RouteSkipReason, string>> = {
  'page-limit': 'over the max pages limit',
  'depth-limit': 'more link steps from the start address than the max depth allows',
  excluded: 'left out by the include or exclude paths',
  payment: 'a payment page: nothing on it is clicked or sent',
  ...
};

export function skipText(why: RouteSkipReason): string {
  return SKIP_REASON_TEXT[why] ?? 'reason not recorded';
}
```

`packages/wizard/tests/audit-progress.test.tsx:121` and `:124` pin the old wording:

```ts
    expect(html).toContain('A payment area: nothing was clicked or sent');
    ...
    expect(html).toContain('Left out by your include or exclude paths');
```

## Change

1. Line 3: replace the import with

```tsx
import { skipText } from '../results/SkippedPagesView';
```

2. Delete the `startedAt` prop: remove lines 11-12 (the comment and `startedAt?: number;`), remove `startedAt` from the destructured props on line 51, and in the effect use:

```tsx
    const start = Date.now();
```

   with dependencies `[elapsedMs, stopped]`.
3. Line 102: `skipReasonText(p.reason)` becomes `skipText(p.reason)`.
4. Line 113: `className="text-fail"` becomes `className="text-ink-soft"`.

## Tests

Edit `packages/wizard/tests/audit-progress.test.tsx`:

- line 121: expect `'a payment page: nothing on it is clicked or sent'`
- line 124: expect `'left out by the include or exclude paths'`
- in the same test add: `expect(html).not.toContain('text-fail">(');`
- remove the now unused imports ESLint already warns about in this file (`auditStatusText`, `pageAiText`, `pageStateLabel`) only if they are still unused after your edit.

Run: `pnpm exec vitest run packages/wizard/tests/audit-progress.test.tsx packages/wizard/tests/audit-start-screen.test.tsx` then `pnpm build`.

## Done when

- [ ] The live list and the results show the same reason text for a Skipped Page.
- [ ] The reason is not red.
- [ ] `startedAt` appears nowhere in `LivePageList.tsx`.
- [ ] Tests and `pnpm build` pass.

## Notes

- Do not change `lib/coverage-text.ts`; the Check-up screens still use it.
- If `p.reason` is typed wider than `RouteSkipReason`, cast at the call: `skipText(p.reason as RouteSkipReason)` and import the type from `@qa/types/src/browser.js`.
