# T-209: Remove the `engine` input nothing reads from the workflow template

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | config | bug | built |

**Files you may edit (no others):**
- `templates/qa-check.yml`

**Do not build in parallel with:** none.

## Problem
`templates/qa-check.yml` is the workflow file people copy into their own repository. Commit `df1a17f` added a
`workflow_dispatch` input named `engine` ("chromium, webkit, firefox, or android-chrome"). Nothing reads it:
the job's `env` block has no entry for it, and `inputs.engine` / `QA_ENGINE` appear nowhere in
`packages/runner/src/checkup.ts`, `packages/wizard/src/lib/workflow.ts` or any test. A person who picks
`firefox` still gets Chromium, and the run says nothing about it.

## Current code
`templates/qa-check.yml:16-31` (branch `worktree-audit-cleanup`)
```yaml
on:
  workflow_dispatch:
    inputs:
      url:
        description: The address to check
        required: true
        default: '__DEFAULT_URL__'
      staging:
        description: This is a test copy of the site (so forms may be filled in and sent)
        type: boolean
        default: false
      engine:
        description: Browser engine (chromium, webkit, firefox, or android-chrome)
        required: false
        default: 'chromium'
  # A preview or staging deployment (Vercel, Netlify, Render and others report it this way).
  deployment_status:
```

## Change
1. Delete these four lines (26-29) and nothing else:
   ```yaml
         engine:
           description: Browser engine (chromium, webkit, firefox, or android-chrome)
           required: false
           default: 'chromium'
   ```
   The `staging` input's `default: false` line is then followed directly by the
   `  # A preview or staging deployment ...` comment.

## Tests
```
pnpm exec vitest run packages/wizard/tests/workflow.test.ts
pnpm format:check
```
This grep must print nothing:
```
grep -n "engine" templates/qa-check.yml
```

## Done when
- [x] `templates/qa-check.yml` has no `engine` input.
- [x] `workflow.test.ts` passes.
- [x] `pnpm format:check` passes.

## Notes
- `.github/workflows/qa-check.yml` (this repository's own copy) never had the input. Do not edit it.
- The Wizard builds this template into its bundle (`import template from '../../../../templates/qa-check.yml?raw'`
  in `packages/wizard/src/lib/workflow.ts`), so the change also changes the text the Wizard hands out. That is
  intended.
- Wiring a real engine choice through `checkup.ts` is a feature, not this ticket.
- `docs/OPEN_ISSUES.md` row G18 mentions the template. That file is deleted by T-217; do not edit it here.
