# T-370: robots.txt AI crawler groups keep the private paths closed

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | wizard | bug | todo |

**Files you may edit (no others):**

- `packages/wizard/public/robots.txt`
- `packages/wizard/tests/robots-txt.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

`packages/wizard/public/robots.txt` (served by the runner and by the static site) has a `*` group that closes the private screens (`:2-9`) and then one group per AI crawler, GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, PerplexityBot and Google-Extended (`:12-29`), each holding only `Allow: /$` and `Allow: /llms.txt`.

Under RFC 9309 a crawler obeys only the group that names it and ignores `*` once it has its own. Those six groups have no `Disallow` line, so for them everything is open: `/api/`, `/check`, `/reports`, `/settings` and the rest. The comment says "may read the public summary", but the file says "may read everything".

The `*` group also misses the Website Audit screens added since: `/audits` (with `/audits/new` and every audit address), `/audit-settings`, `/shortlist` and `/helper` (`lib/router.ts:48-60`). Those pages answer `noindex` in their meta tag, but a crawler that respects robots.txt should not fetch them at all.

## Current code

Branch from `main`.

`packages/wizard/public/robots.txt` (31 lines; it starts with a UTF-8 byte order mark):

```
# Release check-up: only the home page is public. Run reports, plans and settings are private.
User-agent: *
Allow: /$
Disallow: /api/
Disallow: /check
Disallow: /reports
Disallow: /baselines
Disallow: /benchmark
Disallow: /settings

# AI answer and generative engines may read the public summary.
User-agent: GPTBot
Allow: /$
Allow: /llms.txt
...
Sitemap: %ORIGIN%/sitemap.xml
```

## Change

1. Rewrite `packages/wizard/public/robots.txt` as one group that names every agent (RFC 9309 lets several `User-agent` lines share one group), without the byte order mark:

```
# Release check-up: only the home page, the sample report and llms.txt are public. Check-ups, reports, plans,
# settings and Website Audits are private. AI answer and generative engines get the same rules: a crawler obeys
# only the group that names it, so every private path is listed for them too.
User-agent: *
User-agent: GPTBot
User-agent: ChatGPT-User
User-agent: OAI-SearchBot
User-agent: ClaudeBot
User-agent: PerplexityBot
User-agent: Google-Extended
Allow: /$
Allow: /llms.txt
Allow: /sample-report.html
Disallow: /api/
Disallow: /check
Disallow: /reports
Disallow: /baselines
Disallow: /benchmark
Disallow: /settings
Disallow: /audits
Disallow: /audit-settings
Disallow: /shortlist
Disallow: /helper

Sitemap: %ORIGIN%/sitemap.xml
```

2. Do not add `/s/` (Shared Links): those pages already send `X-Robots-Tag: noindex`, and a crawler that is kept out never sees that header (ADR 0036).

## Tests

New file `packages/wizard/tests/robots-txt.test.ts` (unit). Write a small reader in the test: split into groups (consecutive `User-agent` lines start one group, a rule line ends the agent list), collect `Allow`/`Disallow` values per group, and decide a path by the longest matching rule (`$` anchors the end), `Allow` winning a tie. Then:

- `'has no byte order mark'`: the file's first character is `#`.
- `'every named AI crawler and * share the same rules'`: for `*`, `GPTBot`, `ChatGPT-User`, `OAI-SearchBot`, `ClaudeBot`, `PerplexityBot` and `Google-Extended` the rule lists are equal.
- `'the public pages are open'`: `/`, `/llms.txt` and `/sample-report.html` are allowed for every agent.
- `'every app screen is closed'`: for each value of `PATHS` in `src/lib/router.ts` except `landing` (call the function ones with `'x'` and `1`), the path is disallowed for `*` and for `GPTBot`. A new screen without a robots line fails here.
- `'/api/ is closed'`: `/api/runner/status` is disallowed.
- `'the sitemap line is kept'`: the file contains `Sitemap: %ORIGIN%/sitemap.xml`.

Run: `pnpm exec vitest run packages/wizard/tests/robots-txt.test.ts`, then `pnpm exec vitest run --project unit packages/wizard/tests`, then `pnpm build`.

## Done when

- [ ] `grep -c "^Disallow:" packages/wizard/public/robots.txt` is 10.
- [ ] `grep -c "^User-agent:" packages/wizard/public/robots.txt` is 7, all in one group.
- [ ] The new test and the wizard unit tests pass; `pnpm build` passes.

## Notes

- Audit finding L14 (part) (audit of 11 Nov 2026 on `d225418`).
- The tool's own robots reader (`packages/checkers/src/site-root.ts`) reads several `User-agent` lines as one group; T-344 fixes its handling of blank lines and is not needed for this file.
- `robots.txt` keeps its `%ORIGIN%` placeholder; T-366 fills it on the static site.
