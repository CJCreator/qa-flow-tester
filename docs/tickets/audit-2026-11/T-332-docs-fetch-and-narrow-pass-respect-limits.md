# T-332: Docs fetch counts every attempt, and the narrow-screen pass keeps the scan deadline

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | speed | todo |

**Files you may edit (no others):**

- `packages/core/src/discovery/docs-fetch.ts`
- `packages/core/src/plan/narrow-look.ts`
- `packages/core/src/discovery/discovery-agent.ts`
- `packages/core/tests/docs-fetch.test.ts`
- `packages/core/tests/narrow-look.test.ts` (new)

**Do not build in parallel with:** T-240, T-241, T-306 (all edit `docs-fetch.ts`); T-240, T-312, T-358 (all edit `discovery-agent.ts`); T-241 (edits `docs-fetch.test.ts`).

## Problem

Two places can run past a limit the person was promised.

**Docs fetch.** ADR 0021 says the tool reads at most 20 pages of the docs site. The loop is `while (queue.length > 0 && docs.length < maxPages)` (`packages/core/src/discovery/docs-fetch.ts:210`). Only pages that gave text count. Pages skipped for robots.txt, a failed fetch, a redirect to another site, a 404 or a non-HTML type are free, so a docs site full of dead links makes the tool request hundreds of addresses.

**Narrow-screen pass.** `lookAtNarrowScreens` (`packages/core/src/plan/narrow-look.ts:36`) loads one page per distinct menu at each of two sizes. It has no deadline: `discovery-agent.ts` passes only the stop signal (`pause` calls `stopIfAborted(signal)`, ~line 628). After the 20-minute scan budget (`deadlineAt`, ~line 452) the pass still runs, up to two loads per menu group. The menu signature is built from every header and nav link (`menuSignature`, line 11), so one link that differs per page (a breadcrumb in the nav landmark) makes every page its own group, and the loads multiply. The function has no test.

## Current code

Branch from `main`.

`grep -n "docs.length < maxPages\|DOCS_MAX_PAGES" packages/core/src/discovery/docs-fetch.ts`:

```ts
const maxPages = options.maxPages ?? DOCS_MAX_PAGES;
...
  while (queue.length > 0 && docs.length < maxPages) {
```

`grep -n "lookAtNarrowScreens" packages/core/src/discovery/discovery-agent.ts` (the call), and in `narrow-look.ts`:

```ts
function menuSignature(page: PageInventoryItem): string {
  return (page.links || [])
    .filter((l) => l.landmark === 'header' || l.landmark === 'nav')
    .map((l) => l.selector)
```

## Change

1. `docs-fetch.ts`: add `export const DOCS_MAX_ATTEMPTS = 40;` next to `DOCS_MAX_PAGES`, an optional `maxAttempts` in the options type, and `let attempts = 0;`. Loop condition becomes `queue.length > 0 && docs.length < maxPages && attempts < maxAttempts`; do `attempts++` right after `queue.shift()`. After the loop, when the attempts ran out with a queue left, push `{ url: queue[0], why: 'stopped after ${maxAttempts} addresses tried' }` to `skipped` (next to the existing "only the first N pages" note).
2. `narrow-look.ts`: add `deadlineAt?: number` to the options. At the top of the inner `for (const size ...)` loop, `if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) return;`.
3. `narrow-look.ts` `menuSignature`: take the signature only from links that appear on at least two pages. Compute once in `lookAtNarrowScreens` a `Map<string, number>` of selector to page count, and pass the set of shared selectors into `menuSignature`. A page whose shared set is empty is skipped as before.
4. `discovery-agent.ts`: pass `deadlineAt` (the local constant at ~452) in the `lookAtNarrowScreens` options.
5. Run `pnpm exec prettier --write` on the touched files, then `pnpm build`.

## Tests

- `packages/core/tests/docs-fetch.test.ts` (existing loopback stub): add a case where the start page links to 60 addresses that all answer 404; with `maxAttempts: 10` the stub receives at most 10 page requests (plus robots.txt) and `skipped` names the attempt limit.
- New `packages/core/tests/narrow-look.test.ts` (unit, a fake `BrowserContext` whose `newPage` returns a fake page with `goto`, and an injected stub for `collectElementInventory` via `vi.mock('../src/discovery/element-inventory.js')`): (a) a past `deadlineAt` makes zero `openContext` calls; (b) three pages sharing the same two nav links make one group (two `openContext` calls, one per size), not three; (c) a nav link present on one page only does not split the group; (d) the hidden links and the menu button are marked on every page that shares the menu.

Run: `pnpm exec vitest run packages/core/tests/docs-fetch.test.ts packages/core/tests/narrow-look.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "attempts" packages/core/src/discovery/docs-fetch.ts` finds the count in the loop condition.
- [ ] `grep -n "deadlineAt" packages/core/src/plan/narrow-look.ts packages/core/src/discovery/discovery-agent.ts` finds the option and the call.
- [ ] `grep -rn "lookAtNarrowScreens" packages/core/tests` finds the new test.
- [ ] The tests pass; `pnpm build` passes.

## Notes

- Audit finding M31, docs fetch and narrow pass (audit of 11 Nov 2026 on `d225418`). The PageSpeed part of M31 is T-326.
- ADR 0021 says "at most 20 pages"; the attempt limit makes that sentence true for the requests as well. Add no ADR.
- Related open tickets: T-306 (same file, builds first), T-241, T-240 (`docs-fetch.ts` and robots).
