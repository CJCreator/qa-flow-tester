# T-173: "active finding" and "counts toward the verdict" are two different rules

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | types | inconsistency | built |

**Files you may edit (no others):**
- `packages/types/src/findings-contract.ts`
- `packages/types/tests/findings-contract.test.ts`

**Do not build in parallel with:** none.

## Problem
Two functions in `@qa/types` decide whether a finding counts, and they have drifted apart:
- `countsTowardVerdict` (`verdict.ts`) leaves out dismissed findings, unconfirmed findings, advisory findings, and findings from the AI review (`checker === 'ai-review'`).
- `isActiveFinding` (`findings-contract.ts`) leaves out only unconfirmed findings and the two triage statuses.

`isActiveFinding` feeds the CI exit code and summary counts (`packages/runner/src/checkup.ts:394`) and `known-findings.json`, `fix-these.md` and the annotations (`packages/core/src/findings-contract.ts:76,133,210`). So an advisory finding or an AI-review finding does not affect the Release Verdict but is still counted in the CI summary and written to the fix list. The numbers in the report and in CI disagree.

## Current code
`packages/types/src/findings-contract.ts:1-9` (branch `worktree-audit-cleanup`)
```ts
import type { Finding } from './index.js';

/** Version of the findings.json contract (docs/adr/0017-findings-contract.md). A file without it is version 0. */
export const FINDINGS_SCHEMA_VERSION = 1;

/** A finding that counts: not an unconfirmed AI guess, and not triaged Intended or False Positive. */
export function isActiveFinding(f: Pick<Finding, 'needsConfirmation' | 'triageStatus'>): boolean {
  return !f.needsConfirmation && f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive';
}
```
For reference, `packages/types/src/verdict.ts:102-106`:
```ts
export function countsTowardVerdict(
  f: Pick<Finding, 'triageStatus' | 'needsConfirmation'> & Partial<Finding>
): boolean {
  return !isDismissed(f) && !f.needsConfirmation && !f.advisory && f.checker !== 'ai-review';
}
```

## Change
Replace `isActiveFinding` with:
```ts
/**
 * A finding that counts: not an unconfirmed guess, not triaged Intended or False Positive, not advisory,
 * and not from the AI review. The same rule as `countsTowardVerdict` (verdict.ts), so the CI counts and
 * the fix list agree with the Release Verdict.
 */
export function isActiveFinding(
  f: Pick<Finding, 'needsConfirmation' | 'triageStatus'> & Partial<Pick<Finding, 'advisory' | 'checker'>>
): boolean {
  return (
    !f.needsConfirmation &&
    f.triageStatus !== 'Intended' &&
    f.triageStatus !== 'False Positive' &&
    !f.advisory &&
    f.checker !== 'ai-review'
  );
}
```
Do not import `countsTowardVerdict` here: `verdict.ts` may import from this module's neighbours and a cycle is not worth the saving.

## Tests
Edit `packages/types/tests/findings-contract.test.ts`. The existing test is:
```ts
  it('isActiveFinding excludes needsConfirmation, Intended and False Positive', () => {
    expect(isActiveFinding({})).toBe(true);
    expect(isActiveFinding({ needsConfirmation: true })).toBe(false);
    expect(isActiveFinding({ triageStatus: 'Intended' })).toBe(false);
    expect(isActiveFinding({ triageStatus: 'False Positive' })).toBe(false);
  });
```
Keep it and add:
```ts
  it('isActiveFinding excludes advisory findings and AI-review findings, like the verdict does', () => {
    expect(isActiveFinding({ advisory: true })).toBe(false);
    expect(isActiveFinding({ checker: 'ai-review' })).toBe(false);
    expect(isActiveFinding({ checker: 'seo' })).toBe(true);
    expect(isActiveFinding({ advisory: false, checker: 'security' })).toBe(true);
  });
```
Run:
`pnpm exec vitest run packages/types/tests/findings-contract.test.ts packages/types/tests/judgement-verdict.test.ts packages/core/tests/findings-contract.test.ts`
Then `pnpm build` (core and runner import this function).

If a core or runner test now fails because it expected an advisory or `ai-review` finding in `known-findings.json`, `fix-these.md` or the CI counts, that expectation was the bug: update the test to expect the finding to be left out. Do not weaken `isActiveFinding`.

## Done when
- [x] New test passes; the three suites above pass.
- [x] `pnpm build` passes.

## Notes
- Glossary: this is the Release Verdict rule. Do not rename either function.
- Out of scope: `packages/runner/src/checkup.ts` and `packages/core/src/findings-contract.ts` need no code change; they pass whole findings, which already carry `advisory` and `checker`.
