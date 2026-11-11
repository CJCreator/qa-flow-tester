# T-306: Docs fetch strips HTML in linear time

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/discovery/docs-fetch.ts`
- `packages/core/tests/docs-fetch-hostile-html.test.ts` (new)

**Do not build in parallel with:** T-240, T-241, T-332 (all edit `docs-fetch.ts`).

## Problem

When a Check-up is given a docs address, the runner reads up to 20 pages of 1 MB each (`fetchDocsPages`, called from `packages/runner/src/session/checkup-run.ts:783`) and turns each page into text with `htmlToDoc`. On the hosted copy any visitor can give any public docs address. The page is the visitor's choice.

`htmlToDoc` (`packages/core/src/discovery/docs-fetch.ts:127-148`) and `linksOf` (`docs-fetch.ts:150-166`) use regular expressions that rescan to the end of the page from every unclosed start: comments (`/<!--[\s\S]*?-->/g`, line 128), script and style blocks (line 128), headings (line 129), list items (line 137), every tag (`/<[^>]*>/g`, lines 131 and 140) and links (line 152). The cost grows with the square of the page size. Measured on Node with the same expressions: 100 KB of `<!--` takes 3 s, 100 KB of `<` takes 25 s, 100 KB of `<a x` takes 5 s. A 1 MB page is about 100 times slower: from 5 minutes to over 40 minutes. The runner is one Node process, so every Check-up, the event stream and the wizard stop while it runs.

## Current code

Branch from `main`. Build this after T-241, which replaces `decodeEntities` in the same file.

`packages/core/src/discovery/docs-fetch.ts` (`grep -n "export function htmlToDoc" packages/core/src/discovery/docs-fetch.ts`):

```ts
export function htmlToDoc(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, level: string, inner: string) => {
    const text = inner
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? `\n${'#'.repeat(Number(level))} ${text}\n` : '\n';
  });
  s = s
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|ul|ol|table|tr|pre|blockquote)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  ...
```

`grep -n "function linksOf" packages/core/src/discovery/docs-fetch.ts`:

```ts
function linksOf(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
```

## Change

1. In `docs-fetch.ts`, above `htmlToDoc`, add a one-pass tokenizer that uses only `indexOf`, `startsWith` and short anchored matches on small slices:

```ts
type HtmlToken = { kind: 'text'; text: string } | { kind: 'tag'; name: string; closing: boolean; raw: string };

/** Elements whose content is never page text. */
const HIDDEN_CONTENT = new Set(['script', 'style', 'noscript', 'svg', 'head']);

/**
 * Splits HTML into text and tags in one pass: every scan moves forward, so the cost grows with the page size,
 * not its square. Comments and hidden elements are dropped. Like a browser, an unclosed comment or hidden
 * element hides the rest of the page, and a `<` with no `>` after it is text.
 */
function htmlTokens(html: string): HtmlToken[] {
  const out: HtmlToken[] = [];
  const lower = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out.push({ kind: 'text', text: html.slice(i) });
      break;
    }
    if (lt > i) out.push({ kind: 'text', text: html.slice(i, lt) });
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end < 0) break;
      out.push({ kind: 'text', text: ' ' });
      i = end + 3;
      continue;
    }
    const start = /^<(\/?)([a-z][a-z0-9-]*)/i.exec(html.slice(lt, lt + 64));
    if (!start) {
      out.push({ kind: 'text', text: '<' });
      i = lt + 1;
      continue;
    }
    const gt = html.indexOf('>', lt + 1);
    if (gt < 0) {
      out.push({ kind: 'text', text: html.slice(lt) });
      break;
    }
    const name = start[2].toLowerCase();
    const closing = start[1] === '/';
    const raw = html.slice(lt, gt + 1);
    i = gt + 1;
    if (!closing && HIDDEN_CONTENT.has(name) && !raw.endsWith('/>')) {
      const close = lower.indexOf(`</${name}`, i);
      if (close < 0) break;
      const closeEnd = html.indexOf('>', close);
      if (closeEnd < 0) break;
      out.push({ kind: 'text', text: ' ' });
      i = closeEnd + 1;
      continue;
    }
    out.push({ kind: 'tag', name, closing, raw });
  }
  return out;
}
```

2. Rewrite `htmlToDoc` to walk `htmlTokens(html)` and build the same output as today:
   - Text outside a heading is added as it is.
   - An opening `h1`..`h6` (when no heading is open) starts collecting heading text. Inside a heading every tag adds `' '`. The closing tag of the same level ends it: collapse whitespace, trim, and add `\n${'#'.repeat(level)} ${text}\n`, or `'\n'` when empty. A heading still open at the end is added as plain text.
   - Outside a heading: opening `li` adds `'\n- '`; closing `p`, `div`, `section`, `article`, `ul`, `ol`, `table`, `tr`, `pre`, `blockquote` adds `'\n'`; `br` adds `'\n'`; every other tag adds `' '`.
   - Keep the `decodeEntities` call and the line clean-up at the end unchanged.

3. Rewrite `linksOf` to walk `htmlTokens(html)`: for each opening `a` tag, run `/\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(token.raw)` on that one tag (not the page), and keep the rest of the loop body (decode, skip `#`/`mailto:`/`tel:`/`javascript:`, resolve against `base`, drop the hash).

