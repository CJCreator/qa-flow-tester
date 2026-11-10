# T-180: remove test-only exports from @qa/types and fix three misplaced comments

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | types | dead-code | todo |

**Files you may edit (no others):**
- `packages/types/src/website-audit.ts`
- `packages/types/src/intent.ts`
- `packages/types/src/test-case.ts`
- `packages/types/src/evidence-finding.ts`
- `packages/types/src/problems.ts`
- `packages/types/tests/website-audit.test.ts`
- `packages/types/tests/intent.test.ts`

**Do not build in parallel with:** T-164, T-165 (same file `problems.ts`).

## Problem
Small leftovers in the shared types package. Each change is a deletion or a comment move; none changes behaviour.
1. `AUDIT_NOTE_KINDS` and `AuditNoteKind` (`website-audit.ts`): used only by one test that asserts the list equals itself. `AuditResult.notes` is a plain `string[]`; nothing reads note kinds.
2. `isDenied` (`intent.ts`): used only by one test line. All product code calls `intentOf(item) === 'denied'`.
3. `test-case.ts`: the doc comment for `validationError` sits above `refusal`, so `validationError` has no comment and `refusal` has two.
4. `evidence-finding.ts`: the doc comment for `seenAt` sits above `docSource`, four lines away from `seenAt`.
5. `problems.ts`: the comment on `problemKey` says a missing page title found by two checks shares one key. It does not: `mergeDuplicateFindings` in core writes a key that includes the checker on every finding, so the plain-title fallback is never used for Check-up findings.

## Current code
`packages/types/src/website-audit.ts:674-676` (branch `worktree-audit-cleanup`)
```ts
/** Structured note kinds that can appear in result.notes (ADR 0042). */
export const AUDIT_NOTE_KINDS = ['ai-status', 'only-one-page', 'speed-source', 'site-stopped-answering'] as const;
export type AuditNoteKind = (typeof AUDIT_NOTE_KINDS)[number];
```
`packages/types/tests/website-audit.test.ts:16` (in the import list) and `:460-462`
```ts
  AUDIT_NOTE_KINDS,
```
```ts
  it('AUDIT_NOTE_KINDS includes expected note kinds', () => {
    expect(AUDIT_NOTE_KINDS).toEqual(['ai-status', 'only-one-page', 'speed-source', 'site-stopped-answering']);
  });
```
`packages/types/src/intent.ts:19-21`
```ts
export function isDenied(item: { intent?: PlanIntent; kind?: string }): boolean {
  return intentOf(item) === 'denied';
}
```
`packages/types/tests/intent.test.ts:2` and `:13`
```ts
import { INTENTS, intentOf, isDenied, normalizePlanIntents } from '../src/intent.js';
```
```ts
    expect(isDenied(legacy)).toBe(true);
```
`packages/types/src/test-case.ts:51-69`
```ts
  origin?: RuleOrigin;
  /**
   * Behaviour check for a guessed validation rule: after the steps, an error message or an
   * invalid-field marker should appear. The exact wording isn't checked.
   */
  /**
   * Refusal rule (ADR 0024): after the steps the app must have refused the input. `message` is set
   * only when a Source states the wording.
   */
  refusal?: {
    formPath: string;
    submitSelector?: string;
    message?: string;
    /** Look only at the form's own checks; never click submit. */
    probeOnly?: boolean;
  };
  validationError?: {
    field: string;
    selector?: string;
    description?: string;
  };
```
`packages/types/src/evidence-finding.ts:107-115`
```ts
  /** How many times the same problem was seen in this run, when more than once. */
  occurrences?: number;
  /** Where else the same problem was seen: pages, widths, roles and test points. */
  /** The document section the expectation came from, when the Plan Item had a Source. */
  docSource?: DocSource;
  /** An AI-judged logical-flow call: held out of the verdict until the person accepts it. Set with `needsConfirmation`. */
  needsJudgement?: boolean;
  /** The person accepted a judgement item: it now counts (`needsConfirmation` is cleared). */
  judgementAccepted?: boolean;
  seenAt?: { pages: string[]; breakpoints: Breakpoint[]; roles: string[]; testCaseIds: string[] };
```
`packages/types/src/problems.ts:143-150`
```ts
/**
 * The same problem, found by more than one check or on more than one page, has one key: the
 * checker's own `issueKey` when it gives one (a missing page title is both an accessibility and a
 * search problem), else its plain title.
 */
export function problemKey(f: Pick<Finding, 'title'> & { issueKey?: string }): string {
  return f.issueKey ?? plainTitleText(f.title).toLowerCase();
}
```

