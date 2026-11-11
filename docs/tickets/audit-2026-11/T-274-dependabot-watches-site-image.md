# T-274: Dependabot watches the site image

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | ci | gap | todo |

**Files you may edit (no others):**

- `.github/dependabot.yml`

**Do not build in parallel with:** nothing. (T-225 pins actions to commit SHAs and relies on the `github-actions` entry already in this file; this ticket does not change that entry.)

## Problem

The `docker` ecosystem in `.github/dependabot.yml` watches only `/packages/runner`. `site/Dockerfile` (`FROM nginxinc/nginx-unprivileged:1.27-alpine`) is public-facing and is never checked for a new base image.

## Current code

Branch from `main`. The `github-actions` ecosystem (directory `/`, weekly) is already there, so nothing is missing for T-225. The end of the file:

```yaml
- package-ecosystem: docker
  directory: /packages/runner
  schedule:
    interval: weekly
  commit-message:
    prefix: 'chore(docker)'
  ignore:
    - dependency-name: 'mcr.microsoft.com/playwright'
```

## Change

Append this entry at the end of the file, at the same indentation (two spaces before `- package-ecosystem`):

```yaml
- package-ecosystem: docker
  directory: /site
  schedule:
    interval: weekly
  commit-message:
    prefix: 'chore(docker)'
```

Do not add the `ignore` block: the site image does not use the Playwright image.

## Tests

`pnpm exec prettier --check .github/dependabot.yml`. No unit test reads this file (`grep -rn "dependabot" packages/*/tests` finds nothing).

## Done when

- [ ] `grep -c "package-ecosystem: docker" .github/dependabot.yml` prints 2.
- [ ] `grep -n "directory: /site" .github/dependabot.yml` prints one line.
- [ ] `grep -c "package-ecosystem: github-actions" .github/dependabot.yml` still prints 1.
- [ ] Prettier check passes.

## Notes

- After the pull request merges, the repository's Insights > Dependency graph > Dependabot page should list `/site` without an error.
