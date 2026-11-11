# T-377: Docker base images are pinned by digest, and `.dockerignore` covers nested secrets and data

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | infra | security | todo |

**Files you may edit (no others):**

- `packages/runner/Dockerfile`
- `site/Dockerfile`
- `.dockerignore`

**Do not build in parallel with:** T-277, T-373, T-376, T-383 (all edit `Dockerfile`); T-272 (edits `.dockerignore`).

## Problem

Two small gaps in how the images are built.

1. Both base images are pinned by tag only: `FROM mcr.microsoft.com/playwright:v1.63.0-noble` (`packages/runner/Dockerfile:3`) and `FROM nginxinc/nginx-unprivileged:1.27-alpine` (`site/Dockerfile:3`). A tag can be moved by the registry owner, and `1.27-alpine` moves on every patch release. The deploy builds these on a runner that holds Google Cloud sign-in, so what the tag points at on the day of the deploy is what ships. A digest (`@sha256:...`) makes the base image the same one every time.
2. `.dockerignore` only skips root-level names. It has `.env` and `.qa-keys.json` (root only, because a pattern without `**/` matches the context root), so a `.env`, `.env.local` or `.qa-keys.json` inside `packages/*` would be sent to the daemon and copied by `COPY packages/runner packages/runner`. The Dockerfiles copy whole package folders.

## Current code

Branch from `main`. `grep -n "^FROM" packages/runner/Dockerfile site/Dockerfile` and `cat .dockerignore`.

`.dockerignore` today (21 lines): `**/node_modules`, `**/dist`, `.git`, `.scratch`, `.kilo`, `.claude`, `.playwright-mcp`, `.qa-report`, `.qa-runner-report`, `.qa-compare`, `.qa-cache`, `.qa-hub-storage`, `.qa-keys.json`, `.qa-ai-models.json`, `.tmp-*`, `.env`, `npm-debug.log`, `yarn-error.log`, `pnpm-debug.log`, `.DS_Store`, `*.local`.

The only tracked file with these names is `.env.example` at the root (`git ls-files | grep "\.env\|\.qa-"`), and no Dockerfile copies it.

## Change

1. Build after T-272. T-272 already adds `docs`, `coverage`, `.qa-data`, `.qa-tunnel-data`, `.benchmark` and `.ai-eos` to `.dockerignore`. Add only what is still missing. After T-272 the file needs these extra lines (skip any that are already there):

```
**/.env*
!**/.env.example
**/.qa-*
**/.tmp-*
```

   `**/.qa-*` replaces the need for the individual `.qa-keys.json`, `.qa-ai-models.json` and similar root lines; leave those lines in place anyway (harmless, and they document the names). Do not add `.ai-eos` or `coverage` again if T-272 has them.

2. Pin both base images by digest, keeping the tag next to it so Dependabot (T-274 adds the `/site` entry; the runner entry already exists) can still bump both:

```dockerfile
# playwright:v1.63.0-noble
FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:<digest>
```

```dockerfile
# nginx-unprivileged:1.27-alpine
FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:<digest>
```

   Get each digest from the registry, never from memory: `docker buildx imagetools inspect <image>:<tag>` and use the top-level `Digest:` (the multi-platform index digest, so both amd64 and arm64 builds work). The digest must be 64 hex characters. If the command fails, set this ticket to `blocked` with the error.

   `scripts/check-playwright-version.mjs` reads the version with `/^FROM\s+\S*playwright:v(\d+\.\d+\.\d+)/im`, which still matches with a `@sha256:` suffix. Keep the `FROM` line starting with `FROM mcr.microsoft.com/playwright:v`. Do not write `fixtures/` in any comment (`packages/wizard/tests/repo-hygiene.test.ts` forbids it).

3. Do not make the image multi-stage. T-277 records the owner's decision to keep it single-stage.

## Tests

```
node scripts/check-playwright-version.mjs
pnpm exec vitest run packages/runner/tests/playwright-version-check.test.ts packages/wizard/tests/repo-hygiene.test.ts
```

Then a local check that a nested secret is left out: create an empty `packages/runner/.env.local`, run `docker build -f packages/runner/Dockerfile .` if Docker is available (or `docker build --no-cache` with a `RUN ls -a packages/runner` test line you do not commit), and delete the empty file. If Docker is not available, say so in the report; CI's `build-secret-scan` job builds the image.

## Done when

- [ ] `grep -n "^FROM" packages/runner/Dockerfile site/Dockerfile` shows two lines, each with `@sha256:` and 64 hex characters.
- [ ] `grep -n "env\|\.qa-" .dockerignore` shows `**/.env*`, `!**/.env.example` and `**/.qa-*`.
- [ ] The Playwright version check and the two test files above pass.

## Notes

- Audit finding M13, remainder (audit of 11 Nov 2026 on `d225418`). The multi-stage part of M13 is closed by the owner's decision in T-277: do not reopen it.
- T-272 edits `.dockerignore`; T-277 edits `packages/runner/Dockerfile`; T-274 edits `.github/dependabot.yml`. Build this after T-272 and T-277.
- A digest hides new security patches until Dependabot opens a pull request for the new digest. That is the point: a person reviews each base image change.
