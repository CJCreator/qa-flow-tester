# 0040: No Fabricated Websites; Two Test Tiers

Status: Accepted, 2026-11-04 (owner's answers in chat, 2026-11-04). Builds on REQ-046 (the `unit` and `browser` projects in `vitest.workspace.ts`). Supersedes every earlier ADR or doc passage that describes `fixtures/test-app`, `fixtures/audit-site`, the planted-defect benchmark or `pnpm fixture`. Hosting is unchanged ([0032](0032-google-cloud-only-hosting.md)).

## Context
`pnpm test` ran every file, including 122 in the `browser` project, and CI installed Chromium in every shard. Many of those files start a fabricated website (`fixtures/test-app`, `fixtures/audit-site`, or an inline `http.createServer` site, about 45 files). By their timeouts the slowest files are `url-first` (900 s); `wizard-e2e`, `runner-server` and `checkup-vs-api` (600 s each); four files at 300 s; and many at 240 s and 180 s. No per-file timings were measured. Three tests run a full `vite build`. About 17 runner tests start a site and a full Check-up only to check endpoints and persistence.

The owner wants testing focused on this product's code, not on websites made up to be scanned.

## Decision
- **Delete every fabricated website and every test that uses one**: `fixtures/test-app`, `fixtures/audit-site`, `fixtures/benchmarks`, the inline test sites, `pnpm fixture`, the planted-defect benchmark (`scripts/benchmark.ts`, `benchmark.yml`) and the wizard's "try the built-in fixture app" shortcut. The Competitive Benchmark (product feature, [0007](0007-competitive-reference-flow-benchmarking.md)) is not affected.
- **Two tiers**, selected with `--project`:
  - `unit` (`pnpm test`): no website, no browser, no Chromium. Local API sockets are allowed.
  - `browser` (`pnpm test:browser`): launches Chromium on `setContent` or `context.route().fulfill()` pages only.
  - `pnpm test:all` runs both. There is no end-to-end tier.
- Files that launch nothing (`marketing`, `marketing-review`, `seo`, `security-depth`, `spec-denial`, `orchestrator-access-wiring`) are in `unit`.
- **Pull requests and deploys test with `unit` only**, in 2 shards, with no Chromium install. `e2e-nightly.yml` runs `browser` nightly.
- **Product behaviour is checked by hand against real websites** (`docs/TESTING.md`, "Checking against real websites"). A new test must not add a fabricated website.

## Consequences
- Coverage lost, with no automated replacement: Spider crawling of a whole site, sign-in and saved sessions end to end, discovery to Plan to run, the Website Audit crawl, and the wizard end to end. A regression there is found by a person on a real site, or by a user.
- The pure logic inside those areas (frontier, safety filter, robots, Plan building, scoring, reports, endpoint behaviour with fakes) keeps its unit tests.
- The planted-defect benchmark is gone, so there is no detection rate or false-positive rate to compare across changes. A change to a checker is judged on real sites by hand.
- `pnpm test` needs no Chromium and is much faster. Browser bugs that need only a page are caught the night after merge, not on the pull request; deploys do not wait for the browser tier.
- Earlier docs and ADRs that mention the fixture app stay as history; this record overrides them.
