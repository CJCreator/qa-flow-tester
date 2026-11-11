# T-305: A page's form `pattern` and `minlength` cannot freeze or flood the runner

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/plan/rejects.ts`
- `packages/core/tests/rejects-hostile-forms.test.ts` (new)

**Do not build in parallel with:** none.

## Problem

Rejects Plan Items (ADR 0024) are planned from what each form states: `required`, `pattern`, `minlength` and so on. The Deterministic Spider copies those attributes from the page exactly as written (`packages/core/src/discovery/deterministic-spider.ts:345-349`), and `deriveRejects` runs on every Plan, with or without an AI key (`packages/core/src/plan/ai-planner.ts:1154`). The page controls these values, and the runner is one Node process that serves every Check-up.

Two things go wrong on a hostile or careless page:

- **The runner freezes.** `wholeMatch` (`packages/core/src/plan/rejects.ts:40-46`) compiles the page's `pattern` into a Node regular expression and runs it on our test values. A short pattern such as `(.*a){12}!` backtracks for minutes on `test.user@example.com`. Capping the pattern's length does not help: the slow patterns are short. While the regex runs, the whole runner stops: other Check-ups, the event stream and the wizard.
- **The runner runs out of memory.** `validValue` pads a value to `minLength` (`rejects.ts:124-128`), `rejectRulesOf` builds `'a'.repeat(minLength - 1)` (`rejects.ts:158-159`), and `sampleFor` repeats a unit `{n}` times (`rejects.ts:81-83`, `rejects.ts:91`). `minlength="500000000"` or `pattern="a{500000000}"` allocates hundreds of MB, and the value is then copied into every Plan Item, the saved Plan and the event stream. A larger number throws `RangeError: Invalid string length` and the whole planning step fails.

A third, smaller problem: browsers compile `pattern` with the `v` flag and ignore a pattern that does not compile (for example `[A-Za-z0-9-_]+`). We compile without a flag, so for such a field we plan a "does not match the expected format" item the browser will never refuse, and the report shows a false "the form accepted it" finding.

## Current code

Branch from `main`.

`packages/core/src/plan/rejects.ts` (`grep -n "function wholeMatch" packages/core/src/plan/rejects.ts`):

```ts
function wholeMatch(pattern: string, value: string): boolean | undefined {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return undefined;
  }
}
```

`grep -n "minLength\|times = Number" packages/core/src/plan/rejects.ts`:

```ts
      times = Number(m[1]);
