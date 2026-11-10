# T-158: Repeated list scans in the audit analysis grow with pages times findings

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core/audit | speed | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/src/audit/analysis/analyse-site.ts`
- `packages/core/src/audit/analysis/marketing-signals.ts`
- `packages/core/src/audit/analysis/broken-links.ts`
- `packages/core/src/audit/preview/prompt.ts`
- `packages/core/src/audit/documents/roadmap.ts`

**Do not build in parallel with:** T-138, T-140, T-144, T-145, T-153, T-154, T-157 (edit `pipeline.ts`); T-151 (edits `prompt.ts`); T-152 (edits `roadmap.ts`).

## Problem

Several places look something up with `Array.includes` or `Array.filter` inside a loop over pages or findings. Each is correct; together they make the work grow with pages x findings (or pages x pages for a footer link that is on every page). On a 200-page site with a few thousand findings this is millions of comparisons for results a `Map` or `Set` gives directly.

No output changes in this ticket.

## Current code and change

Branch `worktree-audit-cleanup`.

### 1. `pipeline.ts:596`: findings of a page, filtered three times per page

```ts
  const findingsOf = (urlPath: string) => aiOrdered.filter((f) => f.urlPath === urlPath);
```

Replace with (the order inside each page stays the ranked order, and each call still returns its own array):

```ts
  const findingsByPath = new Map<string, AuditFinding[]>();
  for (const f of aiOrdered) {
    const list = findingsByPath.get(f.urlPath);
    if (list) list.push(f);
    else findingsByPath.set(f.urlPath, [f]);
  }
  const findingsOf = (urlPath: string): AuditFinding[] => [...(findingsByPath.get(urlPath) ?? [])];
```

### 2. `analyse-site.ts:205`: every finding scanned for every page

```ts
      seo: seoBasics(p.content, findings),
```

`seoBasics` keeps only findings whose `rule` is one of `CONTENT_PROBLEM_RULES`. Filter once, before the loop or `map` that builds the page entries (the statement that contains the line above):

```ts
  const contentFindings = findings.filter((f) => (CONTENT_PROBLEM_RULES as readonly string[]).includes(f.rule));
```

and change the line to:

```ts
      seo: seoBasics(p.content, contentFindings),
```

Import `CONTENT_PROBLEM_RULES` from `'./content-problems.js'` (add it to the existing import from that module if there is one).

### 3. `marketing-signals.ts:150` (`onPageSeo`)

```ts
  const withTitle = pages.filter((p) => nonEmpty(p.content.title));
  const withDescription = pages.filter((p) => nonEmpty(p.content.description));
  const withH1 = pages.filter((p) => p.content.headings.some((h) => h.level === 1 && nonEmpty(h.text)));
  const found = pathsOf(
    pages.filter((p) => withTitle.includes(p) || withDescription.includes(p) || withH1.includes(p))
  );
```

Replace the `const found = ...` statement with:

```ts
  const withAny = new Set([...withTitle, ...withDescription, ...withH1]);
  const found = pathsOf(pages.filter((p) => withAny.has(p)));
```

Leave `withTitle`, `withDescription` and `withH1` as they are (they are used further down).

### 4. `preview/prompt.ts:113`

```ts
  const onHome = result.findings.filter((f) => f.urlPath === rootPath || (f.pages ?? []).includes(rootPath));
  const rest = result.findings.filter((f) => !onHome.includes(f));
```

Replace the second line with:

```ts
  const onHomeSet = new Set(onHome);
  const rest = result.findings.filter((f) => !onHomeSet.has(f));
```

### 5. `broken-links.ts:164`: pages of one link target

```ts
        targets.set(link.to, {
          to: link.to,
          pages: [page.urlPath],
          sectionId: link.sectionId ?? page.sections[0]?.id ?? null,
        });
      } else if (!target.pages.includes(page.urlPath)) {
        target.pages.push(page.urlPath);
      }
```

Keep `pages` as the array (it is read later, in order). Add a `Set` beside the map, declared where `targets` is declared:

```ts
  const seenPages = new Map<string, Set<string>>();
```

and change the two branches to:

```ts
        targets.set(link.to, {
          to: link.to,
          pages: [page.urlPath],
          sectionId: link.sectionId ?? page.sections[0]?.id ?? null,
        });
        seenPages.set(link.to, new Set([page.urlPath]));
      } else {
        const seen = seenPages.get(link.to)!;
        if (!seen.has(page.urlPath)) {
          seen.add(page.urlPath);
          target.pages.push(page.urlPath);
        }
      }
```

If the `if` above these lines has branches that `continue` before a target is stored, leave them untouched; only the two branches shown change. If `target` can exist in the map without an entry in `seenPages` (check where else `targets.set` is called in that function), create the set lazily: `const seen = seenPages.get(link.to) ?? new Set(target.pages); seenPages.set(link.to, seen);`.

### 6. `roadmap.ts:61`

```ts
    for (const page of finding.pages && finding.pages.length > 0 ? finding.pages : [finding.urlPath]) {
      if (!group.pages.includes(page)) group.pages.push(page);
    }
```

Add a module-level helper map inside the function that owns `groups` (declare next to `const groups = ...`):

```ts
  const groupPages = new Map<string, Set<string>>();
```

and change the loop to:

```ts
    let seenInGroup = groupPages.get(finding.rule);
    if (!seenInGroup) {
      seenInGroup = new Set(group.pages);
      groupPages.set(finding.rule, seenInGroup);
    }
    for (const page of finding.pages && finding.pages.length > 0 ? finding.pages : [finding.urlPath]) {
      if (seenInGroup.has(page)) continue;
      seenInGroup.add(page);
      group.pages.push(page);
    }
```

(`groups` is keyed by `finding.rule`, as the line `groups.set(finding.rule, group);` above shows.)

## Tests

No new behaviour, so no new test. The existing tests pin the outputs; run them all:

`pnpm exec vitest run packages/core/tests/audit-pipeline.test.ts packages/core/tests/audit-analyse-site.test.ts packages/core/tests/audit-marketing-signals.test.ts packages/core/tests/audit-broken-links.test.ts packages/core/tests/audit-preview.test.ts packages/core/tests/audit-doc-roadmap.test.ts packages/core/tests/audit-content-problems.test.ts`

Then `pnpm build`.

## Done when

- [ ] All six replacements are made and no listed test changes its expectations.
- [ ] `pnpm build` passes.

## Notes

- Do not change the order of any output list: the documents print these lists in order.
- `crawl/crawl.ts` has one more scan of this kind (`entry.from.includes(page.urlPath)` when collecting links that leave the site). It is left out here because five other tickets edit `crawl.ts`; the list is small in practice.
- If a step's surrounding code does not match what is shown, skip that step and say which one in your report. Do not guess.