## Change
1. `website-audit.ts`: delete the three lines (comment, const, type). In `website-audit.test.ts`: remove `AUDIT_NOTE_KINDS,` from the import list and delete the three-line test.
2. `intent.ts`: delete `isDenied` (three lines and the blank line after it). In `intent.test.ts`: change the import to `import { INTENTS, intentOf, normalizePlanIntents } from '../src/intent.js';` and delete the line `expect(isDenied(legacy)).toBe(true);`.
3. `test-case.ts`: move the first comment block (the one starting "Behaviour check for a guessed validation rule") from above `refusal` to directly above `validationError?: {`. Result:
```ts
  origin?: RuleOrigin;
  /**
   * Refusal rule (ADR 0024): after the steps the app must have refused the input. `message` is set
   * only when a Source states the wording.
   */
  refusal?: {
    formPath: string;
    submitSelector?: string;
    message?: string;
    /** Look only at the form's own checks; never click submit. */
    probeOnly?: boolean;
  };
  /**
   * Behaviour check for a guessed validation rule: after the steps, an error message or an
   * invalid-field marker should appear. The exact wording isn't checked.
   */
  validationError?: {
```
4. `evidence-finding.ts`: move the `seenAt` line up, directly under its comment. Result:
```ts
  /** How many times the same problem was seen in this run, when more than once. */
  occurrences?: number;
  /** Where else the same problem was seen: pages, widths, roles and test points. */
  seenAt?: { pages: string[]; breakpoints: Breakpoint[]; roles: string[]; testCaseIds: string[] };
  /** The document section the expectation came from, when the Plan Item had a Source. */
  docSource?: DocSource;
  /** An AI-judged logical-flow call: held out of the verdict until the person accepts it. Set with `needsConfirmation`. */
  needsJudgement?: boolean;
  /** The person accepted a judgement item: it now counts (`needsConfirmation` is cleared). */
  judgementAccepted?: boolean;
```
5. `problems.ts`: replace the comment above `problemKey` (code unchanged) with:
```ts
/**
 * The key a problem is grouped by: its `issueKey` when it has one, else its plain title. A Check-up's
 * findings always have one (core's `mergeDuplicateFindings` writes `checker|title|where`), so there the
 * same problem found by two checkers stays two problems. The plain-title fallback serves findings that
 * were never merged.
 */
```

## Tests
- Before deleting, Grep under `packages/` (all of `src` and `tests`, wizard included) for `AUDIT_NOTE_KINDS`, `AuditNoteKind` and `isDenied`. At the time of writing the only uses are the definitions and the two test files named above. If anything else uses one of them, leave that item in place and say so in your report.
- `pnpm exec vitest run packages/types/tests/website-audit.test.ts packages/types/tests/intent.test.ts`
- `pnpm build` and `pnpm typecheck`

## Done when
- [ ] Grep for `AUDIT_NOTE_KINDS`, `AuditNoteKind` and `isDenied` under `packages/` finds nothing.
- [ ] Both test files pass; `pnpm build` and `pnpm typecheck` pass.

## Notes
- Kept on purpose: `RunStartReply` and `ApprovalReply` in `checkup-api.ts`. They are used only by a test today, but they describe the wire shapes of the runner's replies; using them in the runner and wizard is separate work.
- Not decided here: whether one problem found by two checkers (a missing page title is reported by the search check and by the accessibility scan) should count once. It needs an owner decision on which area the merged problem counts toward; step 5 only makes the comment tell the truth.
- These modules are imported by the wizard: no Node built-ins.
