# T-376: The generated check-up workflow pins the tool version and gives the AI key only to the check-up step

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | wizard | security | todo |

**Files you may edit (no others):**

- `packages/wizard/src/lib/workflow.ts`
- `packages/wizard/vite.config.ts`
- `templates/qa-check.yml`
- `packages/wizard/tests/workflow.test.ts`
- `packages/runner/Dockerfile`
- `.github/workflows/deploy.yml`
- `docs/DEPLOYMENT.md`

**Do not build in parallel with:** T-277, T-373, T-377, T-383 (all edit `Dockerfile`); T-373, T-383 (all edit `DEPLOYMENT.md`); T-225, T-226, T-374, T-375, T-381 (all edit `deploy.yml`).

## Problem

The wizard gives people a GitHub Actions file to copy into their own repository. That file checks out this tool at `ref: main` (`TOOL_REF = 'main'`, `packages/wizard/src/lib/workflow.ts:9`, filled into `templates/qa-check.yml:54`), then runs `pnpm install` and builds it. So every copy of the file runs whatever is on `main` at that moment, with the person's `QA_AI_API_KEY` in the job's environment: the key is set at job level (`templates/qa-check.yml:43`), so the install step and every dependency install script can read it. One bad commit on `main`, or one moved action tag, runs attacker code with every user's key.

The template's own actions are also on moving tags: `actions/checkout@v4` (line 50), `pnpm/action-setup@v4` (line 57), `actions/setup-node@v4` (line 61), `actions/upload-artifact@v4` (line 79). This repository's own copy, `.github/workflows/qa-check.yml:46-53`, already pins both the tool commit and `pnpm/action-setup` to SHAs, so the generated copy is weaker than ours.

## Owner decision (open)

What should the generated file pin the tool to?

