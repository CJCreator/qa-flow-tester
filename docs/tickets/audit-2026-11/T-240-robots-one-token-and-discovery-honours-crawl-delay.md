# T-240: One robots token, and the discovery crawl honours Crawl-delay

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/competitive/robots.ts`
- `packages/core/src/discovery/discovery-agent.ts`
- `packages/core/src/discovery/docs-fetch.ts`
- `packages/core/src/competitive/safe-crawler.ts`
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/runner/src/routes/plan.ts`
- `packages/core/tests/robots-token-and-delay.test.ts` (new)

**Do not build in parallel with:** T-241 (edits `docs-fetch.ts`), T-248 (edits `safe-crawler.ts`).

## Problem

Two bugs about robots.txt on sites we do not own (ADR 0015).

1. The Check-up's discovery crawl reads robots.txt but throws away its `Crawl-delay`. It always waits 2000 ms between pages (or the person's own setting). The Website Audit crawl does honour `Crawl-delay` (through `HostPacer`). A site that asks for 10 seconds gets a page every 2 seconds.
2. The robots token (the name a robots.txt group is matched against) is written out five times. Four copies say `'QA-Benchmarking-Bot'`. `docs-fetch.ts` says `'qa-flow-tester'`, so a site that wrote a group for our crawler is not obeyed when its documents are fetched.

## Current code

Branch from `main`. Find each with `grep -rn "QA-Benchmarking-Bot\|qa-flow-tester'" packages/*/src --include=*.ts`.

`packages/core/src/discovery/discovery-agent.ts`:

```ts
const PUBLIC_SITE_PAGE_DELAY_MS = 2000;
const CRAWLER_TOKEN = 'QA-Benchmarking-Bot';
```

and, inside `discover`:

```ts
    const crawlOptions: CrawlOptions = {
      robots: ownMachine ? undefined : await RobotsPolicy.fetch(targetOrigin.origin, CRAWLER_TOKEN),
      pageDelayMs:
        options.crawlDelayMs !== undefined ? options.crawlDelayMs : ownMachine ? 0 : PUBLIC_SITE_PAGE_DELAY_MS,
      concurrency: options.crawlConcurrency,
```

`packages/core/src/discovery/docs-fetch.ts`:

```ts
const ROBOTS_TOKEN = 'qa-flow-tester';
...
        ? RobotsPolicy.parse(r.body, ROBOTS_TOKEN)
```

`packages/core/src/competitive/safe-crawler.ts`:

```ts
const USER_AGENT_TOKEN = 'QA-Benchmarking-Bot';
...
        : await RobotsPolicy.fetch(targetUrlObj.origin, USER_AGENT_TOKEN);
...
        userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ${USER_AGENT_TOKEN}/1.0`,
```

`packages/core/src/audit/crawl/crawl.ts`:

```ts
/** The user-agent token whose robots.txt group the audit follows (the Spider's, so one site rule fits both). */
export const AUDIT_ROBOTS_TOKEN = 'QA-Benchmarking-Bot';
```

`packages/runner/src/routes/plan.ts`, in `crawlMore` (find with `grep -n "QA-Benchmarking-Bot" packages/runner/src/routes/plan.ts`):

```ts
      robots: ownMachine ? undefined : await RobotsPolicy.fetch(origin.origin, 'QA-Benchmarking-Bot'),
      pageDelayMs: ownMachine ? 0 : 2000,
```

`RobotsPolicy` (in `competitive/robots.ts`) already has `readonly crawlDelayMs?: number`, capped at `MAX_CRAWL_DELAY_MS` (30 s). `core/src/index.ts` already does `export * from './competitive/robots.js'`, so new exports there reach `@qa/core`.

## Change

1. `competitive/robots.ts`: after `MAX_CRAWL_DELAY_MS`, add:

```ts
/** The name our crawls give in User-Agent and match against robots.txt groups. One value for every crawl. */
export const ROBOTS_USER_AGENT_TOKEN = 'QA-Benchmarking-Bot';

