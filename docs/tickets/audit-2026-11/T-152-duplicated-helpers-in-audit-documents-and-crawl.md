# T-152: Small helpers are copied between the audit modules

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core/audit | inconsistency | built |

**Files you may edit (no others):**
- `packages/core/src/audit/documents/roadmap.ts`
- `packages/core/src/audit/documents/edits.ts`
- `packages/core/src/audit/documents/settings.ts`
- `packages/core/src/audit/ai/rewrite-store.ts`
- `packages/core/src/audit/crawl/reachability.ts`
- `packages/core/src/audit/crawl/crawl.ts`

**Do not build in parallel with:** T-139, T-142, T-147, T-154 (edit `crawl.ts`); T-143 (edits `rewrite-store.ts`).

## Problem

The same constants and one-line helpers exist in several files. They are identical today, but a change in one copy will not reach the others.

| Helper | Copies |
|---|---|
| "highest of two scales" | `documents/roadmap.ts` (`RANK`, `highest`) and `documents/edits.ts` (`SCALE_RANK`, `highestScale`; its comment says "not exported there") |
| `BAD_CONTROL` regular expression | `documents/edits.ts:72`, `documents/settings.ts:136`, `ai/rewrite-store.ts:30` |
| id pattern `/^[A-Za-z0-9_.:-]{1,64}$/` | `documents/edits.ts:52` (`ID_PATTERN`), `ai/rewrite-store.ts:28` (`SECTION_ID`) |
| start-address refusal wording | `crawl/reachability.ts:35` (`MESSAGES`), `crawl/crawl.ts:72` (`REFUSALS`) |

## Current code

Branch `worktree-audit-cleanup`.

`packages/core/src/audit/documents/roadmap.ts:18`

```ts
/** Lower is more: high 0, medium 1, low 2. */
const RANK: Record<AuditScale, number> = { high: 0, medium: 1, low: 2 };

/** The phase an item of each priority goes in. */
export const ROADMAP_PHASE: Record<AuditScale, number> = { high: 1, medium: 2, low: 3 };

const highest = (a: AuditScale, b: AuditScale): AuditScale => (RANK[a] <= RANK[b] ? a : b);
```

`packages/core/src/audit/documents/edits.ts:456`

```ts
/**
 * `buildRoadmap`'s rule (roadmap.ts, not exported there): an item's priority is the highest impact of its
 * findings and its effort the highest effort. Lower rank is more: high 0, medium 1, low 2.
 */
const SCALE_RANK: Record<AuditScale, number> = { high: 0, medium: 1, low: 2 };
const highestScale = (a: AuditScale, b: AuditScale): AuditScale => (SCALE_RANK[a] <= SCALE_RANK[b] ? a : b);
```

`packages/core/src/audit/documents/edits.ts:52` and `:70`

```ts
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
```

```ts
/** Control characters other than tab, line feed and carriage return. */
// eslint-disable-next-line no-control-regex
const BAD_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
```

`packages/core/src/audit/documents/settings.ts:134` (same three lines as the `BAD_CONTROL` block above).

`packages/core/src/audit/ai/rewrite-store.ts:28`

```ts
const SECTION_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const BAD_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
```

`packages/core/src/audit/crawl/reachability.ts:35`

```ts
const MESSAGES = {
  private: 'This address points to a private or local network. A Website Audit only checks public websites.',
  dns: 'The site name could not be found. Check the address for typos.',
  timeout: 'The site did not answer in time.',
  redirects: 'The site redirected too many times.',
  scheme: 'Only http and https web addresses can be checked.',
  error: 'The site could not be reached.',
} as const;
```

`packages/core/src/audit/crawl/crawl.ts:71`

```ts
/** The words of the start address check (reachability.ts), for the same refusals. */
const REFUSALS: Record<AuditAddressCode, string> = {
  ERR_PRIVATE_ADDRESS:
    'This address points to a private or local network. A Website Audit only checks public websites.',
  ERR_UNREACHABLE: 'The site could not be reached.',
  ERR_DNS: 'The site name could not be found. Check the address for typos.',
};
```

## Change

1. `roadmap.ts`: rename `highest` to an exported `highestScale`, and update its uses in the same file (`group.priority = highest(...)`, `group.effort = highest(...)`):

```ts
/** The higher of two scales (high beats medium beats low). Shared with the edit overlay. */
export const highestScale = (a: AuditScale, b: AuditScale): AuditScale => (RANK[a] <= RANK[b] ? a : b);
```

2. `edits.ts`: delete the comment block, `SCALE_RANK` and the local `highestScale` shown above. Add `import { highestScale } from './roadmap.js';`. If `roadmap.ts` imports anything from `edits.ts` (check its import lines), stop and leave this pair as it is, and say so in your report; otherwise continue.

3. `edits.ts`: export the two constants (add the word `export`, rename nothing):

```ts
export const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
```

```ts
export const BAD_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
```

Keep the comment and the `eslint-disable-next-line` line above `BAD_CONTROL`.

4. `settings.ts`: delete its `BAD_CONTROL` block (comment, eslint line, const) and add `import { BAD_CONTROL } from './edits.js';`. If `edits.ts` imports from `settings.ts`, stop this step, leave `settings.ts` unchanged and say so in your report.

5. `rewrite-store.ts`: delete its `SECTION_ID` and `BAD_CONTROL` lines (and the eslint line). Add `import { BAD_CONTROL, ID_PATTERN as SECTION_ID } from '../documents/edits.js';`. If `rewrite-store.ts` already imports from `'../documents/edits.js'`, add the two names to that import.

6. `reachability.ts`: change `const MESSAGES` to `export const START_ADDRESS_MESSAGES` and update every use of `MESSAGES.` in that file to `START_ADDRESS_MESSAGES.`.

7. `crawl.ts`: replace the `REFUSALS` block with:

```ts
/** The words of the start address check (reachability.ts), for the same refusals. */
const REFUSALS: Record<AuditAddressCode, string> = {
  ERR_PRIVATE_ADDRESS: START_ADDRESS_MESSAGES.private,
  ERR_UNREACHABLE: START_ADDRESS_MESSAGES.error,
  ERR_DNS: START_ADDRESS_MESSAGES.dns,
};
```

Add `START_ADDRESS_MESSAGES` to `crawl.ts`'s existing import from `'./reachability.js'` (add the import line if there is none).

## Tests

No new test: behaviour does not change. Run the tests that cover these modules:

`pnpm exec vitest run packages/core/tests/audit-doc-roadmap.test.ts packages/core/tests/audit-doc-edits.test.ts packages/core/tests/audit-doc-settings.test.ts packages/core/tests/audit-rewrite-store.test.ts packages/core/tests/audit-reachability.test.ts packages/core/tests/audit-crawl-retry.test.ts`

Then `pnpm build` (it type-checks and reports an import cycle problem as an error at run time in the tests above, not in the build).

## Done when

- [x] `BAD_CONTROL` is defined once under `packages/core/src/audit`, the id pattern once, the scale helper once, and the three refusal sentences once.
- [x] The listed tests and `pnpm build` pass.

## Notes

- `preview/template.ts` has its own `escapeHtml`. Leave it: importing the report's `escapeHtml` would tie the preview to `html-report.ts` for five lines.
- Do not change any wording.
