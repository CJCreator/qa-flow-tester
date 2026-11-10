# T-176: the "Accessibility" issue type is never used: accessibility findings are listed under UI/UX

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | types | inconsistency | built |

**Files you may edit (no others):**
- `packages/types/src/issue-type.ts`
- `packages/types/tests/issue-type.test.ts`

**Do not build in parallel with:** none.

## Problem
The issues document groups findings by issue type; "Accessibility" is one of the eight types. Every accessibility finding (axe WCAG violations, keyboard checks, reflow) is produced with `checker: 'ux-quality'`, and `issueTypeOf` maps `ux-quality` to "UI/UX". No finding ever reaches "Accessibility", so that section of the document is always empty while WCAG violations sit under UI/UX.

The area a finding counts toward is already known: `ux-quality` belongs to the Accessible area unless the finding names another one (a touch target sets `aspect: 'Fast and mobile'`).

## Current code
`packages/types/src/issue-type.ts:26-49` (branch `worktree-audit-cleanup`)
```ts
/** Which issue type a finding is listed under. Judgement items and spec mismatches are Logical flow. */
export function issueTypeOf(f: IssueTypeInput): IssueType {
  if (f.needsJudgement) return 'Logical flow';
  if (f.intent === 'denied') return 'Access';
  if (f.categoryTag) return 'Other';
  switch (f.checker) {
    case 'spec-conformance':
      return 'Logical flow';
    case 'permission-matrix':
      return 'Access';
    case 'security':
      return 'Security';
    case 'performance':
      return 'Performance';
    case 'design-standards':
    case 'ux-quality':
      return 'UI/UX';
    case 'seo':
      return 'Other';
    case 'bug-detection':
      return f.aspect === 'Accessible' ? 'Accessibility' : 'Broken flow';
    default:
      return f.aspect === 'Accessible' ? 'Accessibility' : f.aspect === 'Looks and reads well' ? 'UI/UX' : 'Other';
  }
}
```

## Change
Replace the two `case` lines for `design-standards` and `ux-quality` and their `return` with:
```ts
    case 'design-standards':
      return 'UI/UX';
    case 'ux-quality':
      // ux-quality findings count toward the Accessible area unless they name another one
      // (a touch target is about phones): only those others are UI/UX.
      return f.aspect === undefined || f.aspect === 'Accessible' ? 'Accessibility' : 'UI/UX';
```
Nothing else changes.

## Tests
Edit `packages/types/tests/issue-type.test.ts`. In the existing test `maps checkers`, replace the line
```ts
    expect(issueTypeOf({ checker: 'ux-quality' })).toBe('UI/UX');
```
with
```ts
    expect(issueTypeOf({ checker: 'ux-quality' })).toBe('Accessibility');
    expect(issueTypeOf({ checker: 'ux-quality', aspect: 'Accessible' })).toBe('Accessibility');
    expect(issueTypeOf({ checker: 'ux-quality', aspect: 'Fast and mobile' })).toBe('UI/UX');
    expect(issueTypeOf({ checker: 'ux-quality', aspect: 'Looks and reads well' })).toBe('UI/UX');
```
Run:
`pnpm exec vitest run packages/types/tests/issue-type.test.ts packages/core/tests/issues-document.test.ts`
(`issues-document.test.ts` uses `design-standards` findings for its UI/UX group, so it passes unchanged.)
Then `pnpm build`, and search the wizard and runner tests for a pinned mapping: Grep `ux-quality` together with `UI/UX` under `packages/wizard/tests` and `packages/runner/tests`; update any test that expected a `ux-quality` finding under UI/UX to expect Accessibility.

## Done when
- [x] Updated test passes; `issues-document.test.ts` passes unchanged.
- [x] `pnpm build` passes.

## Notes
- Owner decision made here: the mapping follows the area the finding already counts toward, so the issues document and the grades agree.
- Do not reorder `ISSUE_TYPES`; the document lists types in that order.
- This file is imported by the wizard: no Node built-ins.
