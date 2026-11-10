# T-136: Core stops repeating work in four hot loops

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | speed | todo |

**Files you may edit (no others):**
- `packages/core/src/competitive/robots.ts`
- `packages/core/src/source-locator.ts`
- `packages/core/src/plan/site-graph.ts`
- `packages/core/src/orchestrator.ts`

**Do not build in parallel with:** T-125 (`site-graph.ts`); T-120, T-124, T-127 (`orchestrator.ts`).

Four small, independent changes. None changes a result.

## 1. robots.txt: compile each rule once

### Problem
`RobotsPolicy.isAllowed` runs for every link and every navigation request. For each rule it calls `matches`,
which builds a new `RegExp` every time.

### Current code
`packages/core/src/competitive/robots.ts:22-27` and `:111-131` (branch `worktree-audit-cleanup`)

```ts
export class RobotsPolicy {
  private constructor(
    private rules: Array<{ allow: boolean; pattern: string }>,
    /** The chosen group's Crawl-delay in milliseconds (capped at MAX_CRAWL_DELAY_MS); undefined when none is set. */
    readonly crawlDelayMs?: number
  ) {}
...
  isAllowed(pathAndQuery: string): boolean {
    let best: { allow: boolean; length: number } | null = null;
    for (const rule of this.rules) {
      if (!matches(rule.pattern, pathAndQuery)) continue;
...
function matches(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${regex}${anchored ? '$' : ''}`).test(target);
}
```

### Change
Replace `matches` with a function that returns the compiled expression, and cache it per pattern:

```ts
/** The compiled form of each robots pattern, built once (isAllowed runs for every link and request). */
const compiled = new Map<string, RegExp>();

function patternRegex(pattern: string): RegExp {
  let regex = compiled.get(pattern);
  if (!regex) {
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const source = body
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    regex = new RegExp(`^${source}${anchored ? '$' : ''}`);
    compiled.set(pattern, regex);
  }
  return regex;
}
```

and in `isAllowed`: `if (!patternRegex(rule.pattern).test(pathAndQuery)) continue;`. Delete `matches`.

## 2. Source locator: one expression per search, not per file

### Problem
`scanDirectory` builds the same `RegExp` again for every file it reads.

### Current code
`packages/core/src/source-locator.ts:13-24` and the lines inside `scanDirectory`:

```ts
    const result = await this.scanDirectory(this.repoRoot, testId);
...
  private async scanDirectory(dir: string, testId: string, depth = 0): Promise<SourceLocation | undefined> {
...
        const found = await this.scanDirectory(fullPath, testId, depth + 1);
...
          // The id comes from the checked site's page: escape it, and no `g` flag (test() would keep state).
          const regex = new RegExp(`data-testid=["']${testId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
```

### Change
- In `findByTestId`, build the expression once and pass it down:

```ts
    // The id comes from the checked site's page: escape it, and no `g` flag (test() would keep state).
    const pattern = new RegExp(`data-testid=["']${testId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
    const result = await this.scanDirectory(this.repoRoot, pattern);
```

- Change the signature to `private async scanDirectory(dir: string, pattern: RegExp, depth = 0)`, pass
  `pattern` in the recursive call, delete the two lines that built `regex` inside the loop, and use
  `pattern.test(lines[i])`.

## 3. Site graph: no linear search inside the loops

### Problem
`buildSiteGraph` runs for every planning batch. `entry.pages.includes(page.urlPath)` and `queue.shift()` make
it grow with the square of the page count.

### Current code
`packages/core/src/plan/site-graph.ts:44-53` and `:79-91`

```ts
  const onPages = new Map<string, { link: PageLink; pages: string[]; seenBy: Set<string> }>();
  for (const page of pages) {
    for (const link of page.links || []) {
      const key = linkKey(link);
      const entry = onPages.get(key) ?? { link, pages: [], seenBy: new Set<string>() };
      if (!entry.pages.includes(page.urlPath)) entry.pages.push(page.urlPath);
...
    const queue = [start];
    while (queue.length > 0) {
      const page = queue.shift()!;
```

### Change
- Add a `has: Set<string>` beside `pages` in the entry (type and initial value), and replace the `includes` line:

```ts
  const onPages = new Map<string, { link: PageLink; pages: string[]; has: Set<string>; seenBy: Set<string> }>();
...
      const entry = onPages.get(key) ?? { link, pages: [], has: new Set<string>(), seenBy: new Set<string>() };
      if (!entry.has.has(page.urlPath)) {
        entry.has.add(page.urlPath);
        entry.pages.push(page.urlPath);
      }
```

- Walk the queue with an index instead of `shift()`:

```ts
    const queue = [start];
    for (let head = 0; head < queue.length; head++) {
      const page = queue[head];
```

  (remove the `while (queue.length > 0) {` line and the `const page = queue.shift()!;` line; the loop body and
  its closing brace stay).

## 4. Orchestrator: look Tests up by id with a Map

### Problem
After testing, two loops search arrays inside a loop.

### Current code
`packages/core/src/orchestrator.ts:1555-1556` and `:1612`

```ts
    for (const r of results) {
      const tc = testCasesToRun.find((t) => t.id === r.testCaseId);
...
            reached: documented.filter((tc) => results.some((r) => r.testCaseId === tc.id && r.status !== 'Skipped'))
              .length,
```

### Change
- Above the `for (const r of results)` loop add `const testById = new Map(testCasesToRun.map((t) => [t.id, t]));`
  and use `const tc = testById.get(r.testCaseId);`.
- Above the `documentedItems` declaration add
  `const ranIds = new Set(results.filter((r) => r.status !== 'Skipped').map((r) => r.testCaseId));`
  and use `reached: documented.filter((tc) => ranIds.has(tc.id)).length,`.

## Tests

No new test: results are unchanged. Run:

- `pnpm build`
- `pnpm exec vitest run packages/core/tests/robots.test.ts packages/core/tests`

## Done when

- [ ] `new RegExp(` is not called inside `isAllowed`'s loop or inside `scanDirectory`'s loop
- [ ] `queue.shift()` and `entry.pages.includes(` are gone from `site-graph.ts`
- [ ] `pnpm build` and the core unit tests pass

## Notes

Not in this ticket (they change behaviour or need a design decision): re-asking the AI for remembered pages
(`plan/pipeline.ts:136`), planning batches one at a time (`plan/ai-planner.ts:893`), and the source locator
being pointed at the tool's own folder when the runner is started from the tool's repository
(`runner/src/session/checkup-run.ts` passes `repoRoot: process.cwd()`).
