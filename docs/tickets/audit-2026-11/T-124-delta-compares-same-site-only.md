# T-124: "Fixed since last time" compares against the same site only

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | todo |

**Files you may edit (no others):**
- `packages/core/src/suppressions.ts`
- `packages/core/src/orchestrator.ts` (one line: the `computeDelta` call)
- `packages/core/tests/suppressions.test.ts`

**Do not build in parallel with:** T-120, T-127, T-136 (all edit `orchestrator.ts`).

## Problem

`computeDelta` compares this Check-up's Findings with `<reportDir>/findings.json`, which is always the last
Check-up on this computer, whatever site it checked. Check site A, then site B: B's report says every one of
A's Findings was "Fixed", and every one of B's is "New".

## Current code

`packages/core/src/suppressions.ts:83-91` (branch `worktree-audit-cleanup`)

```ts
  async computeDelta(currentFindings: Finding[]): Promise<RunDelta> {
    let previousFindings: Finding[] = [];
    try {
      const data = await fs.readFile(this.previousFindingsFilePath, 'utf8');
      const prevReport = JSON.parse(data) as ReleaseReport;
      previousFindings = prevReport.findings || [];
    } catch {
      // First run, no previous findings
    }
```

`packages/core/src/orchestrator.ts:1549-1550`

```ts
    await suppressionsManager.applySuppressions(uniqueFindings, siteHostOf(options.targetUrl));
    const delta = await suppressionsManager.computeDelta(uniqueFindings);
```

## Change

1. `suppressions.ts`: give `computeDelta` an optional second parameter and skip a previous report from another site.

```ts
  /**
   * What changed since the last Check-up. `host` is the checked site's host: a previous report for a
   * different site is ignored (it is then a first Check-up: everything is new, nothing is fixed).
   */
  async computeDelta(currentFindings: Finding[], host?: string): Promise<RunDelta> {
    let previousFindings: Finding[] = [];
    try {
      const data = await fs.readFile(this.previousFindingsFilePath, 'utf8');
      const prevReport = JSON.parse(data) as ReleaseReport;
      let sameSite = true;
      if (host && prevReport.targetUrl) {
        try {
          sameSite = new URL(prevReport.targetUrl).host.toLowerCase() === host.toLowerCase();
        } catch {
          sameSite = false;
        }
      }
      previousFindings = sameSite ? prevReport.findings || [] : [];
    } catch {
      // First run, no previous findings
    }
```

   Everything below that in the method stays as it is.

2. `orchestrator.ts`: pass the host. First read how `siteHostOf` is defined in that file (search
   `function siteHostOf`). If it returns `new URL(x).host`, use it; if it returns anything else (for example a
   hostname without the port, or a registrable domain), do not use it and compute the host inline:

```ts
    let targetHost: string | undefined;
    try {
      targetHost = new URL(options.targetUrl).host;
    } catch {
      targetHost = undefined;
    }
    const delta = await suppressionsManager.computeDelta(uniqueFindings, targetHost);
```

## Tests

Edit `packages/core/tests/suppressions.test.ts`. Copy the set-up of
`'computeDelta reads a pre-contract findings.json with no schemaVersion or fingerprint'` (it writes a
`findings.json` into `tmpDir` and builds findings with a `mk(id, title)` helper). Add:

- `'computeDelta ignores the last report when it was for another site'`: write
  `{ targetUrl: 'https://a.example.com/', findings: [mk('F-1', 'Old problem')] }`; call
  `computeDelta([mk('F-2', 'New problem')], 'b.example.com')`. Expect `delta.fixedFindings` to be `0` and
  `delta.newFindings` to be `1`. (Check the exact field names on `RunDelta` in the existing tests and use those.)
- `'computeDelta compares when the host is the same'`: same file, host `'a.example.com'`; expect the old
  problem counted as fixed (`1`).
- `'computeDelta compares when no host is given'`: same file, no second argument; expect fixed `1` (old behaviour).

Command: `pnpm exec vitest run packages/core/tests/suppressions.test.ts`, then `pnpm build`.

## Done when

- [ ] The three new tests pass; the existing ones still pass
- [ ] The orchestrator passes the checked site's host
- [ ] `pnpm build` passes

## Notes

A report written before `targetUrl` existed is still compared (no `targetUrl` means "unknown, assume same").
