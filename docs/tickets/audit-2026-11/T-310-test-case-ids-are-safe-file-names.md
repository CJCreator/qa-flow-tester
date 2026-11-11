# T-310: Test case ids are safe file names before they reach evidence paths

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/safe-id.ts` (new)
- `packages/core/src/discovery/test-planner.ts`
- `packages/core/src/validator-expander.ts`
- `packages/core/src/orchestrator.ts`
- `packages/core/tests/safe-test-ids.test.ts` (new)

**Do not build in parallel with:** T-311 (edits `test-planner.ts`); T-247, T-252, T-309, T-312, T-316, T-318, T-329, T-342, T-358 (all edit `orchestrator.ts`).

## Problem

The orchestrator builds file paths from a test case's id and screen size:

- the Test point's evidence folder, `path.join(evidenceDir, \`${testCase.id}-${bp}\`)` (`packages/core/src/orchestrator.ts:665`), where screenshots, DOM snapshots and videos are written and where `removeVideosExcept` deletes `.webm` files (`orchestrator.ts:706`, `:1452`);
- the visual baseline, `path.join(baselineDir, \`${testCase.id}-${bp}.png\`)` (`orchestrator.ts:1224`), read on every run and written when baselines are recorded.

Journey ids come from the AI: `TestPlanner` only adds a `TC-` prefix to the AI's `flow.id` (`packages/core/src/discovery/test-planner.ts:87`), and the validation tests append the AI's `rule.field` (`packages/core/src/validator-expander.ts:50`, `:72`, `:91`, `:108`). The screen size comes from the run request: `options.breakpoints` is used as given (`orchestrator.ts:553`), and the runner passes the request body's `breakpoints` with only a type cast (`packages/runner/src/session/checkup-run.ts:670-671`). An id or size holding `../` writes evidence outside the run folder, and those files miss the evidence redaction, which only walks `evidenceDir` (`orchestrator.ts:1673`). On Windows a `:` in an id names an alternate data stream instead of a file.

Other places already clean their names: `repro-generator.ts:33` (`/[^A-Za-z0-9_.-]/g`) and the runner's `/^[\w-]+$/` checks.

## Current code

Branch from `main`.

`packages/core/src/orchestrator.ts` (`grep -n "testCase.id}-\${bp}\|const breakpoints: Breakpoint\[\]" packages/core/src/orchestrator.ts`):

```ts
    const breakpoints: Breakpoint[] = options.breakpoints || ['1440px'];
...
        const testCaseEvidenceDir = path.join(evidenceDir, `${testCase.id}-${bp}`);
...
          const baselinePath = path.join(baselineDir, `${testCase.id}-${bp}.png`);
```

`packages/core/src/discovery/test-planner.ts` (`grep -n "startsWith('TC-')" packages/core/src/discovery/test-planner.ts`):

```ts
      const id = flow.id.startsWith('TC-') ? flow.id : `TC-${flow.id}`;
```

`packages/core/src/validator-expander.ts` (`grep -n "val-\${rule.field}" packages/core/src/validator-expander.ts`): four ids of the form `` `${tc.id}-val-${rule.field}-empty` `` (and `-min`, `-max`).

## Change

1. New file `packages/core/src/safe-id.ts`:

```ts
import path from 'node:path';

/** Letters, digits, `_` and `-` only (anything else becomes `_`), at most 80 characters: a file name part on every system. */
export function safeIdPart(text: string): string {
  return text.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || '_';
}

/** `dir/name` resolved, when it stays inside `dir`; throws otherwise. */
export function pathInside(dir: string, name: string): string {
  const root = path.resolve(dir);
  const full = path.resolve(root, name);
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('A test file name would leave its folder.');
  return full;
}

/** One Test point's evidence folder: always a direct child of `evidenceDir`. */
export function testPointDir(evidenceDir: string, testCaseId: string, breakpoint: string): string {
  return pathInside(evidenceDir, `${safeIdPart(testCaseId)}-${safeIdPart(breakpoint)}`);
}
```

2. `test-planner.ts`: import `safeIdPart`. In `plan()`, keep a `const usedIds = new Set<string>();`. Build the id as `const base = safeIdPart(flow.id); let id = base.startsWith('TC-') ? base : \`TC-${base}\`;` and, when `usedIds` already holds it, append `-2`, `-3`... until free; add it to `usedIds`. `flowId` and `requirementId` keep the AI's `flow.id` (they are never paths). A safe id such as `FLOW-001` stays `TC-FLOW-001`.

3. `validator-expander.ts`: import `safeIdPart` and use `safeIdPart(rule.field)` in the four ids. Selectors and step names keep `rule.field` as it is.

4. `orchestrator.ts`: import `{ safeIdPart, pathInside, testPointDir }` from `./safe-id.js` (`BREAKPOINT_VIEWPORTS` is already imported from `./browser.js`).
   - Line 553: keep only known sizes: `const asked = (options.breakpoints || []).filter((b): b is Breakpoint => Object.hasOwn(BREAKPOINT_VIEWPORTS, b)); const breakpoints: Breakpoint[] = asked.length > 0 ? asked : ['1440px'];`
   - Line 665: `const testCaseEvidenceDir = testPointDir(evidenceDir, testCase.id, bp);`
   - Line 1224: `const baselinePath = pathInside(baselineDir, \`${safeIdPart(testCase.id)}-${safeIdPart(bp)}.png\`);`
   - `removeVideosExcept` keeps working on the folder it is given; it now only ever gets `testPointDir` output.

5. Run `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

New file `packages/core/tests/safe-test-ids.test.ts` (unit tier, no browser):

- `safeIdPart`: `'TC-FLOW-001'` unchanged; `'../../etc/x'` → `'______etc_x'`; `'a:b/c\\d'` → `'a_b_c_d'`; `''` → `'_'`; a 200-character id is cut to 80.
- `testPointDir('/run/evidence', '../../outside', '1440px')` is inside `/run/evidence` (`path.relative` does not start with `..`) and its base name has no `/`, `\` or `..`. `testPointDir(dir, 'TC-1', '../../x')` is inside too.
- `pathInside('/run/base', '../x.png')` throws; `pathInside('/run/base', 'TC-1-1440px.png')` returns `/run/base/TC-1-1440px.png` (use `path.resolve` for the expected value so it passes on Windows).
- `new TestPlanner().plan(draft)` with two flows whose ids are `'../evil'` and `'.._evil'` (minimal `DiscoveryDraft`: `pages`, `forms: []`, `ambiguityQuestions: []`, one `click` step each with a selector): both test case ids match `/^[A-Za-z0-9_-]+$/`, they differ, and each keeps its own `flowId`.
- `expandValidationTestCases` with a test case `{ id: 'TC-1', ... validationRules: [{ field: '../x', expectedError: 'Required' }] }`: every new id matches `/^[A-Za-z0-9_-]+$/`.

Run: `pnpm exec vitest run packages/core/tests/safe-test-ids.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "path.join(evidenceDir, \`\${testCase.id}" packages/core/src/orchestrator.ts` prints nothing; `grep -n "testPointDir(" packages/core/src/orchestrator.ts` finds the evidence folder.
- [ ] `grep -n "path.join(baselineDir" packages/core/src/orchestrator.ts` prints nothing.
- [ ] `grep -n "safeIdPart" packages/core/src/discovery/test-planner.ts packages/core/src/validator-expander.ts` finds the id builders.
- [ ] The new test and the core unit tests pass; `pnpm build` passes.

## Notes

- Audit finding H8 (audit of 11 Nov 2026 on `d225418`).
- The screen-size filter in the orchestrator also covers the runner's unchecked `body.breakpoints` (`checkup-run.ts:670-671`). Refusing a bad size with a clear error at the runner belongs with T-360 (invalid run inputs refused for every caller).
- T-329 later moves visual baselines to `.qa-baselines/<host>/<stable-key>-<bp>.png`; it should keep `pathInside` and `safeIdPart`. T-252 and T-267 also touch the baseline lines.
- `packages/core/src/preflight.ts:55` has a private `isInside`; merging it with `pathInside` is not part of this ticket (T-259 merges the runner's copies).
