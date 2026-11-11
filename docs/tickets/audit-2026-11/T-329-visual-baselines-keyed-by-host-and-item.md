# T-329: Visual baselines are keyed by host and a stable Plan Item key

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/plan/baseline-key.ts` (new)
- `packages/core/src/orchestrator.ts`
- `packages/runner/src/server.ts`
- `packages/core/tests/baseline-key.test.ts` (new)
- `packages/runner/tests/baseline-accept.test.ts`

**Do not build in parallel with:** T-247, T-252, T-309, T-310, T-312, T-316, T-318, T-342, T-358 (all edit `orchestrator.ts`); T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-299, T-300, T-301, T-302, T-303, T-308, T-313, T-331, T-357 (all edit `server.ts`); T-267 (edits `baseline-accept.test.ts`).

## Problem

A visual baseline is a screenshot the person accepted as "this is how the page should look". The orchestrator names its file `<testCase.id>-<size>.png` in one folder (`packages/core/src/orchestrator.ts:1224`). The id is a counter by position, built in `packages/core/src/plan/expand.ts:99` (`PAGE-001`, `PAGE-002`...). The runner uses one global `.qa-baselines` folder for every site (`packages/runner/src/server.ts:660`).

So a baseline accepted for site A, Plan version 1, is compared with site B, or with the same site after a re-plan that reorders pages, because `PAGE-003` now means another page. The person gets "visual regression" findings that are not regressions, or a real regression goes unseen because the new page was never the one accepted.

## Current code

Branch from `main`.

`packages/core/src/orchestrator.ts` (`grep -n "baselineDir\|baselinePath" packages/core/src/orchestrator.ts`):

```ts
    const baselineDir = path.resolve(options.profile?.visualBaselineDir || '.qa-baselines');
    ...
          const baselinePath = path.join(baselineDir, `${testCase.id}-${bp}.png`);
```

`packages/core/src/plan/expand.ts` (`grep -n "id('PAGE'" packages/core/src/plan/expand.ts`): `id: id('PAGE', ++count.page)`. Each test case also has `planItemId` (`TestCase.planItemId`, `packages/types/src/test-case.ts:138`), which is `page:<urlPath>` for a page and `pagetest:<urlPath>:<n>` or `nav:...` for other items (`grep -n "id: \`page" packages/core/src/plan/ai-planner.ts`).

`packages/runner/src/server.ts` `handleListBaselines` (`grep -n "handleListBaselines" packages/runner/src/server.ts`) splits the file name into a test case id and a size, then finds the matching visual finding by `f.testCaseId === testCaseId`.

## Change

1. New `packages/core/src/plan/baseline-key.ts`:

```ts
import { createHash } from 'node:crypto';

/** File-name-safe text: letters, digits, `_` and `-` only. */
function safe(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

/**
 * The file name (without `.png`) of a visual baseline: the site, the Plan Item and the role, so a baseline is
 * never compared with another site, nor with another page after a re-plan reordered the ids.
 * Only `[A-Za-z0-9_-]` is used, so the runner's existing id check (`/^[\w-]+$/`) still accepts it.
 */
export function baselineKey(args: { targetUrl: string; planItemId?: string; testCaseId: string; role: string }): string {
  const host = safe(new URL(args.targetUrl).host.toLowerCase());
  const item = args.planItemId ?? args.testCaseId;
  const hash = createHash('sha1').update(item).digest('hex').slice(0, 8);
  return `${host}__${safe(item).slice(0, 60)}-${hash}-${safe(args.role)}`;
}
```

The folder stays flat on purpose (not `.qa-baselines/<host>/...`): the runner's list, serve, accept and delete routes take one flat id.

2. `orchestrator.ts`: import `baselineKey` and replace the `baselinePath` line with `path.join(baselineDir, `${baselineKey({ targetUrl: options.targetUrl, planItemId: testCase.planItemId, testCaseId: testCase.id, role: testCase.role })}-${bp}.png`)`.
3. `server.ts` `handleListBaselines`: the file name no longer holds the test case id. Find the matching visual finding by file name instead: `visualFindings.find((f) => f.where.breakpoint === breakpoint && f.expectedVsActual.expected.endsWith(entry.name))` (the finding text is `Matches approved baseline <relative path>`, `packages/checkers/src/design-standards.ts:283`). Keep `testCaseId` in the list item as the part before the size, so the wizard keeps working.
4. Old files named `PAGE-001-1440px.png` are not matched any more: the next run finds no baseline for each page and records nothing new, so no false findings. Say so in the commit message. The person accepts new baselines from the Visual Baselines screen.
5. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

- New `packages/core/tests/baseline-key.test.ts` (unit): same Plan Item and role on two hosts give different keys; the same host with `PAGE-003` meaning two different `planItemId`s gives different keys; the same inputs give the same key; the key matches `/^[\w-]+$/` for a role such as `shop owner` and a path such as `/a/b?x=1`; `localhost:3050` and `localhost:3051` differ.
- Changed `packages/runner/tests/baseline-accept.test.ts`: a baseline named by `baselineKey` can be accepted and listed, and the list item gets its visual finding by file name.

Run: `pnpm exec vitest run packages/core/tests/baseline-key.test.ts packages/runner/tests/baseline-accept.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "baselineKey" packages/core/src/orchestrator.ts` finds the baseline path.
- [ ] `grep -n "testCase.id}-\${bp}.png" packages/core/src/orchestrator.ts` finds nothing.
- [ ] The new and changed tests pass; `pnpm build` passes.

## Notes

- Audit finding M26 (audit of 11 Nov 2026 on `d225418`).
- Related open tickets: T-252 (deletes the unreachable baseline recording code in `orchestrator.ts`; the comparison code this ticket edits stays) and T-267 (the Visual Baselines list sends the new screenshot; same `handleListBaselines`). Build after both, or merge by hand.
- `figma-sync.ts` also reads `.qa-baselines`; it is not edited here.
