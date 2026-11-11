# T-366: The static site build replaces the `%ORIGIN%` placeholders

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | infra | bug | todo |

**Files you may edit (no others):**

- `scripts/site-output.mjs`
- `scripts/deploy-cloud-run.mjs`
- `packages/wizard/public/sample-report.html`
- `packages/runner/tests/site-output.test.ts` (new)

**Do not build in parallel with:** T-276 (edits `deploy-cloud-run.mjs`).

## Problem

The wizard's public files hold a `%ORIGIN%` placeholder wherever an absolute address is needed: 14 lines of `packages/wizard/index.html` (canonical `:16`, `og:url` `:23`, `og:image` `:29`, `twitter:image` `:40`, and the JSON-LD ids and urls `:48-81`), `public/sitemap.xml` (2), `public/robots.txt` (1) and `public/llms.txt` (3).

Only the runner fills them in, per request (`packages/runner/src/ui-static.ts:65`, `TEMPLATED` = `.html .txt .xml .webmanifest`; `:160` and `:181` `replaceAll('%ORIGIN%', publicOrigin(req))`). The static site on Cloud Run is a plain copy: `scripts/site-output.mjs:18-19` copies `packages/wizard/dist` to `./public`, `site/Dockerfile:5` copies that into nginx, and nginx has no substitution (`site/nginx.conf`, no `sub_filter`). So the public landing page that search engines and link previews read sends `<link rel="canonical" href="%ORIGIN%/">`, an `og:image` of `%ORIGIN%/og-image.png` (no preview image when the link is shared), JSON-LD with `"url": "%ORIGIN%/"`, `Sitemap: %ORIGIN%/sitemap.xml` in robots.txt and a sitemap whose `<loc>` values are not addresses. `lib/title.ts:60-67` fixes canonical and `og:url` in the browser after the script runs, which crawlers that do not run scripts and every link-preview fetcher never see; nothing fixes the rest.

Separately, `public/sample-report.html:11` sets `og:image` to the relative `/favicon.svg` with `twitter:card` `summary_large_image` (`:12`): previews need an absolute address and a raster image.

## Current code

Branch from `main`.

`scripts/site-output.mjs:14-22`:

```js
if (!existsSync(path.join(from, 'index.html'))) {
  console.error(`The wizard was not built: ${from} has no index.html.`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
// The deploy's verify step reads this to confirm the site serves the commit it was built from.
writeFileSync(path.join(to, 'version.json'), JSON.stringify({ commit: process.env.GITHUB_SHA || 'unknown' }) + '\n');
```

`.github/workflows/deploy.yml:42` sets `SITE_URL: https://qa-check-up-site-809804736896.us-central1.run.app` at workflow level, so the "Build the site" step (`deploy.yml:72-75`, `pnpm run site-build`) already has it. `scripts/deploy-cloud-run.mjs:8` has the same `SITE_URL` constant and runs `sh('pnpm run site-build', { env: { ...process.env, VITE_ONLINE_APP_URL: RUNNER_URL } })` (`:82`).

`grep -n "og:image\|twitter" packages/wizard/public/sample-report.html`:

```html
  <meta property="og:image" content="/favicon.svg">
  <meta name="twitter:card" content="summary_large_image">
```

## Change

1. `scripts/site-output.mjs`: keep it a script, but export pure parts and run only when called directly (the pattern of `scripts/check-playwright-version.mjs`: `if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();`).
   - `export const TEMPLATED = new Set(['.html', '.txt', '.xml', '.webmanifest']);` (the same list as `ui-static.ts:65`; a comment says to keep them in step).
   - `export function siteOrigin(raw)`: trim, drop trailing slashes, accept only `^https?:\/\/[\w.-]+(:\d+)?$` (the rule of `publicOrigin` in `ui-static.ts:79-80`), else `null`.
   - `export function fillOrigin(dir, origin)`: walk `dir` recursively; for each file whose extension is in `TEMPLATED` and whose text contains `%ORIGIN%`, write it back with `replaceAll('%ORIGIN%', origin)`. Return the number of files changed.
   - `main()`: today's steps, then `const origin = siteOrigin(process.env.SITE_URL)`. With an origin: `fillOrigin(to, origin)` and log the count. Without one: `console.warn('SITE_URL is not set or not an http(s) origin: %ORIGIN% is left in ./public. Set it for a deploy.')` and go on (CI's `tests.yml` and `release.yml` build the site without deploying it).
