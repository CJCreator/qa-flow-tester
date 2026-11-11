# T-228: Run the plugin checks in CI

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | ci | gap | todo |

**Files you may edit (no others):**
- `.github/workflows/ci.yml`
- `docs/TESTING.md`

**Do not build in parallel with:** T-225, T-226, T-227 (all edit `ci.yml`).

## Problem

`pnpm test:plugin` validates `plugins/repo-orchestrator` and runs its 8 node tests. No workflow runs it, so a change that breaks the plugin passes CI. The command passes today (8 of 8, about half a second) and needs no build.

## Current code

Branch from `main`.

`package.json`:

```json
"test:plugin": "node plugins/repo-orchestrator/scripts/validate.mjs && node --test plugins/repo-orchestrator/test/*.test.mjs",
```

`.github/workflows/ci.yml`, end of the `quality-gate` job:

```yaml
      # Blocking: tsc -p tsconfig.test.json --noEmit. A type error fails the job.
      - name: Typecheck
        run: pnpm typecheck
```

`docs/TESTING.md` line 16 mentions the command without saying where it runs:

```
`pnpm test:plugin` (the `plugins/repo-orchestrator` checks).
```

## Change

1. In `ci.yml`, add this step to the `quality-gate` job directly after the `Typecheck` step, at the same indentation:

```yaml
      - name: Plugin checks
        run: pnpm test:plugin
```

2. In `docs/TESTING.md`, change `` `pnpm test:plugin` (the `plugins/repo-orchestrator` checks). `` to `` `pnpm test:plugin` (the `plugins/repo-orchestrator` checks; blocking in `ci.yml`). ``

3. Run `pnpm exec prettier --check .github/workflows/ci.yml docs/TESTING.md`.

## Tests

Run `pnpm test:plugin` locally. It must print `pass 8` and `fail 0`.

## Done when

- [ ] `grep -n "pnpm test:plugin" .github/workflows/ci.yml` shows one line, inside `quality-gate`.
- [ ] `pnpm test:plugin` passes locally.
- [ ] `docs/TESTING.md` says the command is blocking in `ci.yml`.

## Notes

- The script uses a shell glob (`test/*.test.mjs`). The CI runner is Linux with bash, which expands it. Do not rewrite the script.
