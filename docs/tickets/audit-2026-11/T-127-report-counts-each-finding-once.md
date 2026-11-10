# T-127: report.md lists each Finding once, and skipped Roles are counted per screen size

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | todo |

**Files you may edit (no others):**
- `packages/core/src/reporter.ts`
- `packages/core/src/orchestrator.ts` (the two "Skipped" result blocks only)
- `packages/core/tests/reporter.test.ts`

**Do not build in parallel with:** T-120, T-124, T-136 (edit `orchestrator.ts`); T-133 (edits `reporter.ts`).

## Problem

**A. `report.md` double-lists Findings.**
- A Finding with `needsConfirmation: true` and severity Blocker, Major or Minor appears in its severity group
  **and** under "Could not verify".
- A Finding the person triaged as `Intended` or `False Positive` appears in its severity group **and** in the
  "Suppressed Findings" section, and is counted in the "(n Blockers, n Majors, ...)" line although it is not active.

**B. Coverage counts disagree.** A Role that could not sign in gets **one** Skipped result per Test, with no
screen size. A Role whose session was lost gets one per screen size, and the planned total counts per screen
size. So "Skipped" does not add up with "Total Test Points".

## Current code

`packages/core/src/reporter.ts:82-87` (branch `worktree-audit-cleanup`)

```ts
    // Group findings by severity
    const blockers = findings.filter((f) => f.severity === 'Blocker');
    const majors = findings.filter((f) => f.severity === 'Major');
    const minors = findings.filter((f) => f.severity === 'Minor');
    const suggestions = findings.filter((f) => f.severity === 'Suggestion' && !f.needsConfirmation);
    const unconfirmed = findings.filter((f) => f.needsConfirmation);
```

`reporter.ts:287-290`

```ts
    const activeFindings = findings.filter((f) => f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive');
    const suppressedFindings = findings.filter(
      (f) => f.triageStatus === 'Intended' || f.triageStatus === 'False Positive'
    );
```

`packages/core/src/orchestrator.ts:612-625`

```ts
      if (notTestedRoles.has(testCase.role)) {
        const why = rolesNotTested.find((r) => r.role === testCase.role)!;
        results.push({
          testCaseId: testCase.id,
          flowId: testCase.flowId,
          role: testCase.role,
          status: 'Skipped',
          durationMs: 0,
          findings: [],
          stepEvidence: [],
          skipReason: `Not tested: ${why.text}`,
        });
        continue;
      }
```

and the block right below it (`if (sessionLostRoles.has(testCase.role)) { for (const bp of sizesFor(testCase)) { results.push({ ... }) } }`), which has no `breakpoint` field either.

## Change

### A. `reporter.ts`

1. Replace lines 82-87 with (active first, then the groups from the active list only):

```ts
    // Triaged-away findings are listed once, in their own section; they are not active.
    const activeFindings = findings.filter((f) => f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive');
    const suppressedFindings = findings.filter(
      (f) => f.triageStatus === 'Intended' || f.triageStatus === 'False Positive'
    );
    // Each active finding is in exactly one group: "could not verify" wins over its severity.
    const unconfirmed = activeFindings.filter((f) => f.needsConfirmation);
    const confirmed = activeFindings.filter((f) => !f.needsConfirmation);
    const blockers = confirmed.filter((f) => f.severity === 'Blocker');
    const majors = confirmed.filter((f) => f.severity === 'Major');
    const minors = confirmed.filter((f) => f.severity === 'Minor');
    const suggestions = confirmed.filter((f) => f.severity === 'Suggestion');
```

2. Delete the later declarations of `activeFindings` and `suppressedFindings` at lines 287-290 (they are now
   declared above). Every later use keeps working.

3. Check every other use of `blockers`, `majors`, `minors` between line 88 and 287 (for example a summary
   banner). They now exclude suppressed and unconfirmed Findings; that is intended. Do **not** change the
   verdict: it comes from `releaseVerdict(...)`, not from these lists.

### B. `orchestrator.ts`

4. Replace the `notTestedRoles` block with one result per screen size, and give both blocks a `breakpoint`:

```ts
      if (notTestedRoles.has(testCase.role)) {
        const why = rolesNotTested.find((r) => r.role === testCase.role)!;
        // One per screen size, like every other result, so the Skipped count adds up with the planned total.
        for (const bp of sizes) {
          results.push({
            testCaseId: testCase.id,
            flowId: testCase.flowId,
            role: testCase.role,
            breakpoint: bp,
            status: 'Skipped',
            durationMs: 0,
            findings: [],
            stepEvidence: [],
            skipReason: `Not tested: ${why.text}`,
          });
        }
        continue;
      }
```

   In the `sessionLostRoles` block add the line `breakpoint: bp,` after `role: testCase.role,`.

   If the result type has no `breakpoint` field (TypeScript error), find the type of `results` and look for the
   field that carries the screen size on a normal result (search for `status: 'Passed'` or the `results.push`
   near line 1360 in the same function) and use that field name instead.

## Tests

Edit `packages/core/tests/reporter.test.ts`. Copy the report-building set-up from
`'renders report.md and findings.json matching spec structure'`. Add:

- `'lists a could-not-verify finding once'`: one Finding `{ severity: 'Major', needsConfirmation: true, title: 'Maybe broken' }`.
  The rendered `report.md` contains `Maybe broken` under the "Could not verify" heading and the text
  `🟠 0 Majors`. Count occurrences of the Finding's id in the markdown: the id appears in exactly one
  finding block (assert `md.split('[' + id + ']').length - 1` is `1` if ids are rendered in brackets; otherwise
  count the title).
- `'lists a suppressed finding only in the suppressed section'`: one Finding `{ severity: 'Blocker', triageStatus: 'Intended' }`.
  The markdown contains `Active Findings: **0**`, `🔴 0 Blockers` and `Suppressed Findings (1)`.

Commands: `pnpm exec vitest run packages/core/tests/reporter.test.ts`, then `pnpm build` and
`pnpm exec vitest run packages/core/tests`.

## Done when

- [ ] Both new tests pass; the existing reporter tests pass (update a count in an existing test only if it
      counted a suppressed or unconfirmed Finding twice, and say so in the PR)
- [ ] Both Skipped blocks push one result per screen size with the size on it
- [ ] `pnpm build` passes

## Notes

`report.html` and the wizard read `findings.json`, not `report.md`; they are not touched here.
