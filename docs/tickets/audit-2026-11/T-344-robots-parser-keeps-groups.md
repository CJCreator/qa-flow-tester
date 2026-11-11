# T-344: The robots.txt reader keeps a group across blank lines and does not cache failures

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | checkers | bug | todo |

**Files you may edit (no others):**

- `packages/checkers/src/site-root.ts`
- `packages/checkers/tests/site-root-robots.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

The SEO check reads `/robots.txt` to say whether AI crawlers (GPTBot, ClaudeBot, PerplexityBot...) are blocked. The reader forgets the current `User-agent` group on every blank line (`packages/checkers/src/site-root.ts:80-84`). RFC 9309 allows blank lines inside a group. So a file written as `User-agent: GPTBot`, an empty line, then `Disallow: /` is read as a rule with no crawler, and the block is missed. The report then says AI crawlers are welcome when they are not. A comment-only line is stripped to an empty line first (`split('#')[0]`), so it does the same.

The reader also keeps its result in a per-origin cache for the life of the instance (`site-root.ts:47-48`, `:279`). The instance is one `SeoChecker` field of one `FlowTestOrchestrator`, and the runner makes a new orchestrator per Check-up (`runner/src/session/checkup-run.ts:444`), so the cache is already per run. But a failed fetch (network error, HTTP 5xx) is cached too, so one bad answer decides robots.txt, sitemap and llms.txt findings for every later page of that run.

## Current code

Branch from `main`.

`packages/checkers/src/site-root.ts` (`grep -n "if (!line)" packages/checkers/src/site-root.ts`):

```ts
          const line = rawLine.split('#')[0].trim();
          if (!line) {
            currentUserAgents = [];
            groupHasRules = false;
            continue;
          }
```

The rule that already starts a new group (`grep -n "groupHasRules" packages/checkers/src/site-root.ts`):

```ts
          if (uaMatch) {
            if (groupHasRules) {
              currentUserAgents = [];
              groupHasRules = false;
            }
```

and the cache (`grep -n "this.cache" packages/checkers/src/site-root.ts`):

```ts
    this.cache.set(origin, result);
    return result;
```

## Change

1. In `site-root.ts`, replace the `if (!line) { ... }` block with `if (!line) continue;`. The `groupHasRules` rule above already starts a new group when a `User-agent` line follows a rule line, which is the RFC 9309 way.
2. Track whether every fetch the audit made got a real answer: a `let complete = true;` set to `false` when `fetchFn` returns `null` or a status of 500 or more (robots.txt, sitemap, llms.txt). Call `this.cache.set(origin, result)` only when `complete` is true. A 404 is a real answer and is still cached.
3. Update the doc comment above `audit()` ("Results are cached per base URL"): say the cache lives as long as the checker (one Check-up) and holds only complete answers.
4. Run `pnpm exec prettier --write` on the two files, then `pnpm build`.

## Tests

New unit file `packages/checkers/tests/site-root-robots.test.ts` (no Chromium; `SiteRootAuditor.audit` takes a fake `fetchFn`, as in `packages/checkers/tests/seo.test.ts`):

- `User-agent: GPTBot\n\nDisallow: /\n` gives `blockedAiBots` containing `GPTBot`.
- `User-agent: GPTBot\n# note\nUser-agent: ClaudeBot\n\nDisallow: /\n` blocks both (one group, two agents, blank and comment lines inside).
- `User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nDisallow: /\n` still blocks only `GPTBot` (two groups).
- The existing cases in `seo.test.ts` ("groups with no blank line between them...", "a crawler with its own Allow group...") still pass.
- A `fetchFn` that returns `null` for robots.txt: call `audit` twice; the fake is called again on the second call (not cached). A `fetchFn` that answers 404 for everything: the second call makes no new fetch.

Run: `pnpm exec vitest run packages/checkers/tests/site-root-robots.test.ts packages/checkers/tests/seo.test.ts`, then `pnpm exec vitest run --project unit packages/checkers/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "currentUserAgents = \[\]" packages/checkers/src/site-root.ts` finds only the reset inside the `User-agent` branch.
- [ ] A robots.txt with a blank line between `User-agent: GPTBot` and `Disallow: /` reports GPTBot as blocked (test).
- [ ] A failed robots.txt fetch is fetched again on the next call (test).
- [ ] The new test, the checkers unit tests and `pnpm build` pass.

## Notes

- Audit finding L7 (audit of 11 Nov 2026 on `d225418`).
- The finding said "scope the cache per run": it already is, see Problem. Only the failure caching changes.
- T-240 edits robots handling in discovery (`packages/core`), not this file. Related, no overlap.
