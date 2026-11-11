# T-276: The manual deploy script allows the same origins as CI and verifies the commit

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | infra | inconsistency | todo |

**Files you may edit (no others):**

- `scripts/deploy-cloud-run.mjs`
- `docs/adr/0039-cloud-scheduler-owner-schedules.md` (line 30 only)

**Do not build in parallel with:** nothing. (`.github/workflows/deploy.yml` is NOT edited under the default below. If the owner picks option B, see Notes.)

## Problem

`pnpm deploy:cloud` (`scripts/deploy-cloud-run.mjs`) and the CI deploy (`.github/workflows/deploy.yml`) deploy the same service but differ:

1. **Allowed origins.** The script sets `RUNNER_ALLOWED_ORIGINS` to three origins: the runner URL, its hash URL and the static site URL. CI sets two: `$RUNNER_URL` and the hash URL. Whoever deploys last decides which origins the runner accepts, and which URLs are accepted as the Cloud Scheduler token audience.
2. **Site check.** CI's "Verify the site serves this commit" step needs `version.json` to hold this commit's SHA. The script accepts any `version.json` that has a `commit` field, so an old image passes. Run locally, `site-build` also stamps `commit` as `unknown`, because `GITHUB_SHA` is not set. Also, when either check fails the script only prints a warning and exits 0.

## Owner decision needed

Which origin list is right?

- **A. Three origins everywhere** (add `$SITE_URL` to CI). Needed only if the static site's pages call the runner from the browser. `packages/wizard/src/lib/onlineUrl.ts` uses `VITE_ONLINE_APP_URL` for links to the online copy, and no site code was found that calls the runner API. Two tests pin CI to exactly two origins (`packages/runner/tests/deploy-audit-store.test.ts` line 93 and `deploy-scheduler.test.ts` line 51) and would have to change.
- **B. Two origins everywhere** (drop `SITE_URL` from the script). Matches what CI has deployed so far and the two tests. Smaller trust surface.

**Recommended default: B.** The Change below is written for B.

## Current code

Branch from `main`. `grep -n "allowedOrigins\|const sha\|site-build\|json.commit\|console.warn" scripts/deploy-cloud-run.mjs`.

```js
const sha = capture('git rev-parse --short HEAD') || 'manual';
```

```js
sh('pnpm run site-build', { env: { ...process.env, VITE_ONLINE_APP_URL: RUNNER_URL } });
```

```js
// Using '^#^' as separator: '#' allows origins containing commas and emails containing '@'
const allowedOrigins = process.env.RUNNER_ALLOWED_ORIGINS || [RUNNER_URL, RUNNER_HASH_URL, SITE_URL].join(',');
```

```js
    if (!runnerOk && !isDryRun) {
      console.warn('⚠️ Runner endpoint did not respond with expected status within timeout.');
    }
  }

  if (deploySite) {
    const siteOk = await verifyEndpoint(`${SITE_URL}/version.json`, (status, text) => {
      try {
        const json = JSON.parse(text);
        return status === 200 && json.commit !== undefined;
      } catch {
        return status === 200;
      }
    });
    if (!siteOk && !isDryRun) {
      console.warn('⚠️ Site endpoint did not serve version.json within timeout.');
    }
  }
```

`docs/adr/0039-cloud-scheduler-owner-schedules.md` line 30:

```
- The OIDC audience reuses `RUNNER_ALLOWED_ORIGINS`, so the static-site origin is also an accepted audience. This is harmless: only tokens minted for the configured service account pass.
```

## Change

1. Line after `const sha = ...`: add `const fullSha = capture('git rev-parse HEAD') || '';`.
2. Site build line becomes:

```js
sh('pnpm run site-build', {
  env: { ...process.env, VITE_ONLINE_APP_URL: RUNNER_URL, ...(fullSha ? { GITHUB_SHA: fullSha } : {}) },
});
```

3. The origins line becomes (and the comment above it keeps its text):

```js
const allowedOrigins = process.env.RUNNER_ALLOWED_ORIGINS || [RUNNER_URL, RUNNER_HASH_URL].join(',');
```

4. The site check callback becomes (this matches CI: the commit must be this one; if git gave no SHA, any commit passes):

```js
const siteOk = await verifyEndpoint(`${SITE_URL}/version.json`, (status, text) => {
  try {
    const json = JSON.parse(text);
    return status === 200 && (fullSha ? json.commit === fullSha : json.commit !== undefined);
  } catch {
    return false;
  }
});
```

5. A failed check fails the script. Replace the two `console.warn(...)` blocks with:

```js
if (!runnerOk && !isDryRun) {
  console.error('Runner endpoint did not respond with the expected status within the timeout.');
  process.exit(1);
}
```

```js
if (!siteOk && !isDryRun) {
  console.error('Site endpoint did not serve version.json for this commit within the timeout.');
  process.exit(1);
}
```

6. After step 3 `SITE_URL` is still used (verify and the summary lines), so keep the constant.
7. `docs/adr/0039-...md` line 30: replace with `- The OIDC audience reuses `RUNNER_ALLOWED_ORIGINS`: it is the runner's own URL, which the deploy lists. Only tokens minted for the configured service account pass.`
8. Run `pnpm exec prettier --write scripts/deploy-cloud-run.mjs docs/adr/0039-cloud-scheduler-owner-schedules.md`.

## Tests

- `node scripts/deploy-cloud-run.mjs --dry-run --service=site` must print the planned commands and exit 0 (dry run skips network checks). It needs `gcloud` installed for the auth check; if it is not installed, say so in your notes and run `node --check scripts/deploy-cloud-run.mjs` instead.
- `pnpm exec vitest run packages/runner/tests/deploy-scheduler.test.ts packages/runner/tests/deploy-audit-store.test.ts` (the ADR header test reads the 0039 file; the other test reads `deploy.yml`, which is unchanged).

## Done when

- [ ] `grep -c "SITE_URL\]" scripts/deploy-cloud-run.mjs` prints 0 (no `SITE_URL` in the origin list).
- [ ] `grep -c "json.commit === fullSha" scripts/deploy-cloud-run.mjs` prints 1.
- [ ] `grep -c "console.warn" scripts/deploy-cloud-run.mjs` prints 0.
- [ ] `node --check scripts/deploy-cloud-run.mjs` passes, and the two tests pass.

## Notes

- If the owner picks option A instead: add `,$SITE_URL` after `$RUNNER_URL` in `deploy.yml`'s `RUNNER_ALLOWED_ORIGINS`, update the two pinned tests to expect three origins, keep the script's three, and leave the ADR line alone. That is a different set of files; write it as a new ticket.
- Do not change `.github/workflows/deploy.yml` in this ticket.
