# T-146: Seven technology markers can never match, and two that are read are never used

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core/audit | inconsistency | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/analysis/read-page.ts`
- `packages/core/src/audit/analysis/technology.ts`
- `packages/core/tests/audit-technology.test.ts`

**Do not build in parallel with:** T-147 (same test file).

## Problem

Technology detection matches `marker('...')` signatures against the marker names that `readDom` (in `read-page.ts`) collects from the page. The two lists do not line up:

- Signatures that `readDom` never emits, so they can never match: `data-wf-page`, `data-drupal-selector`, `_reactRootContainer`, `__reactContainer`, `next-route-announcer`, `__NUXT__`, `__NUXT_DATA__`.
- Markers that `readDom` emits but no signature uses: `__next`, `__nuxt`.

Scenario: a Nuxt 3 site (which has `<div id="__nuxt">` and `<script id="__NUXT_DATA__">`) with no `data-v-app` attribute is reported as "not identified".

## Current code

`packages/core/src/audit/analysis/read-page.ts:352` (branch `worktree-audit-cleanup`), inside `readDom`

```ts
  const MARKERS: Array<[string, string]> = [
    ['#__NEXT_DATA__', '__NEXT_DATA__'],
    ['#__next', '__next'],
    ['[ng-version]', 'ng-version'],
    ['astro-island', 'astro-island'],
    ['[data-wf-site]', 'data-wf-site'],
    ['#__nuxt', '__nuxt'],
    ['[data-v-app]', 'data-v-app'],
    ['[data-server-rendered]', 'data-server-rendered'],
    ['#___gatsby', '___gatsby'],
    ['[data-reactroot]', 'data-reactroot'],
  ];
```

`packages/core/src/audit/analysis/technology.ts` (inside `SIGNATURES`)

```ts
  Webflow: [
    gen(/^webflow\b/i),
    marker('data-wf-site'),
    marker('data-wf-page'),
    ...
  Drupal: [
    ...
    marker('data-drupal-selector'),
    ...
  React: [
    marker('data-reactroot'),
    marker('_reactRootContainer'),
    marker('__reactContainer'),
    path('/react.production.min.js'),
    path('/react-dom.production.min.js'),
  ],
  'Next.js': [
    gen(/^next\.js\b/i),
    marker('__NEXT_DATA__'),
    marker('next-route-announcer'),
    path('/_next/static/'),
    ...
  'Vue/Nuxt': [
    gen(/^nuxt\b/i),
    marker('__NUXT__'),
    marker('__NUXT_DATA__'),
    marker('data-v-app'),
    marker('data-server-rendered'),
    ...
```

The first item of each `MARKERS` pair is a CSS selector run with `document.querySelector`; the second is the marker name.

## Change

1. `read-page.ts`: add four pairs to `MARKERS` (keep the existing ten):

```ts
    ['[data-wf-page]', 'data-wf-page'],
    ['[data-drupal-selector]', 'data-drupal-selector'],
    ['next-route-announcer', 'next-route-announcer'],
    ['#__NUXT_DATA__', '__NUXT_DATA__'],
```

2. `technology.ts`, `React`: delete the two lines `marker('_reactRootContainer'),` and `marker('__reactContainer'),` (they are JavaScript properties on a DOM node, not something a selector can find).

3. `technology.ts`, `'Next.js'`: add `marker('__next'),` after `marker('__NEXT_DATA__'),`.

4. `technology.ts`, `'Vue/Nuxt'`: delete `marker('__NUXT__'),` (a `window` global, not in the DOM) and add `marker('__nuxt'),` after `marker('__NUXT_DATA__'),`.

## Tests

Edit `packages/core/tests/audit-technology.test.ts`. The test `'technology: every one of the TECHNOLOGIES has at least one tested signature'` (about line 119) keeps a table of signatures per technology: remove any row that uses `_reactRootContainer`, `__reactContainer` or `__NUXT__`, and add rows for `__next` (Next.js) and `__nuxt` (Vue/Nuxt). Copy the shape of the neighbouring marker rows.

Add `'technology: every marker signature is a marker the page reader can emit'`: read the file `packages/core/src/audit/analysis/read-page.ts` as text, collect every second string of the `MARKERS` pairs with a regular expression (`/\['[^']+', '([^']+)'\]/g`), then read `technology.ts` as text and collect every `marker('...')` name (`/marker\('([^']+)'\)/g`). Expect every `marker(...)` name to be in the first set, and every name in the first set to be used by at least one `marker(...)`.

Run: `pnpm exec vitest run packages/core/tests/audit-technology.test.ts packages/core/tests/audit-page-content.test.ts`, then `pnpm build`.

## Done when

- [ ] Every `marker(...)` name in `technology.ts` is emitted by `readDom`, and the reverse.
- [ ] Tests and `pnpm build` pass.

## Notes

- `readDom` runs inside the browser page (`page.evaluate`): it must not reference anything outside its own body. Only add array entries.
- Response-header signatures are a separate ticket (T-147).