/** The wait between page loads on a site we crawl: our own choice, never shorter than the site's robots.txt Crawl-delay. */
export function crawlPageDelayMs(chosenMs: number, robots?: Pick<RobotsPolicy, 'crawlDelayMs'>): number {
  return Math.max(chosenMs, robots?.crawlDelayMs ?? 0);
}
```

2. `discovery-agent.ts`:
   - Delete `const CRAWLER_TOKEN = 'QA-Benchmarking-Bot';`.
   - Change the import `import { RobotsPolicy } from '../competitive/robots.js';` to `import { RobotsPolicy, ROBOTS_USER_AGENT_TOKEN, crawlPageDelayMs } from '../competitive/robots.js';`.
   - Replace the `crawlOptions` start with:

```ts
    const robots = ownMachine ? undefined : await RobotsPolicy.fetch(targetOrigin.origin, ROBOTS_USER_AGENT_TOKEN);
    const chosenDelayMs =
      options.crawlDelayMs !== undefined ? options.crawlDelayMs : ownMachine ? 0 : PUBLIC_SITE_PAGE_DELAY_MS;
    const crawlOptions: CrawlOptions = {
      robots,
      // A site's own Crawl-delay is a floor: the person's setting can ask for more, never less (ADR 0015).
      pageDelayMs: crawlPageDelayMs(chosenDelayMs, robots),
      concurrency: options.crawlConcurrency,
```

The rest of the object stays. The narrow-screen pause later in the file reads `crawlOptions.pageDelayMs`, so it follows automatically.

3. `docs-fetch.ts`: delete `const ROBOTS_TOKEN = 'qa-flow-tester';`. Import `ROBOTS_USER_AGENT_TOKEN` with `RobotsPolicy` (`import { RobotsPolicy, ROBOTS_USER_AGENT_TOKEN } from '../competitive/robots.js';`). Replace `RobotsPolicy.parse(r.body, ROBOTS_TOKEN)` with `RobotsPolicy.parse(r.body, ROBOTS_USER_AGENT_TOKEN)`.

4. `safe-crawler.ts`: delete `const USER_AGENT_TOKEN = ...;`. Import `ROBOTS_USER_AGENT_TOKEN` from `./robots.js` (the file already imports `RobotsPolicy` from there). Replace both uses of `USER_AGENT_TOKEN` with `ROBOTS_USER_AGENT_TOKEN`.

5. `crawl.ts`: import `ROBOTS_USER_AGENT_TOKEN` with the existing `RobotsPolicy` import. Replace the exported constant with `export const AUDIT_ROBOTS_TOKEN = ROBOTS_USER_AGENT_TOKEN;` (keep the name and its comment; other code and tests import it).

6. `runner/src/routes/plan.ts`: add `ROBOTS_USER_AGENT_TOKEN` and `crawlPageDelayMs` to the existing `@qa/core` import list (it already imports `RobotsPolicy`). In `crawlMore` replace the two lines shown with:

```ts
      robots,
      pageDelayMs: crawlPageDelayMs(ownMachine ? 0 : 2000, robots),
```

and above the `new DeterministicSpider(` statement add `const robots = ownMachine ? undefined : await RobotsPolicy.fetch(origin.origin, ROBOTS_USER_AGENT_TOKEN);`. Place it inside the same `try` block, after `const context = ...` is created.

7. Run `pnpm exec prettier --write` on the seven files, then `pnpm build`.

## Tests

New file `packages/core/tests/robots-token-and-delay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { RobotsPolicy, ROBOTS_USER_AGENT_TOKEN, crawlPageDelayMs } from '../src/competitive/robots.js';

describe('ROBOTS_USER_AGENT_TOKEN', () => {
  it('is the name the crawls give', () => {
    expect(ROBOTS_USER_AGENT_TOKEN).toBe('QA-Benchmarking-Bot');
  });
  it('selects the robots.txt group written for it', () => {
    const robots = RobotsPolicy.parse(
      'User-agent: QA-Benchmarking-Bot\nDisallow: /private\n\nUser-agent: *\nDisallow:\n',
      ROBOTS_USER_AGENT_TOKEN
    );
    expect(robots.isAllowed('/private/a')).toBe(false);
    expect(robots.isAllowed('/public')).toBe(true);
  });
});

describe('crawlPageDelayMs', () => {
  const slow = RobotsPolicy.parse('User-agent: *\nCrawl-delay: 5\n', ROBOTS_USER_AGENT_TOKEN);
  it('keeps our own delay when the site sets none', () => {
    expect(crawlPageDelayMs(2000, RobotsPolicy.allowAll())).toBe(2000);
    expect(crawlPageDelayMs(2000, undefined)).toBe(2000);
  });
  it('raises it to the site Crawl-delay', () => {
    expect(slow.crawlDelayMs).toBe(5000);
    expect(crawlPageDelayMs(2000, slow)).toBe(5000);
    expect(crawlPageDelayMs(0, slow)).toBe(5000);
  });
  it('keeps the longer of the two', () => {
    expect(crawlPageDelayMs(8000, slow)).toBe(8000);
  });
});
```

Run: `pnpm exec vitest run packages/core/tests/robots-token-and-delay.test.ts packages/core/tests/docs-fetch.test.ts packages/core/tests/safe-crawler-guard.test.ts`, then `pnpm build`.

## Done when

- [ ] `grep -rn "QA-Benchmarking-Bot" packages/*/src --include=*.ts` prints one line (the constant in `competitive/robots.ts`).
- [ ] `grep -rn "qa-flow-tester'" packages/core/src/discovery` prints nothing.
- [ ] `grep -n "crawlPageDelayMs" packages/core/src/discovery/discovery-agent.ts packages/runner/src/routes/plan.ts` shows one use in each file.
- [ ] The new test and the two named existing test files pass; `pnpm build` passes.

## Notes

- `ai/key-resolver.ts` has `KEYCHAIN_SERVICE = 'qa-flow-tester'`. That is a different thing (the keychain entry name). Do not touch it.
- A Crawl-delay is capped at 30 s by `RobotsPolicy`. A 30 s delay on a big site can end the crawl at its 20 minute budget with pages left. That is the intended trade: the crawl stops politely and the Plan says which pages were not reached.
- The Check-up's `crawlDelayMs` option is documented as 0 to 2000. It still is: only robots.txt can push the real delay above 2000.
