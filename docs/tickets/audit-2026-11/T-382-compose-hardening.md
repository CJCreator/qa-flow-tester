# T-382: docker-compose drops capabilities and limits memory

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | infra | security | todo |

**Files you may edit (no others):**

- `docker-compose.yml`
- `docs/CONTAINER_DEPLOYMENT.md`

**Do not build in parallel with:** T-373 (edits `docker-compose.yml`).

## Problem

`docker-compose.yml` is the way to run the tool on a private machine (`docs/CONTAINER_DEPLOYMENT.md:9`). The `runner` service drives Chromium against pages the person points it at, and Chromium runs with `--no-sandbox` (`packages/core/src/browser.ts:121`; the decision is recorded in the comment at `packages/runner/Dockerfile:39`: the container's non-root user is the boundary). With the sandbox off, the container is the only wall, and compose gives it Docker's default capability set, no memory limit and permission to gain privileges. A page that breaks out of the renderer then has more to work with than it needs, and one runaway crawl can use all the memory of the host.

The hosted copy limits the container to 2 GiB (`deploy.yml`, `--memory 2Gi`). The compose file has no limit at all.

## Current code

Branch from `main`. `grep -n "restart\|container_name" docker-compose.yml`.

`docker-compose.yml`, `runner` service:

```yaml
    container_name: qa-flow-tester-runner
    restart: unless-stopped
    ports:
      - '${RUNNER_PORT:-3001}:3001'
```

The image already runs as the non-root user `qa` (`packages/runner/Dockerfile:41-46`), and Chromium needs no extra Linux capability when `--no-sandbox` is set.

## Change

1. In the `runner` service, directly after `restart: unless-stopped`, add:

```yaml
    # The container is the only wall around Chromium (it runs with --no-sandbox, see packages/runner/Dockerfile), so
    # it gets no extra rights and a memory ceiling like the hosted copy's 2 GiB.
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    mem_limit: 2g
```

2. Do not set `read_only: true`, `pids_limit` or `init` here: the runner writes under `/data` and `/app/.qa-baselines`, and a read-only root would need more tmpfs paths that cannot be checked without a start test. Leave the `site` service alone (nginx-unprivileged already runs non-root).
3. `docs/CONTAINER_DEPLOYMENT.md`: add two sentences where the compose file is described: the runner drops all Linux capabilities and is limited to 2 GB of memory, and the limit can be raised in `docker-compose.yml` for large sites. Add one sentence that Chromium runs without its own sandbox inside the container, so the container settings above are the protection.
4. Run `pnpm exec prettier --write docker-compose.yml docs/CONTAINER_DEPLOYMENT.md`.

## Tests

No unit test covers compose. If Docker is available: `docker compose config` shows `cap_drop`, `security_opt` and `mem_limit` on `runner`, and `RUNNER_ACCESS_TOKEN=test docker compose up -d runner` reaches healthy (`docker compose ps`), then `docker compose down`. Say in the report whether you could run it. If not, CI cannot check it either; the change is three standard keys.

## Done when

- [ ] `grep -n "cap_drop\|no-new-privileges\|mem_limit" docker-compose.yml` finds all three, inside the `runner` service.
- [ ] `docs/CONTAINER_DEPLOYMENT.md` mentions the memory limit and that Chromium runs with `--no-sandbox`.
- [ ] Prettier check passes.

## Notes

- Audit finding L6 (audit of 11 Nov 2026 on `d225418`).
- If a crawl of a very large site is killed by the 2 GB limit, the container restarts (`restart: unless-stopped`) and the run is lost. That is the same behaviour as on Cloud Run.
- Out of scope: moving off `--no-sandbox` (needs a seccomp profile or user namespaces; a separate decision).
