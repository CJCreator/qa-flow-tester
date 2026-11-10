# T-135: Delete dead code in core (nothing calls it)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | dead-code | todo |

**Files you may edit (no others):**
- `packages/core/src/preflight.ts`
- `packages/core/src/browser.ts`
- `packages/core/src/post-deploy-smoke.ts`
- `packages/core/src/discovery/discovery-agent.ts`
- `packages/core/src/discovery/crud-facts.ts`
- `packages/core/src/discovery/frontier.ts`
- `packages/core/src/discovery/deterministic-spider.ts`
- `packages/core/src/discovery/test-planner.ts`
- `packages/core/src/plan/ai-budget.ts`

**Do not build in parallel with:** T-113 (`preflight.ts`), T-116 (`crud-facts.ts`), T-119 (`discovery-agent.ts`),
T-121, T-122, T-123 (`deterministic-spider.ts`), T-132 (`browser.ts`, `ai-budget.ts`). Build this ticket **last** in core.

Nine files, deletions only. Each item below was checked with a search across `packages/` (source and tests)
and `scripts/`: the only hit is the declaration.

## Problem

Unused members make the code harder to read and are kept "working" by nobody.

## Current code and change

For each item: **before deleting, run the search given and confirm the only match is the declaration** (and,
where noted, the writes). If there is another match, leave that item and say so in the PR.

1. `packages/core/src/preflight.ts:205-212`: method `verifyRoleLogin`. Search: `verifyRoleLogin`. Delete:

```ts
  async verifyRoleLogin(
    context: BrowserContext,
    baseUrl: string,
    credential: RoleCredential,
    saveStorageStatePath?: string
  ): Promise<boolean> {
    return (await this.signIn(context, baseUrl, credential, saveStorageStatePath)).ok;
  }
```

2. `packages/core/src/browser.ts:99`: private field `browser` is written four times and never read. Search in
   that file: `this.browser` (not `this.browsers`). Delete the field and the four writes:

```ts
  private browser: Browser | null = null;          // line 99: delete
      if (engine === 'chromium') this.browser = null;   // line 110: delete the whole line
        this.browser = b;                           // line 136: delete; if it was the only statement in
                                                    //   `if (engine === 'chromium' || engine === 'android-chrome') { ... }`, delete that `if` too
        if (engine === 'chromium') this.browser = null; // line 249: delete the whole line
    this.browser = null;                            // line 261: delete
```

   Keep the `Browser` type import if `browsers = new Map<BrowserEngine, Browser>()` still uses it (it does).

3. `packages/core/src/post-deploy-smoke.ts:120-121`: a check that can never be true. Change

```ts
    const method = 'GET';
    if (MUTATING_METHODS.includes(method)) throw new Error('smoke is read-only');
```

   to

```ts
    const method = 'GET';
```

   Then remove `MUTATING_METHODS` from the import on line 3 (`import { isTestHost, MUTATING_METHODS } from './live-site.js';`
   becomes `import { isTestHost } from './live-site.js';`), if it has no other use in the file.

4. `packages/core/src/discovery/discovery-agent.ts:334-350`: two static wrappers and the instance `discover`.
   Search: `\.discover\(` and `DiscoveryAgent.discover`. The only caller in the product is
   `new DiscoveryAgent().discoverWithSession(...)` in `packages/runner/src/session/checkup-run.ts`. Delete:

```ts
  static async discover(options: DiscoveryOptions): Promise<DiscoveryDraft> {
    return new DiscoveryAgent().discover(options);
  }

  static async discoverWithSession(options: DiscoveryOptions): Promise<DiscoveryOutcome> {
    return new DiscoveryAgent().discoverWithSession(options);
  }

  async discover(options: DiscoveryOptions): Promise<DiscoveryDraft> {
    try {
      const outcome = await this.discoverSite(options);
      return outcome.draft;
    } finally {
      // Also when the scan is stopped or fails part-way: no browser is left running.
      await this.browserManager.close().catch(() => {});
    }
  }
```

   Keep the instance `discoverWithSession`.

5. `packages/core/src/discovery/discovery-agent.ts:372-375`: unused local. Search in that file: `\bspider\b`
   (expect only this declaration and the property name `spider: spiderResult`). Delete:

```ts
    const spider = new DeterministicSpider(
      options.profile?.forbiddenActions || [],
      options.maxPages ?? DEFAULT_MAX_PAGES
    );
```

   `DeterministicSpider` and `DEFAULT_MAX_PAGES` are used elsewhere in the file; keep the imports unless the
   build says one is unused.

6. `packages/core/src/discovery/crud-facts.ts:23-25`: `isRowDeleteName`. Search: `isRowDeleteName`. Delete the
   function. Keep the `ROW_DELETE` constant (used by `readCrudStructure`).

7. `packages/core/src/discovery/frontier.ts:167-169`: `getShapeCount`. Search: `getShapeCount`. Delete the method.

8. `packages/core/src/discovery/deterministic-spider.ts:92`: `export type SkippedPage = SkippedPageInfo;`.
   Search: `SkippedPage\b` (matches of `SkippedPageInfo` do not count). Delete the line.

9. `packages/core/src/discovery/test-planner.ts:128-130`: `saveSpecFile`. Search: `saveSpecFile`. Delete the
   method, and delete `import { promises as fs } from 'fs';` on line 1 (its only use was in that method).

10. `packages/core/src/plan/ai-budget.ts:48-49`: deprecated alias. Search: `FREE_TIER_REQUEST_GAP_MS`. Delete:

```ts
/** @deprecated Old name of `UNREPORTED_LIMIT_GAP_MS`. */
export const FREE_TIER_REQUEST_GAP_MS = UNREPORTED_LIMIT_GAP_MS;
```

## Tests

No new test. Deleting something that is used fails the build, so the build is the check:

- `pnpm build`
- `pnpm typecheck` (includes the test files: a test that used a deleted member fails here)
- `pnpm exec vitest run packages/core/tests`
- `pnpm exec eslint packages/core/src`

## Done when

- [ ] All ten items are deleted, or the PR names the ones left and why
- [ ] `pnpm build`, `pnpm typecheck` and the core unit tests pass

## Notes

Left alone on purpose (used only by tests, or wiring them is a product decision; no ticket):
`account-pool.ts`, `figma-sync.ts`, `parseKnownFindings`, `EntityNamespacer.generateName` / `injectStepValues`,
`SendGuard.sentBySteps`, `browserEngineLabel`, `RunOptions.updateBaselines`, `ReleaseReport.usedFallbackDiscovery`,
`NavigateResult.settled`, `VisualReviewResult.aiModel`.
