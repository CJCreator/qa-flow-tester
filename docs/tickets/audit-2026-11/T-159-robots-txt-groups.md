# T-159: robots.txt parser reads groups wrongly and reports AI crawlers as blocked

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | built |

**Files you may edit (no others):**
- `packages/checkers/src/site-root.ts`
- `packages/checkers/tests/seo.test.ts`

**Do not build in parallel with:** T-179 (same source file), T-160, T-161, T-169, T-170, T-178 (same test file).

## Problem
The robots.txt parser in `SiteRootAuditor.audit` starts a new group only at a blank line, and a wildcard `Disallow: /` adds four AI crawlers even when they have a group of their own.

Two wrong results:
1. No blank line between groups. `User-agent: *` / `Disallow: /admin` / `User-agent: GPTBot` / `Disallow: /` is read as one group holding `*` and `GPTBot`, so `wildcardDisallowAll` becomes true and GPTBot, ClaudeBot, PerplexityBot and Google-Extended are all reported blocked. Only GPTBot is.
2. A crawler with its own group is still added. `User-agent: GPTBot` / `Allow: /` then a blank line then `User-agent: *` / `Disallow: /` reports GPTBot as blocked. GPTBot's own group wins over `*`, so it is allowed.

## Current code
`packages/checkers/src/site-root.ts:69-115` (branch `worktree-audit-cleanup`)
```ts
        // Parse robots.txt for AI bots and Sitemaps
        const lines = robotsTxtContent.split('\n');
        let currentUserAgents: string[] = [];
        let wildcardDisallowAll = false;

        for (const rawLine of lines) {
          const line = rawLine.split('#')[0].trim();
          if (!line) {
            currentUserAgents = [];
            continue;
          }

          const uaMatch = line.match(/^User-agent:\s*(.+)$/i);
          if (uaMatch) {
            currentUserAgents.push(uaMatch[1].trim());
            continue;
          }

          const sitemapMatch = line.match(/^Sitemap:\s*(.+)$/i);
          if (sitemapMatch) {
            declaredSitemaps.push(sitemapMatch[1].trim());
          }

          const disallowMatch = line.match(/^Disallow:\s*(.*)$/i);
          if (disallowMatch) {
            const rule = disallowMatch[1].trim();
            if (rule === '/' || rule === '/*') {
              for (const ua of currentUserAgents) {
                if (ua === '*') {
                  wildcardDisallowAll = true;
                }
                const matchedAi = KNOWN_AI_BOTS.find((bot) => bot.toLowerCase() === ua.toLowerCase());
                if (matchedAi && !blockedAiBots.includes(matchedAi)) {
                  blockedAiBots.push(matchedAi);
                }
              }
            }
          }
        }

        // If wildcard disallows all and no specific AI bot overrides exist, flag them as blocked
        if (wildcardDisallowAll) {
          for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
            if (!blockedAiBots.includes(bot)) {
              blockedAiBots.push(bot);
            }
          }
        }
```

## Change
Replace the whole block above with this. Nothing else in the file changes.

```ts
        // Parse robots.txt for AI bots and Sitemaps
        const lines = robotsTxtContent.split('\n');
        let currentUserAgents: string[] = [];
        // True once the current group has a rule line: the next User-agent line then starts a new group.
        let groupHasRules = false;
        let wildcardDisallowAll = false;
        // AI crawlers that have a group of their own: the "*" group does not apply to them.
        const ownGroup = new Set<string>();

        for (const rawLine of lines) {
          const line = rawLine.split('#')[0].trim();
          if (!line) {
            currentUserAgents = [];
            groupHasRules = false;
            continue;
          }

          const uaMatch = line.match(/^User-agent:\s*(.+)$/i);
          if (uaMatch) {
            if (groupHasRules) {
              currentUserAgents = [];
              groupHasRules = false;
            }
            const ua = uaMatch[1].trim();
            currentUserAgents.push(ua);
            const knownAi = KNOWN_AI_BOTS.find((bot) => bot.toLowerCase() === ua.toLowerCase());
            if (knownAi) ownGroup.add(knownAi);
            continue;
          }

          const sitemapMatch = line.match(/^Sitemap:\s*(.+)$/i);
          if (sitemapMatch) {
            declaredSitemaps.push(sitemapMatch[1].trim());
            continue;
          }

          if (/^(?:Disallow|Allow|Crawl-delay):/i.test(line)) groupHasRules = true;

          const disallowMatch = line.match(/^Disallow:\s*(.*)$/i);
          if (disallowMatch) {
            const rule = disallowMatch[1].trim();
            if (rule === '/' || rule === '/*') {
              for (const ua of currentUserAgents) {
                if (ua === '*') {
                  wildcardDisallowAll = true;
                }
                const matchedAi = KNOWN_AI_BOTS.find((bot) => bot.toLowerCase() === ua.toLowerCase());
                if (matchedAi && !blockedAiBots.includes(matchedAi)) {
                  blockedAiBots.push(matchedAi);
                }
              }
            }
          }
        }

        // A wildcard "Disallow: /" blocks the AI crawlers that have no group of their own.
        if (wildcardDisallowAll) {
          for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
            if (!blockedAiBots.includes(bot) && !ownGroup.has(bot)) {
              blockedAiBots.push(bot);
            }
          }
        }
```

## Tests
Edit `packages/checkers/tests/seo.test.ts`. Copy the set-up of the existing test `audits root assets and detects AI crawler blocks in robots.txt` (it builds `new SiteRootAuditor()` and calls `audit(fetchFn, { baseUrl: 'https://example.com' })` with a fetch that answers `/robots.txt` with a string). Use a new `SiteRootAuditor` in each test (results are cached per origin). Add three tests after it:

1. Groups with no blank line between them:
   robots text `"User-agent: *\nDisallow: /admin\nUser-agent: GPTBot\nDisallow: /\n"`.
   Expect `result.blockedAiBots` to equal `['GPTBot']`.
2. A crawler with its own Allow group is not blocked by the wildcard:
   robots text `"User-agent: GPTBot\nAllow: /\n\nUser-agent: *\nDisallow: /\n"`.
   Expect `result.blockedAiBots` not to contain `'GPTBot'`, and to contain `'ClaudeBot'`, `'PerplexityBot'` and `'Google-Extended'`.
3. Two User-agent lines sharing one rule still share it:
   robots text `"User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n"`.
   Expect `result.blockedAiBots` to equal `['GPTBot', 'ClaudeBot']`.

Run: `pnpm exec vitest run packages/checkers/tests/seo.test.ts`

## Done when
- [x] The three new tests pass and every existing test in `seo.test.ts` still passes.
- [x] `pnpm build` passes.

## Notes
- Do not change the finding text or `KNOWN_AI_BOTS`.
- The `Sitemap:` branch gains a `continue`; a Sitemap line is not part of any group.
- Out of scope: path-level rules (`Disallow: /private`). Only a whole-site block is reported.
