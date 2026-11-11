# T-277: Record why the runner image stays single-stage

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | infra | decision | todo |

**Files you may edit (no others):**

- `packages/runner/Dockerfile`

**Do not build in parallel with:** nothing.

## Problem

`packages/runner/Dockerfile` is a single stage. `pnpm install` has no `--prod`, so the final image keeps devDependencies (typescript, vite, tailwind), all `src/` folders and the wizard source. The audit asked for two stages.

T-212 decided "the site image stays single-stage" (its Notes). That was about `site/Dockerfile` only, and T-212 edited only `docs/CONTAINER_DEPLOYMENT.md`, so the runner image was never decided. The file has no comment saying whether single-stage is on purpose.

## Owner decision needed

Options:

- **A. Keep single-stage and say so in the Dockerfile.** The base image (Playwright with Chromium) is over 1 GB, so dropping devDependencies would save a small share of it. A two-stage build must keep: the workspace `node_modules` layout that pnpm links, the wizard `dist` that the runner serves from `packages/wizard/dist`, the `templates` folder, and the `qa` user and writable folders. None of that can be checked without building and starting the image, and `build-secret-scan` in `ci.yml` also scans `/app` as it is today.
- **B. Two stages** (build stage, then a final stage with `pnpm install --prod`). Smaller image and fewer packages in the attack surface, but a rewrite that needs a local Docker build and a start-up test.

**Recommended default: A.** The Change below is written for A. If the owner picks B, close this ticket and write a new one that includes a container start test.

## Current code

Branch from `main`. `grep -n "^RUN pnpm\|^FROM" packages/runner/Dockerfile`.

`packages/runner/Dockerfile` lines 20-21:

```dockerfile
ENV VITE_COUNTER_URL=$VITE_COUNTER_URL \
    VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL \
    VITE_SIGNUP_URL=$VITE_SIGNUP_URL
RUN pnpm --filter "@qa/runner..." run build && pnpm --filter @qa/wizard run build
```

## Change

1. Insert this comment directly above the line `RUN pnpm --filter "@qa/runner..." run build && pnpm --filter @qa/wizard run build` (after the `ENV VITE_...` block):

```dockerfile
# Single stage on purpose (decided 2026-11): the Playwright base image is the bulk of the size, the runner serves the
# wizard from packages/wizard/dist and needs the pnpm-linked node_modules, and build-secret-scan scans /app as it is.
# devDependencies stay in the image. A two-stage build needs a local Docker build and start test first.
```

2. Do not change any instruction line. Do not write the base image name or a `:v...` tag in the comment: `scripts/check-playwright-version.mjs` reads the image tag from this file. Do not write the text `fixtures/` either (`packages/wizard/tests/repo-hygiene.test.ts` forbids it).

## Tests

```
pnpm exec vitest run packages/wizard/tests/repo-hygiene.test.ts packages/runner/tests/playwright-version-check.test.ts
node scripts/check-playwright-version.mjs
```

Both must pass. `git diff --stat` must show only comment lines added.

## Done when

- [ ] `grep -c "Single stage on purpose" packages/runner/Dockerfile` prints 1.
- [ ] `git diff packages/runner/Dockerfile` shows only added lines starting with `#`.
- [ ] The two tests and the version check pass.

## Notes

- No Docker build is needed for a comment-only change. CI's `build-secret-scan` builds the image after the pull request opens.