- **A. The commit the wizard was built from (recommended default).** The build puts the commit SHA into the page (`QA_TOOL_SHA`, from the deploy's `GITHUB_SHA`), and the file checks out exactly that commit. A person who copies the file from the hosted copy gets the code that produced the page. Works today, with no releases. A build with no SHA (a local `pnpm dev:wizard`) falls back to `main`.
- **B. The latest release tag.** Easier to read in the file, but there is no release yet (`TOOL_REF` comment: "tag v0.1.0 at release") and the tag must be moved by hand.
- **C. Leave `main`.** Simplest; keeps the risk above.

This ticket builds A unless the owner picks another option.

## Current code

Branch from `main`.

`packages/wizard/src/lib/workflow.ts` (`grep -n "TOOL_REF" packages/wizard/src/lib/workflow.ts`):

```ts
export const TOOL_REF = 'main';
...
  return template.replace('__DEFAULT_URL__', yamlQuote(url.trim())).replace('__QA_TOOL_REF__', TOOL_REF);
```

`templates/qa-check.yml` (`grep -n "QA_AI_API_KEY\|uses:" templates/qa-check.yml`):

```yaml
    env:
      ...
      QA_AI_API_KEY: ${{ secrets.QA_AI_API_KEY }}
      QA_AI_PROVIDER: openrouter
...
      - name: Run the check-up
        run: node .qa-tool/packages/runner/dist/checkup.js
```

`packages/wizard/tests/workflow.test.ts:18-26` allows only `main` or a `vX.Y.Z` tag as the ref, and `:11` expects `ref: main`.

## Change

1. `packages/wizard/vite.config.ts`: read the commit and define it for the bundle. Accept only a full 40-character hex SHA:

```ts
const sha = process.env.QA_TOOL_SHA || process.env.GITHUB_SHA || '';
const toolSha = /^[0-9a-f]{40}$/i.test(sha) ? sha : '';
// ...inside defineConfig({ ... })
define: { __QA_TOOL_SHA__: JSON.stringify(toolSha) },
```

2. `workflow.ts`: declare `declare const __QA_TOOL_SHA__: string | undefined;` and add a pure, exported function so a test can reach it (the unit test project does not use the wizard's Vite config, so the define is absent there):

```ts
/** The ref the generated file checks out: the commit this page was built from, else `main` (a build with no commit). */
export function toolRefFor(sha: string | undefined): string {
  return sha && /^[0-9a-f]{40}$/i.test(sha) ? sha.toLowerCase() : 'main';
}
export const TOOL_REF = toolRefFor(typeof __QA_TOOL_SHA__ === 'undefined' ? undefined : __QA_TOOL_SHA__);
```

   Update the doc comment above `TOOL_REF`: it is the build's commit, else `main`.

3. `packages/runner/Dockerfile`: the build context has no `.git` (`.dockerignore` skips it), so pass the SHA in. Add next to the other `ARG`s (before the `ENV VITE_...` block) `ARG QA_TOOL_SHA=` and add `QA_TOOL_SHA=$QA_TOOL_SHA` to that `ENV` block. Do not write the base image name or a `:v...` tag in any comment you add (`scripts/check-playwright-version.mjs` reads this file).

4. `deploy.yml`, `cloud-run` job: change the runner build line to `docker build --build-arg QA_TOOL_SHA="$GITHUB_SHA" -f packages/runner/Dockerfile -t "$IMAGE" .`. (The site build in `build-and-smoke` gets `GITHUB_SHA` from the environment on its own.) T-374 edits the same step: apply this on top of it.

5. `templates/qa-check.yml`:
   - Move the key out of the job `env`. Delete the `QA_AI_API_KEY:` line there and add it to the `Run the check-up` step only:

```yaml
      - name: Run the check-up
        env:
          QA_AI_API_KEY: ${{ secrets.QA_AI_API_KEY }}
        run: node .qa-tool/packages/runner/dist/checkup.js
```

   - Pin the four actions to commit SHAs with the tag in a comment, the same style as `.github/workflows/qa-check.yml`. Use the SHAs that T-225 puts in the repository's workflows (build T-225 first, copy them from there; do not guess or copy from memory). `pnpm/action-setup` is `fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0`.
   - Change the comment above `ref:` (lines 53-54) to say the file is pinned to the commit the page was built from.

6. `docs/DEPLOYMENT.md` (`grep -n "TOOL_REF" docs/DEPLOYMENT.md`, lines ~76 and ~179): say `TOOL_REF` is the commit the wizard was built from (`QA_TOOL_SHA`, set by the deploy), and that the release-tag step in the version-bump paragraph no longer applies to the generated file.

7. Run `pnpm exec prettier --write` on the changed files, then `pnpm build`.

## Tests

`packages/wizard/tests/workflow.test.ts` (unit tier, no Chromium):

- Replace the `ref: main` assertion with `toolRefFor`: a 40-hex SHA is returned lower-cased; `''`, `undefined`, a short SHA, a branch name and a SHA with a trailing newline all return `main`.
- Replace the "ref is main or a release tag" and "release tag equals the root version" tests: the ref is `main` or 40 hex characters.
- Add: every `uses:` line in `templates/qa-check.yml` matches `@[0-9a-f]{40}` (read the file with `readFileSync`).
- Add: the lines of the template's top-level `env:` block do not contain `QA_AI_API_KEY`, and the `Run the check-up` step does (split the file on `- name:`).
- Keep the "permissions are not widened" and "url quote is escaped" tests.

Run: `pnpm exec vitest run packages/wizard/tests/workflow.test.ts`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "QA_AI_API_KEY" templates/qa-check.yml` finds the key only inside the `Run the check-up` step (and in the setup comment).
- [ ] `grep -n "uses:" templates/qa-check.yml` shows only `@<40-hex> # vX` forms.
- [ ] `grep -n "QA_TOOL_SHA" packages/runner/Dockerfile .github/workflows/deploy.yml packages/wizard/vite.config.ts` finds all three.
- [ ] The new tests pass; `pnpm build` passes.

## Notes

- Audit finding H10 (audit of 11 Nov 2026 on `d225418`).
- A person who already copied the old file keeps `ref: main` until they paste the new one; nothing here can change that. Mention it in `CHANGELOG.md` only if the owner wants a note.
- A commit SHA from a pull request build (`GITHUB_SHA` is a merge commit there) may not exist on the repository's branches. Only the deploy build is served to people, so this does not matter in practice.
- T-225 pins the repository's own workflows. T-374 edits the same `deploy.yml` step. T-277 edits `packages/runner/Dockerfile` (a comment only).
