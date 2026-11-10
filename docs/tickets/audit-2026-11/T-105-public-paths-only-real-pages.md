# T-105: Only real public pages are indexable

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | runner | bug | todo |

**Files you may edit (no others):**
- `packages/runner/src/ui-static.ts`
- `packages/runner/tests/seo-static.test.ts`

**Do not build in parallel with:** none.

## Problem

Commit `df1a17f` added `/docs`, `/changelog` and `/case-studies` to `PUBLIC_PATHS`. The wizard has no such screens: its router shows "Page not found" for them. Paths in `PUBLIC_PATHS` are served without `X-Robots-Tag: noindex`.

Scenario: a search engine requests `/docs`. It gets HTTP 200, a "Page not found" screen and no `noindex`: an indexable soft-404 on the public site.

## Current code

`packages/runner/src/ui-static.ts:67-68` (branch `worktree-audit-cleanup`)

```ts
/** Private screens (runs, plans, settings): kept out of search and AI indexes. Public marketing, docs, and report pages are indexed. */
const PUBLIC_PATHS = new Set(['/', '/index.html', '/sample-report.html', '/docs', '/changelog', '/case-studies']);
```

Used at line 95:

```ts
  if ((ext === '' || ext === '.html') && !PUBLIC_PATHS.has(pathname.replace(/\/+$/, '') || '/')) {
```

## Change

Replace the two lines with:

```ts
/**
 * Private screens (runs, plans, settings): kept out of search and AI indexes. Only pages that exist are
 * public: the landing page and the sample report. Add a path here only when the wizard has a screen for it.
 */
const PUBLIC_PATHS = new Set(['/', '/index.html', '/sample-report.html']);
```

## Tests

Edit `packages/runner/tests/seo-static.test.ts`. Copy the setup of an existing test there that requests a private screen and expects `X-Robots-Tag` to contain `noindex`.

Add `'paths with no wizard screen are not indexable'`: for each of `/docs`, `/changelog`, `/case-studies`, request it the same way and expect the `x-robots-tag` response header to contain `noindex`.

Keep the existing expectations for `/` and `/sample-report.html` (no `noindex`).

Run: `pnpm exec vitest run packages/runner/tests/seo-static.test.ts`, then `pnpm build`.

## Done when

- [ ] `PUBLIC_PATHS` holds exactly `/`, `/index.html`, `/sample-report.html`.
- [ ] `/docs`, `/changelog`, `/case-studies` answer with `noindex`.
- [ ] The test file and `pnpm build` pass.

## Notes

- Out of scope: `robots.txt` and `sitemap.xml` in `packages/wizard/public`. Check they do not list the three paths: `grep -n "docs\|changelog\|case-studies" packages/wizard/public/robots.txt packages/wizard/public/sitemap.xml`. If they do, say so in your notes; do not edit them here.
