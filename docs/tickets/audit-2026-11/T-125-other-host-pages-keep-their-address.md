# T-125: A page on another host is never mistaken for the site's own page with the same path

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | todo |

**Files you may edit (no others):**
- `packages/core/src/plan/site-graph.ts`
- `packages/core/tests/site-graph-other-host.test.ts` (new)

**Do not build in parallel with:** T-136 (also edits `site-graph.ts`).

## Problem

After "Include host", pages crawled on another host are stored with their full address
(`https://help.example.org/`, see `onOtherHost` in `plan/replan.ts`). Many maps in `plan/` are keyed by
`pathOf(page.urlPath)`, and `pathOf('https://help.example.org/')` returns `/`: the same key as the site's own
home page. The later entry overwrites the earlier one.

Scenario: the Plan has `/` (the site's home) and `https://help.example.org/`. In `buildSiteGraph`, `byPath.get('/')`
returns the other host's page, so click paths start there; in the planner the home page's title is replaced by
the other host's; later re-plans start shared-menu checks on the other host.

## Current code

`packages/core/src/plan/site-graph.ts:25-32` (branch `worktree-audit-cleanup`)

```ts
/** The path part of a page address: pages are told apart by it. */
export function pathOf(urlPath: string): string {
  try {
    return new URL(urlPath, 'http://x').pathname;
  } catch {
    return urlPath;
  }
}
```

`pathOf` is used as a map key in `site-graph.ts` (lines 76, 78, 87, 95, 96), `ai-planner.ts` (114, 119, 948, 951,
1057, 1084), `pipeline.ts` (89, 136-157, 237-248), `replan.ts` (28) and `sampling.ts` (43).

## Change

Fix the key in one place, `pathOf`, so every caller is fixed together:

```ts
/**
 * What tells one page from another. A page on the checked site is its path ("/pricing"). A page on another
 * host is stored with its full address and keeps its origin ("https://help.example.org/"), so it can never
 * take the place of the site's own page with the same path.
 */
export function pathOf(urlPath: string): string {
  try {
    if (/^https?:\/\//i.test(urlPath)) {
      const full = new URL(urlPath);
      return `${full.origin}${full.pathname}`;
    }
    return new URL(urlPath, 'http://x').pathname;
  } catch {
    return urlPath;
  }
}
```

Do not edit any caller.

## Tests

Add `packages/core/tests/site-graph-other-host.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PageInventoryItem } from '@qa/types';
import { buildSiteGraph, pathOf } from '../src/plan/site-graph.js';

const page = (urlPath: string, title: string, links: Array<{ name: string; to: string }> = []) =>
  ({ urlPath, title, links, interactiveElementsCount: 0, formsCount: 0 }) as unknown as PageInventoryItem;

describe('pathOf', () => {
  it('is the path for a page on the site', () => {
    expect(pathOf('/pricing?plan=pro#top')).toBe('/pricing');
    expect(pathOf('/')).toBe('/');
  });
  it('keeps the origin for a page on another host', () => {
    expect(pathOf('https://help.example.org/')).toBe('https://help.example.org/');
    expect(pathOf('https://help.example.org/faq?x=1')).toBe('https://help.example.org/faq');
  });
});

describe('buildSiteGraph with another host in the Plan', () => {
  it('starts click paths from the site’s own home page', () => {
    const pages = [
      page('/', 'Home', [{ name: 'Pricing', to: '/pricing' }]),
      page('/pricing', 'Pricing'),
      page('https://help.example.org/', 'Help centre', [{ name: 'FAQ', to: 'https://help.example.org/faq' }]),
      page('https://help.example.org/faq', 'FAQ'),
    ];
    const graph = buildSiteGraph(pages, '/');
    expect(graph.clickPaths.get('/')).toEqual([]);
    expect(graph.clickPaths.get('/pricing')).toEqual(['Pricing']);
  });
});
```

If `SiteGraph` exposes click paths under another name, use the property declared in the `SiteGraph` interface
at the top of `site-graph.ts`.

Commands: `pnpm exec vitest run packages/core/tests/site-graph-other-host.test.ts`, then
`pnpm exec vitest run packages/core/tests` and `pnpm build`.

## Done when

- [ ] The new tests pass
- [ ] The whole core unit tier still passes
- [ ] `pnpm build` passes

## Notes

If an existing test fails because it passes an absolute address **on the checked site itself** and expects a
bare path, stop: set the ticket to `blocked` and name the test. Do not change that test.