2. `scripts/deploy-cloud-run.mjs:82`: pass `SITE_URL` too: `env: { ...process.env, VITE_ONLINE_APP_URL: RUNNER_URL, SITE_URL }`.
3. `packages/wizard/public/sample-report.html`: `og:image` becomes `%ORIGIN%/og-image.png` and add `<meta name="twitter:image" content="%ORIGIN%/og-image.png">` after the twitter description. The runner fills it per request (`.html` is templated) and the site build fills it from `SITE_URL`.
4. `deploy.yml` is not edited: the workflow-level `SITE_URL` reaches the step.
5. `pnpm exec prettier --write` on the changed `.mjs` files.

## Tests

New file `packages/runner/tests/site-output.test.ts` (unit; import the script as `../../../scripts/site-output.mjs` with `// @ts-expect-error plain .mjs script without type declarations`, like `playwright-version-check.test.ts`):

- `'does nothing on import'`: importing does not create or remove `./public` (check `process.exitCode` is unchanged, as that test does).
- `'siteOrigin accepts an http(s) origin and trims the slash'`: `'https://site.example/'` gives `'https://site.example'`; `undefined`, `''`, `'site.example'`, `'https://site.example/path'`, `'javascript:x'` give `null`.
- `'fillOrigin replaces the placeholder in templated files only'`: in a temp dir write `index.html` (`<link rel="canonical" href="%ORIGIN%/">`), `robots.txt`, `sitemap.xml`, `assets/app.js` (also holding `%ORIGIN%`) and `og-image.png` (bytes); after `fillOrigin(dir, 'https://site.example')` the first three hold `https://site.example/` and no `%ORIGIN%`; `app.js` and the PNG are byte-for-byte unchanged; the return value is 3.
- `'the wizard has no placeholder outside templated files'`: walk `packages/wizard/public` and `packages/wizard/index.html`; every file containing `%ORIGIN%` has a `TEMPLATED` extension.
- `'the sample report preview image is absolute'`: `packages/wizard/public/sample-report.html` contains `content="%ORIGIN%/og-image.png"` and no `content="/favicon.svg"`.

Run: `pnpm exec vitest run packages/runner/tests/site-output.test.ts packages/wizard/tests/sample-report-format.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build` and `SITE_URL=https://site.example pnpm run site-build` (then `grep -rl "%ORIGIN%" public` finds nothing; delete `./public` afterwards, it is generated output).

## Done when

- [ ] `grep -n "fillOrigin" scripts/site-output.mjs` finds the export and its call.
- [ ] After `SITE_URL=https://site.example pnpm run site-build`, `grep -rl "%ORIGIN%" public` finds nothing.
- [ ] The new test passes; `pnpm build` passes.
- [ ] After the next deploy (a human check): `curl -s $SITE_URL/ | grep canonical` shows the site address.

## Notes

- Audit finding M45 (audit of 11 Nov 2026 on `d225418`).
- `scripts/deploy-cloud-run.mjs` is also edited by T-276. The change here is one `env` key at `:82`; build after T-276 or merge by hand.
- `packages/wizard/public/og-image.png` is regenerated by T-288; the path stays the same, so the two do not clash.
- The site's CSP and HSTS are T-304 and T-273 (`site/nginx.conf`); not touched here.
- `lib/title.ts` keeps its runtime canonical fix: it is still right for app screens on any host.
