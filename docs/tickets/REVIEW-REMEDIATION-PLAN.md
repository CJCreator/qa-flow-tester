# Review remediation plan: open tickets

T-41 to T-64 came from the October 2026 app, security and performance reviews. All are built and verified (`e7a6e94`, `6c4b7ce`) except the two below. The full plan, the reviews and the findings-to-ticket mapping are in git history: `git show 68e6b02:docs/tickets/REVIEW-REMEDIATION-PLAN.md`.

## Open tickets

### T-52 Container hardening and health

- **Priority:** P1 · **Size:** M · **Depends on:** T-49, T-51 (built) · **Status:** human (code built; the Docker image digest pin and the `docker run` non-root check need a person with Docker)
- **Goal:** the hosted container runs as a non-root user, reports health from real checks, and does not log credentials.
- **Decision (owner):** keep `--no-sandbox` and isolate the browser per host.
- **Evidence (read at the time):**
  - DEP-3: `browser.ts` always passes `--no-sandbox`; the Dockerfile sets no `USER`.
  - DEP-7: the Dockerfile pins the base image by tag; no `HEALTHCHECK`; Node version from the base image.
  - DEP-8: `server.ts` answers `/healthz` before any check.
  - DEP-9: the `deploy.yml` verify loop can overrun the 15-minute job timeout.
  - DEP-6: `orchestrator.ts` and `discovery-agent.ts` log `targetUrl` with `user:pass@`.
- **In scope:** Dockerfile (`USER`, digest pin, `HEALTHCHECK`, `.nvmrc` Node check); `/healthz` checks the data folder is
  writable and the browser launchable (cached, so cheap); URL credentials stripped before any log line; verify loop
  bounded below the job timeout.
- **Acceptance criteria:**
  - [ ] The image runs as a non-root user (`docker run` test; a human item if CI has no Docker).
  - [ ] `/healthz` returns non-200 when the data folder is read-only (test).
  - [ ] A target URL with credentials is logged without them (test on the log helper).
  - [ ] The verify step fails within 10 minutes (the loop is bounded by time, not count).
  - [ ] The sandbox setting matches the decision above and is documented in `docs/CONFIGURATION.md`.
- **Tests:** `/healthz` test; log redaction test; workflow lint for the timeout.

### T-23 Split large files by area

- **Priority:** P3 · **Size:** L · **Depends on:** T-63 (built) · **Status:** later (deferred by decision until verification is green)
- **Goal:** split large files by area (`server.ts`, `orchestrator.ts`, `types/src/index.ts`, `App.tsx`) to cut file size, with no change to public API or behavior.
- **In scope:** pure structural moves into sub-modules.
- **Out of scope:** behavior changes, new features.
- **Acceptance criteria:**
  - [ ] Becomes sub-tickets T-23a and on, one per file.
  - [ ] Each split: no behavior change, public exports unchanged, full suite green before and after.
  - [ ] Each file ends at an agreed smaller size.
- **Tests:** `pnpm build` and the full test suite.