4. No other regex in the file may scan the whole page from many start points. `decodeEntities` (as T-241 leaves it) only starts at `&` and stops at the first character outside its class: it stays.

5. Run `pnpm exec prettier --write packages/core/src/discovery/docs-fetch.ts packages/core/tests/docs-fetch-hostile-html.test.ts`, then `pnpm build`.

## Tests

New file `packages/core/tests/docs-fetch-hostile-html.test.ts` (unit tier, no browser, no server):

- `it.each` over 1 MB hostile pages: `'<!--'.repeat(262_144)`, `'<script'.repeat(150_000)`, `'<'.repeat(1_048_576)`, `'<h1>'.repeat(262_144)`, `'<li'.repeat(350_000)`, `'<a x'.repeat(262_144)`. For each, time `htmlToDoc(page)`; assert it returns in under 2000 ms. (Today each takes minutes.)
- "links are found in one pass": `fetchDocsPages('https://docs.example/start', { get, robots: RobotsPolicy.allowAll() })` (`RobotsPolicy` from `../src/competitive/robots.js`) with a fake `get` (the `DocsGet` option) that answers the start page with `'<a x'.repeat(250_000) + '<a href="/next">n</a>'` (just under the 1 MB page limit; `contentType: 'text/html'`, `status: 200`, `finalUrl` = the asked URL) and `/next` with a small page. Assert it returns in under 3000 ms and `docs` names include `https://docs.example/next`.
- Same output as today on normal pages (values taken from the current code):
  - `htmlToDoc('<h2>Plans <small>new</small></h2><p>One</p><ul><li>A</li><li>B</li></ul>')` is `'## Plans new\nOne\n\n- A\n- B'`.
  - `htmlToDoc('<p>a<!-- hidden -->b</p><script>x()</script><p>c</p>')` is `'a b\nc'`.
  - `htmlToDoc('<p>1 < 2</p>')` is `'1 < 2'`.
  - `htmlToDoc('<header>Top</header><p>Body</p>')` is `'Top Body'` (`<header>` is not `<head>`).
  - `htmlToDoc('<h1>Title</h1><p>One</p><p>Two</p>')` is `'# Title\nOne\nTwo'`.
- One intended change: an unclosed comment hides the rest, as in a browser. `htmlToDoc('<p>shown</p><!-- <p>not shown</p>')` is `'shown'` (today: `'shown\nnot shown'`).

The existing `packages/core/tests/docs-fetch.test.ts` must pass unchanged.

Run: `pnpm exec vitest run packages/core/tests/docs-fetch-hostile-html.test.ts packages/core/tests/docs-fetch.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -nF '[\s\S]' packages/core/src/discovery/docs-fetch.ts` prints nothing (no lazy scan over the page).
- [ ] `grep -nF '<[^>]*>' packages/core/src/discovery/docs-fetch.ts` prints nothing.
- [ ] `grep -n "function htmlTokens" packages/core/src/discovery/docs-fetch.ts` finds the tokenizer, and `htmlToDoc` and `linksOf` both use it.
- [ ] The new test and `docs-fetch.test.ts` pass; `pnpm build` passes.

## Notes

- Audit finding H5 (audit of 11 Nov 2026 on `d225418`). The audit named the comment and script expressions; the tag, heading, list-item and link expressions have the same problem and are covered here.
- Builds after T-241 (same file: `decodeEntities`). T-240 also edits this file (robots token). T-332 builds after this ticket (the page count in `fetchDocsPages`).
- Behaviour changes to expect: links inside comments and scripts are no longer followed, an unclosed comment or script hides the rest of the page, and `<svg ... />` no longer hides the text after it. All three match what a browser shows.
- Not in this ticket: `docx-to-markdown.ts` and `audit/preview/sanitize.ts` have their own HTML handling.
