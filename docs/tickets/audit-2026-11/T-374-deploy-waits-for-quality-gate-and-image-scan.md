# T-374: Deploy waits for the CI quality gate and scans the image it ships

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | ci | gap | todo |

**Files you may edit (no others):**

- `.github/workflows/deploy.yml`

**Do not build in parallel with:** T-225, T-226, T-375, T-376, T-381 (all edit `deploy.yml`).

## Problem

A push to `main` runs two workflows: CI and Deploy. CI has the quality gate (lint, format check, typecheck). Deploy does not wait for it. Deploy's `build-and-smoke` job runs `pnpm lint` (`deploy.yml:68-69`) but not `pnpm format:check` or `pnpm typecheck`, and the two deploy jobs only need `[build-and-smoke, test, audit, secret-scan]` (`deploy.yml:148`, `deploy.yml:221`). CI failed on `main` for three commits in a row (Prettier) while Deploy went green and published each time. The formatting itself was fixed in `676f7bb`; the gap that let it ship is still open.

The second gap is the image. CI's `build-secret-scan` job builds the runner image and runs `scripts/scan-build-secrets.mjs` over the files in it (`ci.yml:101-138`). Deploy builds its own image in the `cloud-run` job (`deploy.yml:173-179`) and pushes it without that scan. So the image that reaches Cloud Run (the hosted copy, shared by testers) is never checked for an AI key.

## Current code

Branch from `main`. `grep -n "pnpm lint\|docker build\|docker push\|needs:" .github/workflows/deploy.yml`.

`deploy.yml` (`build-and-smoke`, after the Playwright check):

```yaml
      - name: Lint
        run: pnpm lint
```

`deploy.yml` (`cloud-run`):

```yaml
      - name: Build and push the runner image
        run: |
          IMAGE="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/qa/runner:$GITHUB_SHA"
          gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet
          docker build -f packages/runner/Dockerfile -t "$IMAGE" .
          docker push "$IMAGE"
          echo "IMAGE=$IMAGE" >> "$GITHUB_ENV"
```

CI's version of the scan (`grep -n "Export the runner image" -A12 .github/workflows/ci.yml`) creates a container, copies `/app` out, dumps the image config and history, then runs `node scripts/scan-build-secrets.mjs "$RUNNER_TEMP/runner-image"`.

## Change

1. `build-and-smoke`: after the `Lint` step add:

```yaml
      - name: Check formatting
        run: pnpm format:check

      - name: Typecheck
        run: pnpm typecheck
```

   `NODE_OPTIONS: --max-old-space-size=8192` is already set on this job. The job has `timeout-minutes: 10` (`deploy.yml:48`); raise it to `20` because it now also type-checks.

2. `cloud-run`: split the image step so the scan runs before the push. Replace `Build and push the runner image` with three steps (the `docker build` line is the same one as today):

```yaml
      - name: Build the runner image
        run: |
          IMAGE="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/qa/runner:$GITHUB_SHA"
          docker build -f packages/runner/Dockerfile -t "$IMAGE" .
          echo "IMAGE=$IMAGE" >> "$GITHUB_ENV"

      # The same scan CI runs (ci.yml, build-secret-scan): the files in the image, its environment and build history.
      - name: Scan the runner image for AI keys
        run: |
          out="$RUNNER_TEMP/runner-image"
          mkdir -p "$out"
          id=$(docker create "$IMAGE")
          docker cp "$id:/app" "$out/app"
          docker rm "$id" > /dev/null
          docker image inspect "$IMAGE" > "$out/image-config.json"
          docker history --no-trunc "$IMAGE" > "$out/image-history.txt"
          node scripts/scan-build-secrets.mjs "$out"

      - name: Push the runner image
        run: |
          gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet
          docker push "$IMAGE"
```

   The scan script is plain Node with no dependencies, so the job needs no `pnpm install`. The runner's default Node is enough; if `node --version` is below 22.9 on the runner image, add `actions/setup-node` with `node-version: 22`.

3. Do not touch the `site` job's image: it copies `public/`, which `build-and-smoke` already built and which has no AI key path. (The wizard bundle scan stays in CI.)

4. Run `pnpm exec prettier --check .github/workflows/deploy.yml`.

## Tests

No test reads workflow files for this change. Check by reading, then `pnpm exec prettier --check .github/workflows/deploy.yml`. After the pull request merges, the first `main` run must show the new steps in the Actions log.

## Done when

- [ ] `grep -n "format:check\|pnpm typecheck" .github/workflows/deploy.yml` finds both steps in `build-and-smoke`.
- [ ] `grep -n "scan-build-secrets" .github/workflows/deploy.yml` finds the scan, on a line before `docker push`.
- [ ] `grep -n "docker push" .github/workflows/deploy.yml` finds one push for the runner image, after the scan.
- [ ] Prettier check passes.

## Notes

- Audit finding H11, remainder (audit of 11 Nov 2026 on `d225418`). The formatting failure itself was fixed in `676f7bb`.
- Human step, not in this ticket: turn on branch protection for `main` (GitHub > Settings > Branches) with the CI checks (`quality-gate`, the test shards, `audit`, `secret-scan`, `build-secret-scan`) required, so a red CI blocks the merge. Deploy can then trust that `main` passed them. This is a repository setting, so nobody can build it as a code change.
- T-226 moves the `audit` and `secret-scan` jobs into reusable workflows and T-225 pins the actions in this file: edit `deploy.yml` after them, or merge by hand.
- T-227 raises the CI quality gate timeout; it is the same idea as the timeout change in step 1.