...
  if (input.minLength && value.length < input.minLength) {
    const padded = value.padEnd(input.minLength, 'a');
...
  if (type !== 'number' && input.minLength && input.minLength >= 2)
    out.push({ rule: 'minlength', value: 'a'.repeat(input.minLength - 1), what: 'is too short' });
```

`validValue` uses `input.pattern` directly (`grep -n "input.pattern" packages/core/src/plan/rejects.ts`), and `rejectRulesOf` plans a pattern item when `wholeMatch(input.pattern!, v) === false`.

## Change

1. `rejects.ts`: add `import vm from 'node:vm';` with the imports. Below `NON_MATCHING` add:

```ts
/** A longer `pattern` is not read: the field gets no pattern item and no typed value. */
const MAX_PATTERN_LENGTH = 256;
/** The longest value a Rejects item types; a field that needs more gets no item. */
const MAX_VALUE_LENGTH = 1000;
/** One pattern check may take this long; a slower pattern is never run again in this process. */
const PATTERN_TIMEOUT_MS = 100;

// The page's pattern runs in a separate context with a time limit, so a pattern that backtracks
// for minutes cannot stop the runner. Results are cached: the same few values are tried for each pattern.
const matchContext = vm.createContext({ pattern: '', value: '' });
const matchScript = new vm.Script('new RegExp("^(?:" + pattern + ")$", "v").test(value)');
const matchCache = new Map<string, boolean>();
const slowPatterns = new Set<string>();
```

2. Replace `wholeMatch`:

```ts
/** undefined: the pattern is too long or too slow to check, so nothing is planned from it. */
function wholeMatch(pattern: string, value: string): boolean | undefined {
  if (pattern.length > MAX_PATTERN_LENGTH || slowPatterns.has(pattern)) return undefined;
  const key = `${pattern}\u0000${value}`;
  const known = matchCache.get(key);
  if (known !== undefined) return known;
  matchContext.pattern = pattern;
  matchContext.value = value;
  let result: boolean;
  try {
    result = matchScript.runInContext(matchContext, { timeout: PATTERN_TIMEOUT_MS }) === true;
  } catch {
    if (slowPatterns.size >= 1000) slowPatterns.clear();
    slowPatterns.add(pattern);
    return undefined;
  }
  if (matchCache.size >= 5000) matchCache.clear();
  matchCache.set(key, result);
  return result;
}

/** The pattern the browser applies: none when it does not compile with the `v` flag (HTML spec). */
function patternInForce(pattern: string | undefined): string | undefined {
  if (!pattern) return undefined;
  try {
    new RegExp(`^(?:${pattern})$`, 'v'); // compiling does not backtrack; only matching can
    return pattern;
  } catch {
    return undefined;
  }
}
```

3. `sampleFor`: after `times = Number(m[1]);` add `if (times > MAX_VALUE_LENGTH) return undefined;`, and after `out += unit.repeat(times);` add `if (out.length > MAX_VALUE_LENGTH) return undefined;`.

4. `validValue`: at the top add `const pattern = patternInForce(input.pattern);` and use `pattern` instead of `input.pattern` in the three pattern checks (and drop the `!`). In the minimum-length block, before `padEnd`, add `if (input.minLength > MAX_VALUE_LENGTH) return undefined;`.

5. `rejectRulesOf`: add `const pattern = patternInForce(input.pattern);` and change the pattern block to `if (pattern && type !== 'email' && type !== 'url') { const bad = NON_MATCHING.find((v) => wholeMatch(pattern, v) === false); ... }`. Change the minimum-length condition to `input.minLength >= 2 && input.minLength <= MAX_VALUE_LENGTH`.

6. Run `pnpm exec prettier --write packages/core/src/plan/rejects.ts packages/core/tests/rejects-hostile-forms.test.ts`, then `pnpm build`.

## Tests

New file `packages/core/tests/rejects-hostile-forms.test.ts` (unit tier, no browser). Copy the `page()` helper from `rejects-plan.test.ts`. One `form(inputs)` helper: `urlPath: '/f'`, `method: 'POST'`, `submitButtonSelector: '#go'`.

- "a pattern that backtracks for minutes does not stop planning": inputs `#a` (`type: 'text'`, `required: true`, `pattern: '(.*a){12}!'`) and `#b` (`type: 'text'`, `required: true`). Time `deriveRejects`; assert it returns in under 3000 ms, and no item name contains `“#a” does not match` (the label falls back to the selector).
- "a huge minlength plans no item and types no huge value": `#a` with `minLength: 50_000_000`. Assert no item has rule text `is too short`, and every step `value` in every item is at most 1000 characters.
- "a huge repeat count in a pattern builds no huge value": `#a` with `required: true, pattern: 'a{100000000}'`, plus `#b` required. Assert it does not throw and no step value is longer than 1000 characters.
- "a pattern the browser ignores plans no pattern item": `#a` with `pattern: '[A-Za-z0-9-_]+'` (does not compile with `v`) and `required: true`, plus `#b` required. Assert no `does not match the expected format` item, and `Rejects: “#b” left empty` is planned (the ignored pattern does not block the form).
- "a pattern longer than 256 characters is not read": `pattern: 'a'.repeat(300)`. Assert no pattern item.

The existing `packages/core/tests/rejects-plan.test.ts` and `rejects-gating.test.ts` must pass unchanged (their patterns compile with `v`).

Run: `pnpm exec vitest run packages/core/tests/rejects-hostile-forms.test.ts packages/core/tests/rejects-plan.test.ts packages/core/tests/rejects-gating.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "RegExp(" packages/core/src/plan/rejects.ts` shows only the `vm.Script` source and the `'v'` compile in `patternInForce`: no page pattern runs on the main thread.
- [ ] `grep -n "runInContext" packages/core/src/plan/rejects.ts` finds the time-limited match.
- [ ] `grep -n "MAX_VALUE_LENGTH" packages/core/src/plan/rejects.ts` finds the caps in `sampleFor`, `validValue` and `rejectRulesOf`.
- [ ] The new test and the core unit tests pass; `pnpm build` passes.

## Notes

- Audit finding H4 (audit of 11 Nov 2026 on `d225418`).
- Why a time limit and not only a length cap: the slow patterns are short. The `vm` time limit stops a running regex (checked on Node 22/24: `(.*a){12}!` on a 30-character value ends with `ERR_SCRIPT_EXECUTION_TIMEOUT` after the limit). One check costs well under a millisecond on Linux; the cache keeps the count small.
- Considered and not chosen: checking `input.validity` in the page during the crawl. The candidate values depend on Node-side rules (`guessFillValue`, padding), and a slow pattern would then hang the Spider's `page.evaluate`, which has no time limit.
- Not in this ticket: `discovery/crud-facts.ts:73` and `json-schema-lite.ts:52` also build regexes from outside text. They are reviewed separately (`api-spec-checks.ts` is T-317's area).
