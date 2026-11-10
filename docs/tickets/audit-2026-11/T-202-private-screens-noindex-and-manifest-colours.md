# T-202: Private screens say noindex in the page too, and the web manifest uses the current colours

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | inconsistency | built |

**Files you may edit (no others):**
- `packages/wizard/src/lib/title.ts`
- `packages/wizard/public/manifest.webmanifest`
- `packages/wizard/tests/title-robots.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

1. `useDocumentTitle` sets `<meta name="robots">` to `index, follow` for six screen titles. Five of them are private screens: `public/robots.txt` disallows `/check`, `/reports`, `/baselines`, `/benchmark`, `/settings` ("only the home page is public"), and the runner sends `X-Robots-Tag: noindex` for every path except the home page and the sample report. The page's own tag contradicts both.
2. `public/manifest.webmanifest` still has the retired dark colour `#111827` for `background_color` and `theme_color`. `index.html:6` uses `#F4F6F4` (the `paper` colour of the Certificate palette, `tailwind.config.js`).

## Current code

`packages/wizard/src/lib/title.ts:25-32` (branch `worktree-audit-cleanup`)

```ts
const PUBLIC_TITLES = new Set([
  LANDING_TITLE,
  'New check-up',
  'Past check-ups',
  'Visual Baselines',
  'Compare with another site',
  'Get started',
]);
```

`title.ts:43-44`

```ts
    const isHome = title === LANDING_TITLE;
    const isPublic = isHome || PUBLIC_TITLES.has(title);
```

`packages/wizard/public/manifest.webmanifest:7-8`

```json
  "background_color": "#111827",
  "theme_color": "#111827",
```

## Change

1. `title.ts`: replace the `PUBLIC_TITLES` declaration with an exported helper:

```ts
/** Only the landing page may be indexed: robots.txt and the runner's X-Robots-Tag say the same. */
export function isPublicTitle(title: string): boolean {
  return title === LANDING_TITLE;
}
```

2. `title.ts` line 44: replace with

```ts
    const isPublic = isPublicTitle(title);
```

   Keep the `isHome` line; it is still used for the title and description.
3. `manifest.webmanifest`: set both colours to `#F4F6F4`:

```json
  "background_color": "#F4F6F4",
  "theme_color": "#F4F6F4",
```

   The file starts with a byte-order mark; keep the rest of the file byte for byte.

## Tests

New file `packages/wizard/tests/title-robots.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPublicTitle } from '../src/lib/title';

describe('which screens may be indexed', () => {
  it.each(['New check-up', 'Past check-ups', 'Visual Baselines', 'Compare with another site', 'Get started', 'Settings'])(
    '%s is private',
    (title) => {
      expect(isPublicTitle(title)).toBe(false);
    }
  );
  it('the manifest uses the page background colour of index.html', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, '../public/manifest.webmanifest'), 'utf8').replace(/^﻿/, '')
    ) as { background_color: string; theme_color: string };
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(html).toContain(`content="${manifest.theme_color}"`);
    expect(manifest.background_color).toBe('#F4F6F4');
    expect(manifest.theme_color).toBe('#F4F6F4');
  });
});
```

If `LANDING_TITLE` is exported from `title.ts`, also add: `expect(isPublicTitle(LANDING_TITLE)).toBe(true);` (import it). If it is not exported, skip that line; do not export it for the test.

Run: `pnpm exec vitest run packages/wizard/tests/title-robots.test.ts packages/wizard/tests/share-image.test.ts packages/wizard/tests/landing-audit.test.tsx` then `pnpm build`.

## Done when

- [ ] Only the landing page gets `index, follow`; every other screen gets `noindex, nofollow`.
- [ ] The manifest colours are `#F4F6F4`.
- [ ] Tests and `pnpm build` pass.

## Notes

- Out of scope, needs design sign-off: `public/favicon.svg` and the share image still use the old dark palette.
- Do not edit `public/robots.txt` or `index.html`.
