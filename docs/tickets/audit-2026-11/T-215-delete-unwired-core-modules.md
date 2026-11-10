# T-215: Delete three core modules nothing uses

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | config | dead-code | todo |

**Files you may edit (no others):**
- `packages/core/src/self-healing.ts` (delete)
- `packages/core/src/network-intel.ts` (delete)
- `packages/core/src/sarif-export.ts` (delete)
- `packages/core/src/index.ts`

**Do not build in parallel with:** none in this batch. Other batches may edit `packages/core/src/index.ts`;
rebase first if it changed.

## Problem
Commit `df1a17f` added three modules to `@qa/core` and exported them, but nothing calls them:

| file | export | importers in `packages/`, `scripts/`, tests |
|---|---|---|
| `packages/core/src/self-healing.ts` | `SelfHealingEngine` | 0 |
| `packages/core/src/network-intel.ts` | `NetworkIntelCollector` | 0 |
| `packages/core/src/sarif-export.ts` | `findingsToSarif` | 0 |

`self-healing.ts` also contradicts ADR 0013, whose status is "Deferred. No decision has been made and nothing
is built." Owner decision (2026-11-10): delete them.

## Current code
`packages/core/src/index.ts:75-77` (branch `worktree-audit-cleanup`)
```ts
export * from './sarif-export.js';
export * from './network-intel.js';
export * from './self-healing.js';
```

## Change
1. Confirm nothing imports them. This must print only lines inside the three files themselves and
   `packages/core/src/index.ts`:
   ```
   grep -rn "self-healing\|network-intel\|sarif-export\|SelfHealingEngine\|NetworkIntelCollector\|findingsToSarif" packages scripts --include=*.ts --include=*.tsx --include=*.mjs --exclude-dir=node_modules --exclude-dir=dist
   ```
   If any other file is listed, stop and report it. Do not delete.
2. Delete the files:
   ```
   git rm packages/core/src/self-healing.ts packages/core/src/network-intel.ts packages/core/src/sarif-export.ts
   ```
3. Delete the three `export *` lines shown above from `packages/core/src/index.ts`.

## Tests
```
pnpm build
pnpm typecheck
pnpm lint
pnpm exec vitest run packages/core/tests/plan-quality-baseline.test.ts
```
The grep from step 1 must now print nothing.

## Done when
- [ ] The three files are gone and `index.ts` no longer exports them.
- [ ] `pnpm build` and `pnpm typecheck` pass.
- [ ] The grep prints nothing.

## Notes
- `packages/core/tests/plan-quality-baseline.test.ts` came in the same commit but does not import these
  modules. Keep it.
- Do not edit ADR 0013: after this ticket its "nothing is built" is true again.
- Text mentions that stay for other tickets: `docs/OPEN_ISSUES.md` rows G14/G21 (file deleted by T-217),
  `docs/tickets/INDEX.md` T-23 note (T-218), `docs/GTM_AND_PRICING.md:45` "SARIF" (T-225),
  `packages/wizard/src/screens/LandingScreen.tsx` "SARIF" (the wizard batch restores the pricing copy).
- Not in scope: `rerunTestCaseIds` in `orchestrator.ts` and the CrUX branch in
  `packages/checkers/src/performance.ts` (other batches).
