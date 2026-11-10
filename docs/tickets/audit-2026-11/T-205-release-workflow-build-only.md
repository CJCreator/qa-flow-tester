# T-205: Release workflow builds only, never publishes

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P0 | S | ci | bug | todo |

**Files you may edit (no others):**
- `.github/workflows/release.yml`

**Do not build in parallel with:** T-214 (same file; build T-205 first).

## Problem
Commit `df1a17f` made the release workflow push Docker images to `ghcr.io` and create a GitHub release, with
`contents: write` and `packages: write`. The file's own first line says "No publish step, no secrets", and
`packages/runner/tests/release-workflow.test.ts` forbids it. That test is the one failing unit test:

```
FAIL packages/runner/tests/release-workflow.test.ts > release workflow > builds and does not publish
AssertionError: expected '# Builds the tagged version. No publi…' to contain 'contents: read'
```

Owner decision (2026-11-10): the release workflow stays build only.

## Current code
`.github/workflows/release.yml:9-11` (branch `worktree-audit-cleanup`)
```yaml
permissions:
  contents: write
  packages: write
```

`.github/workflows/release.yml:72-101` (the end of the file)
```yaml
      - name: Build
        run: pnpm build

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and Push Release Runner Image
        run: |
          IMAGE_NAME="ghcr.io/${GITHUB_REPOSITORY,,}/runner"
          docker build -f packages/runner/Dockerfile -t "${IMAGE_NAME}:${GITHUB_REF_NAME}" -t "${IMAGE_NAME}:latest" .
          docker push "${IMAGE_NAME}:${GITHUB_REF_NAME}"
          docker push "${IMAGE_NAME}:latest"

      - name: Build and Push Release Site Image
        run: |
          IMAGE_NAME="ghcr.io/${GITHUB_REPOSITORY,,}/site"
          docker build -f site/Dockerfile -t "${IMAGE_NAME}:${GITHUB_REF_NAME}" -t "${IMAGE_NAME}:latest" .
          docker push "${IMAGE_NAME}:${GITHUB_REF_NAME}"
          docker push "${IMAGE_NAME}:latest"

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          draft: false
          prerelease: false
```

## Change
1. Replace lines 9-11 with exactly:
   ```yaml
   permissions:
     contents: read
   ```
2. Delete everything after the `Build` step, so the file ends with these two lines (and one final newline):
   ```yaml
         - name: Build
           run: pnpm build
   ```
   That removes four steps: `Log in to GitHub Container Registry`, `Build and Push Release Runner Image`,
   `Build and Push Release Site Image`, `Create GitHub Release`.
3. Change nothing else. Line 1 (the header comment) is already correct. Keep the `Tests` step as
   `run: pnpm exec vitest run`.

## Tests
```
pnpm exec vitest run packages/runner/tests/release-workflow.test.ts
pnpm format:check
```
Do not edit the test file. It must pass unchanged.

## Done when
- [ ] `release-workflow.test.ts` passes, all 5 tests.
- [ ] `release.yml` contains none of: `docker push`, `softprops`, `secrets.`, `contents: write`, `packages: write`.
- [ ] `release.yml` still contains `pnpm install --frozen-lockfile`, `pnpm build`, `contents: read`.
- [ ] `pnpm test` (the unit tier) has 0 failures.

## Notes
- The test also forbids the words `branches`, `pull_request`, `workflow_dispatch`, `schedule`, `npm publish`,
  `gh release`, `upload-artifact` anywhere in the file, comments included. Do not add them.
- `docs/OPEN_ISSUES.md` row G31 describes the publishing. That file is deleted by T-217; do not edit it here.
- Out of scope: which test tier the workflow runs (T-214).
