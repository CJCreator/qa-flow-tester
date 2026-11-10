# T-199: New check-up: removing a sign-in row no longer moves its open panel to the next row

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/screens/NewCheckupScreen.tsx`
- `packages/wizard/src/lib/row-keys.ts` (new)
- `packages/wizard/tests/row-keys.test.ts` (new)

**Do not build in parallel with:** T-195 (edits `NewCheckupScreen.tsx`).

## Problem

The sign-in rows (one per Role) are rendered with `key={i}`, the row's position. `SignInRow` keeps its own state (whether its extra fields are open). Scenario: open the extra fields of row 1, then remove row 1. Row 2 becomes position 1 and inherits the open panel, because React matched it by position.

## Current code

`packages/wizard/src/screens/NewCheckupScreen.tsx:1388-1400` (inside `function SignInsSection`, which starts at line 1365; branch `worktree-audit-cleanup`)

```tsx
        form.signIns.map((s, i) => (
          <SignInRow
            key={i}
            value={s}
            legend={`Sign-in ${i + 1}`}
            rolePlaceholder={i === 0 ? 'member' : 'admin'}
            onChange={(patch) => set(i, patch)}
            onRemove={() => {
              setDetailed(true);
              onFormChange((f) => ({ ...f, signIns: f.signIns.filter((_, n) => n !== i) }));
            }}
          />
        ))
```

Rows are only ever added at the end (line 1424) and removed by position (line 1397). `SignInEntry` (`lib/form.ts:84-92`) is saved and sent to the runner, so it must not gain an id field.

## Change

1. Create `packages/wizard/src/lib/row-keys.ts`:

```ts
/**
 * Stable React keys for a list whose items have no id of their own. Items are added at the end and
 * removed by position; a key stays with its row, so a row's own state never moves to its neighbour.
 */
export class RowKeys {
  private keys: number[] = [];
  private next = 1;

  /** The keys for a list of this length, growing at the end when rows were added. */
  for(length: number): readonly number[] {
    while (this.keys.length < length) this.keys.push(this.next++);
    if (this.keys.length > length) this.keys.length = length;
    return this.keys;
  }

  /** Forgets the key of the row at this position: call it when that row is removed. */
  remove(index: number): void {
    this.keys.splice(index, 1);
  }
}
```

2. `NewCheckupScreen.tsx`: add the import next to the other `../lib/...` imports:

```tsx
import { RowKeys } from '../lib/row-keys';
```

3. In `SignInsSection`, before its `return`, add (`useRef` is already imported on line 1):

```tsx
  const rowKeys = useRef(new RowKeys()).current;
  const keys = rowKeys.for(form.signIns.length);
```

4. In the map, change `key={i}` to `key={keys[i]}` and make `onRemove`:

```tsx
            onRemove={() => {
              setDetailed(true);
              rowKeys.remove(i);
              onFormChange((f) => ({ ...f, signIns: f.signIns.filter((_, n) => n !== i) }));
            }}
```

## Tests

New file `packages/wizard/tests/row-keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RowKeys } from '../src/lib/row-keys';

describe('RowKeys', () => {
  it('gives each row its own key and keeps it', () => {
    const k = new RowKeys();
    expect([...k.for(3)]).toEqual([1, 2, 3]);
    expect([...k.for(3)]).toEqual([1, 2, 3]);
  });
  it('keeps the other rows’ keys when one is removed', () => {
    const k = new RowKeys();
    k.for(3);
    k.remove(0);
    expect([...k.for(2)]).toEqual([2, 3]);
  });
  it('gives a new row a key never used before', () => {
    const k = new RowKeys();
    k.for(2);
    k.remove(1);
    expect([...k.for(2)]).toEqual([1, 3]);
  });
  it('drops extra keys when the list was shortened elsewhere', () => {
    const k = new RowKeys();
    k.for(3);
    expect([...k.for(1)]).toEqual([1]);
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/row-keys.test.ts packages/wizard/tests/signin-form.test.ts` then `pnpm build`.

## Done when

- [ ] `key={i}` is gone from the sign-in rows.
- [ ] Removing a row leaves the next row's extra fields as they were.
- [ ] `SignInEntry` is unchanged.
- [ ] Tests and `pnpm build` pass.

## Notes

- The single-row form at lines 1563-1564 has no list; leave it.
- Do not use `crypto.randomUUID()` or array indexes for keys.
