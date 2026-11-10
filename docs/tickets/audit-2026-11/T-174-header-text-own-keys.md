# T-174: custom header parsing miscounts names like "constructor" and keeps case variants as two headers

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | types | bug | built |

**Files you may edit (no others):**
- `packages/types/src/input-rules.ts`
- `packages/types/tests/input-rules.test.ts`

**Do not build in parallel with:** none.

## Problem
`parseHeaderText` turns the "Name: value" lines a person types into a header map, with a limit of `MAX_CUSTOM_HEADERS`. It tests `name in headers` on a plain object, which also sees inherited names:
- `constructor: x` and `toString: x` are treated as already present, so they are not counted toward the limit.
- `__proto__: x` assigned with `headers[name] = value` sets the object's prototype instead of a header; the header is silently dropped.
- HTTP header names are case-insensitive, but `X-A: 1` and `x-a: 2` are kept as two headers; which one is sent is up to the browser.

## Current code
`packages/types/src/input-rules.ts:60-71` (branch `worktree-audit-cleanup`)
```ts
    if (count >= MAX_CUSTOM_HEADERS && !(name in headers)) {
      errors.push(`Line ${lineNum}: maximum of ${MAX_CUSTOM_HEADERS} headers exceeded`);
      continue;
    }

    if (!(name in headers)) {
      count++;
    }
    headers[name] = value;
  }

  return { headers, errors };
}
```
Earlier in the same function (`:22-31`):
```ts
export function parseHeaderText(text: string): { headers: Record<string, string>; errors: string[] } {
  const headers: Record<string, string> = {};
  const errors: string[] = [];
  ...
  const lines = text.split(/\r?\n/);
  let count = 0;
```

## Change
1. Directly after `let count = 0;` add:
```ts
  // Lower-cased name -> the name as last written. Header names are case-insensitive, and a Map sees
  // only what was added here (a plain object also "has" constructor, toString and __proto__).
  const written = new Map<string, string>();
```
2. Replace the block shown under "Current code" (from `if (count >= MAX_CUSTOM_HEADERS ...` to `headers[name] = value;`) with:
```ts
    const key = name.toLowerCase();
    const earlier = written.get(key);

    if (count >= MAX_CUSTOM_HEADERS && earlier === undefined) {
      errors.push(`Line ${lineNum}: maximum of ${MAX_CUSTOM_HEADERS} headers exceeded`);
      continue;
    }

    if (earlier === undefined) {
      count++;
    } else if (earlier !== name) {
      // The same header written with other capitals: the last one replaces it.
      delete headers[earlier];
    }
    written.set(key, name);
    // defineProperty, so a name like __proto__ becomes an ordinary own property.
    Object.defineProperty(headers, name, { value, enumerable: true, writable: true, configurable: true });
```
The `return { headers, errors };` and everything before the block stay as they are.

## Tests
Edit `packages/types/tests/input-rules.test.ts`. There is an existing `describe` for `parseHeaderText` with the test `parses valid headers and keeps last occurrence for duplicates` and `enforces maximum custom headers count`; copy their style. Add:
```ts
    it('counts names that every object inherits, and keeps them', () => {
      const result = parseHeaderText('constructor: a\ntoString: b');
      expect(result.errors).toEqual([]);
      expect(Object.keys(result.headers).sort()).toEqual(['constructor', 'toString']);
      expect(result.headers.constructor).toBe('a');
    });

    it('keeps __proto__ as an ordinary header', () => {
      const result = parseHeaderText('__proto__: x');
      expect(Object.keys(result.headers)).toEqual(['__proto__']);
      expect(Object.getPrototypeOf(result.headers)).toBe(Object.prototype);
    });

    it('treats names that differ only in capitals as one header: the last wins', () => {
      const result = parseHeaderText('X-A: 1\nx-a: 2');
      expect(result.headers).toEqual({ 'x-a': '2' });
      expect(result.errors).toEqual([]);
    });

    it('inherited names count toward the maximum', () => {
      const lines = Array.from({ length: MAX_CUSTOM_HEADERS - 1 }, (_, i) => `X-H${i}: v`);
      const result = parseHeaderText([...lines, 'constructor: a', 'X-Over: b'].join('\n'));
      expect(Object.keys(result.headers)).toHaveLength(MAX_CUSTOM_HEADERS);
      expect(result.errors).toHaveLength(1);
    });
```
`MAX_CUSTOM_HEADERS` and `parseHeaderText` are already imported in that file; if `__proto__` is rejected by `HEADER_NAME_PATTERN` in your run, replace that test's expectation with `expect(result.errors[0]).toMatch(/invalid header name/)` (the pattern allows underscores at the time of writing).

Run: `pnpm exec vitest run packages/types/tests/input-rules.test.ts`, then `pnpm build`.

## Done when
- [x] New tests pass; existing tests in the file pass unchanged.
- [x] `pnpm build` passes.

## Notes
- The returned `headers` stays a plain `Record<string, string>`; callers are not changed.
- This module is imported by the wizard: no Node built-ins (`Object.hasOwn` is avoided too, for older browsers).
