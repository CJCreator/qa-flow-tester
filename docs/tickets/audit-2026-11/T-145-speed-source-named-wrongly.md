# T-145: Speed measured by this tool is attributed to PageSpeed Insights, and reads as graded

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core/audit | inconsistency | built |

**Files you may edit (no others):**
- `packages/core/src/audit/ai/assessment.ts`
- `packages/core/src/audit/pipeline/pipeline.ts`
- `packages/core/tests/audit-assessment.test.ts`
- `packages/core/tests/audit-pipeline.test.ts`

**Do not build in parallel with:** T-138, T-140, T-144, T-151, T-153, T-154, T-155, T-158.

## Problem

1. The data sent to the AI for the speed area always says `source: 'PageSpeed Insights (mobile)'`, and the area description says "from PageSpeed Insights values". When no PageSpeed key is saved, the values come from this tool's own Chromium (`source: 'this-tool'`). The AI notes then credit PageSpeed Insights for numbers it never produced. ADR 0042 says the source must be named.

2. The speed grade comes only from the `performance-score` metric, which only PageSpeed Insights produces. With this tool's own timing the result note says "Speed was measured by this tool." while the speed area has no grade, and the documents print that an area without a grade was not checked. The note does not explain the missing grade.

## Current code

`packages/core/src/audit/ai/assessment.ts:88` (branch `worktree-audit-cleanup`)

```ts
const AREA_MEANING: Record<AuditArea, string> = {
  'search-ranking': 'how well search engines can find, read and rank the page',
  marketing: 'how clearly the page sells: offer, calls to action, trust',
  usability: 'how easy the page is to use, on a phone too',
  content: 'how clear, complete and well structured the words are',
  accessibility: 'problems automatic WCAG 2.2 AA checks found (automatic checks find some problems only)',
  speed: 'how fast the page loads, from PageSpeed Insights values',
};
```

`packages/core/src/audit/ai/assessment.ts:408`

```ts
function speedSummary(speed: PageSpeed) {
  const one = (s: ExternalSpeed) =>
    s.status === 'measured'
      ? { method: s.method, values: s.values.map((v) => ({ metric: v.metric, value: v.value, unit: v.unit })) }
      : { method: s.method, notMeasured: s.reason };
  return { source: 'PageSpeed Insights (mobile)', lab: one(speed.lab), field: one(speed.field) };
}
```

`speed.lab.source` is `'pagespeed-insights' | 'this-tool'`.

`packages/core/src/audit/pipeline/pipeline.ts:219`

```ts
export function speedSourceNoteText(source: 'pagespeed-insights' | 'this-tool' | 'not-measured'): string {
  if (source === 'pagespeed-insights') return 'Speed was measured by Google PageSpeed Insights.';
  if (source === 'this-tool') return 'Speed was measured by this tool.';
  return 'Speed was not measured.';
}
```

## Change

1. `assessment.ts`, `AREA_MEANING.speed`:

```ts
  speed: 'how fast the page loads, from the measured speed values (their source is named in the data)',
```

2. `assessment.ts`, `speedSummary` return line:

```ts
  const source =
    speed.lab.source === 'this-tool' ? 'measured by this tool (lab, one run)' : 'PageSpeed Insights (mobile)';
  return { source, lab: one(speed.lab), field: one(speed.field) };
```

3. `pipeline.ts`, `speedSourceNoteText`, the `'this-tool'` line:

```ts
  if (source === 'this-tool') {
    return 'Speed was measured by this tool. The speed area has no grade: a grade needs a Google PageSpeed Insights score.';
  }
```

## Tests

`packages/core/tests/audit-assessment.test.ts`: copy the setup of `'sends the page summary, its findings, its grades and its PageSpeed values on the assessment stage'` (about line 175). Add `'names this tool as the speed source when it measured the values'`: pass a page whose `speed.lab` is `{ status: 'measured', source: 'this-tool', method: 'lab', values: [...] }`; expect the user message sent to the AI to contain `measured by this tool (lab, one run)` and not to contain `PageSpeed Insights (mobile)`.

`packages/core/tests/audit-pipeline.test.ts`: search the file for the string `Speed was measured by this tool.` and update each expectation to the new full sentence.

Then search the whole repo for the old sentence: `Speed was measured by this tool.` If another test under `packages/*/tests` pins the old text for a value produced by this function, update that expectation too and list the file in your report. Do not edit source files outside the list above.

Run: `pnpm exec vitest run packages/core/tests/audit-assessment.test.ts packages/core/tests/audit-pipeline.test.ts`, then `pnpm build`.

## Done when

- [x] AI input names this tool as the source when it measured the values.
- [x] The this-tool note explains the missing grade.
- [x] Tests and `pnpm build` pass.

## Notes

- Decision made: no speed grade is derived from this tool's lab values. One throttled run is not comparable with a PageSpeed Insights score, so the area stays without a grade and the note says why.
- `packages/wizard/src/screens/audit/results/analysis-text.ts` holds an unused copy of `speedSourceNoteText`; it is removed by the wizard dead-code ticket, not here.
