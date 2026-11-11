# T-252: Recording masked visual baselines is unreachable (`RunOptions.updateBaselines`)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | dead-code | todo |

**Files you may edit (no others):**

- `packages/core/src/orchestrator.ts`
- `packages/core/src/visual-capture.ts`
- `docs/adr/0019-visual-diff-stabilising-and-masking.md`

**Do not build in parallel with:** T-247 (edits `orchestrator.ts`).

## Problem

ADR 0019 says new visual baselines are taken with masks (dates, ads, password fields) and get a `.visual.json` sidecar, and that "re-recording with update mode adopts masking". In the code:

- The only code that writes a masked baseline and its sidecar is the `if (options.updateBaselines)` branch in `orchestrator.ts`, which calls `writeVisualBaseline`.
- `RunOptions.updateBaselines` is never set by any caller: not the runner, not the CLI, not the wizard (`grep -rn "updateBaselines" packages scripts docs` shows only the option and the `if`).
- The runner's "accept baseline" route (`POST /api/runner/baselines/accept`) copies a screenshot into `.qa-baselines/<id>.png` with no sidecar.

So no baseline in a normal install has a sidecar, every comparison runs unmasked, and the masking half of ADR 0019 never takes effect. T-135 left the option alone because wiring it is a product decision.

## Owner decision needed

- **A. Delete the unreachable recording code (recommended default, matches the standing "delete everything unused" decision).** Remove `updateBaselines`, its `if` branch and `writeVisualBaseline`. Keep the code that reads a sidecar, so a hand-placed masked baseline still compares masked. Amend ADR 0019 to say so. Cheap and reversible through git.
- **B. Finish the feature.** Add a Check-up option "Record visual baselines" (a field in `packages/types/src/checkup-api.ts`, a stored-context field, `checkup-run.ts` passing it as `updateBaselines`, a CLI flag in `runner/src/checkup.ts`, a checkbox in the wizard, docs). About M to L, touches four packages. It makes ADR 0019 true. Needs its own plan and tickets.
- **C. Leave it** and amend only the ADR. The dead branch stays.

This ticket builds A. If the owner picks B, close this ticket and plan B instead.

## Current code

Branch from `main`.

`packages/core/src/orchestrator.ts`:

```ts
import { captureVisualShot, readBaselineMode, writeVisualBaseline } from './visual-capture.js';
```

```ts
  /** Overwrite visual baselines with this run's screenshots instead of comparing against them. */
  updateBaselines?: boolean;
```

```ts
          const baselinePath = path.join(baselineDir, `${testCase.id}-${bp}.png`);
          if (testPointPassed && pageLevelChecks) {
            if (options.updateBaselines) {
              const extraSelectors = options.profile?.visualMaskSelectors;
              const shot = await captureVisualShot(page, { masked: true, extraSelectors });
              await writeVisualBaseline(baselinePath, shot, { extraSelectors });
            } else {
              const baseline = await fs.readFile(baselinePath).catch(() => null);
              if (baseline) {
                ... (compare, copy evidence, push the visual-diff finding)
              }
            }
          }
```

(find it with `grep -n "options.updateBaselines" packages/core/src/orchestrator.ts`; the `else` body is about 30 lines.)

`packages/core/src/visual-capture.ts` has `export async function writeVisualBaseline(pngPath, buf, opts)`, used only by the branch above. `sidecarPath`, `sha256` and `readBaselineMode` are used by `readBaselineMode` and stay.

## Change

1. `orchestrator.ts`:
   - Delete the `updateBaselines?: boolean;` option and its comment.
   - Remove `writeVisualBaseline` from the import.
   - Replace `if (options.updateBaselines) { ... } else { <body> }` by just `<body>`: the `const baseline = await fs.readFile(...)` line and the `if (baseline) { ... }` block stay exactly as they are, one level out.
2. `visual-capture.ts`: delete `writeVisualBaseline`. Then remove any import the build reports as unused (`pnpm build` and `pnpm exec eslint packages/core/src/visual-capture.ts`).
3. `docs/adr/0019-visual-diff-stabilising-and-masking.md`: after the bullet that starts `**A sidecar decides how to compare.**` add:

```
- **Status (T-252).** Nothing in the app or the CLI records a masked baseline: accepting a baseline copies a screenshot and writes no sidecar, so baselines compare unmasked. The unreachable recording code (`updateBaselines`, `writeVisualBaseline`) was deleted. Masks apply only to a baseline that has a valid sidecar placed by hand. Recording masked baselines from a Check-up needs a new decision.
```

4. Run `pnpm exec prettier --write packages/core/src/orchestrator.ts packages/core/src/visual-capture.ts docs/adr/0019-visual-diff-stabilising-and-masking.md`, then `pnpm build`.

## Tests

No new test. The code removed had no caller and no test. The build proves nothing else used it:

- `pnpm build`
- `pnpm typecheck`
- `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`

`visual-capture.test.ts` is browser-tier (Chromium); it does not use `writeVisualBaseline` (`grep -rn "writeVisualBaseline" packages/*/tests` prints nothing). Do not run it here.

## Done when

- [ ] `grep -rn "updateBaselines\|writeVisualBaseline" packages --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist` prints nothing.
- [ ] ADR 0019 has the Status bullet.
- [ ] `pnpm build`, `pnpm typecheck` and the unit tests pass.

## Notes

- The comparison path is unchanged: a baseline with no valid sidecar compares exactly as before.
- `profile.visualMaskSelectors` (the person's extra mask selectors) is still read by `readBaselineMode` users only through a sidecar. With no way to write a sidecar it has no effect either. If the owner picks A, mention this in the PR so the setting can be removed in a follow-up.
