# T-130: Guessed form values ignore the word "name" in a selector; Navigation Checks pick the widest size by width

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core | bug | built |

**Files you may edit (no others):**
- `packages/core/src/plan/fill-values.ts`
- `packages/core/src/plan/journeys.ts`
- `packages/core/src/plan/expand.ts`
- `packages/core/tests/fill-values.test.ts` (new)

**Do not build in parallel with:** T-128 (also edits `journeys.ts`).

## Problem

**A. "Test User" typed into the wrong fields.** The value guesser gets a hint made of the field's selector
plus its label, and tests `hint.includes('name')` before the number test. A selector such as
`input[name="quantity"]` or `[name="comment"]` contains the attribute word `name`, so the guess is
`Test User`: a name typed into a number field (validation error, false Finding) or into any field at all.
There are two copies of the guesser: `plan/fill-values.ts` and a private one in `plan/journeys.ts`.

**B. "Widest size" is the last one in the list.** `plan/expand.ts` clicks a Navigation Check at "the widest
size where it shows plainly", taken as `plain[plain.length - 1]`. The screen sizes arrive in the order the
person chose them. For `['1440px', '375px']` the "widest" is `375px`.

## Current code

`packages/core/src/plan/fill-values.ts:1-18` (branch `worktree-audit-cleanup`)

```ts
/** A believable value for a form field, from its selector and label. */
export function guessFillValue(target: string): string {
  const hint = target.toLowerCase();
  if (hint.includes('email')) return 'test.user@example.com';
  if (hint.includes('password') || hint.includes('pass')) return 'TestPassword123!';
  if (
    hint.includes('url') ||
    hint.includes('address') ||
    hint.includes('site') ||
    hint.includes('domain') ||
    hint.includes('host')
  )
    return 'https://example.com';
  if (hint.includes('phone') || hint.includes('tel')) return '5555550123';
  if (hint.includes('name')) return 'Test User';
  if (/number|amount|qty|quantity|price/.test(hint)) return '1';
  return 'Test Value';
}
```

`packages/core/src/plan/journeys.ts:61-63` (the private copy; it has more cases below these lines)

```ts
/** A likely-looking value for a fill step the AI left empty: better an obvious test value than a blank field that passes silently. */
function guessFillValue(step: { selector?: string; name: string }): string {
  const hint = `${step.selector || ''} ${step.name}`.toLowerCase();
```

and further down in the same function:

```ts
  if (hint.includes('first') && hint.includes('name')) return 'Alex';
  if (hint.includes('last') && hint.includes('name')) return 'Smith';
  if (hint.includes('name')) return 'Test User';
  if (hint.includes('number') || hint.includes('amount') || hint.includes('qty') || hint.includes('count')) return '1';
```

`packages/core/src/plan/expand.ts:188-189`

```ts
    const plain = visible.filter((s) => !viaMenu.includes(s));
    const at = visible.filter((s) => viaMenu.includes(s) || s === plain[plain.length - 1]);
```

## Change

### A. Value guesser

1. `fill-values.ts`: add and export a helper above `guessFillValue`, and use it for the hint:

```ts
/**
 * The words that describe a field, lower-cased, with selector syntax taken out: in `input[name="quantity"]`
 * the attribute word "name" says nothing about the field, only its value does.
 */
export function fieldHint(target: string): string {
  return target
    .toLowerCase()
    .replace(/\b(name|id|type|placeholder|aria-label|data-testid|for)\s*=/g, ' ');
}
```

   In `guessFillValue`: `const hint = fieldHint(target);` and move the number line **above** the name line:

```ts
  if (/number|amount|qty|quantity|price/.test(hint)) return '1';
  if (hint.includes('name')) return 'Test User';
```

2. `journeys.ts`: import `fieldHint` from `./fill-values.js`, change the hint line to

```ts
  const hint = fieldHint(`${step.selector || ''} ${step.name}`);
```

   and move the `number / amount / qty / count` line above the three `name` lines.

### B. Widest size

3. `expand.ts`: replace the `const at = ...` line with:

```ts
    // The widest by width, not by position: sizes arrive in the order the person chose them.
    const widest = plain.reduce<string | undefined>((a, s) => (a === undefined || parseInt(s, 10) > parseInt(a, 10) ? s : a), undefined);
    const at = visible.filter((s) => viaMenu.includes(s) || s === widest);
```

   If `plain` is typed as `Breakpoint[]`, type `widest` as `Breakpoint | undefined` instead of `string | undefined`.

## Tests

Add `packages/core/tests/fill-values.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fieldHint, guessFillValue } from '../src/plan/fill-values.js';

describe('guessFillValue', () => {
  it('reads the attribute value, not the attribute word', () => {
    expect(guessFillValue('input[name="quantity"] Quantity')).toBe('1');
    expect(guessFillValue('[name="comment"] Comment')).toBe('Test Value');
    expect(guessFillValue('[name="full_name"] Your name')).toBe('Test User');
    expect(guessFillValue('#email Email')).toBe('test.user@example.com');
  });
  it('fieldHint drops selector attribute words', () => {
    expect(fieldHint('input[name="qty"][type="number"]')).not.toContain('name');
    expect(fieldHint('input[name="qty"][type="number"]')).toContain('qty');
  });
});
```

For B, extend `packages/core/tests/validator-expander.test.ts` only if it already builds a Navigation Check
with two screen sizes: add a case where the Plan's sizes are `['1440px', '375px']`, no menu steps, and expect
the produced test to run at `1440px`. If that file has no such fixture, skip the B test and say so in the PR
(add `validator-expander.test.ts` to your edits if you use it).

Commands: `pnpm exec vitest run packages/core/tests/fill-values.test.ts packages/core/tests/validator-expander.test.ts packages/core/tests/expand-intents-off.test.ts`, then `pnpm build`.

## Done when

- [x] `input[name="quantity"]` gets `1`, `[name="comment"]` gets `Test Value`
- [x] The Navigation Check size is the largest width in the list, whatever the order
- [x] The tests above and `pnpm build` pass

## Notes

Merging the two guessers into one is out of scope.
