# T-143: Two rewrite requests on one version can lose an update

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | core/audit | bug | todo |

**Files you may edit (no others):**
- `packages/core/src/audit/ai/rewrite-store.ts`
- `packages/core/tests/audit-rewrite-store.test.ts`

**Do not build in parallel with:** T-151 (edits `rewrite-store.ts`).

## Problem

`RewriteStore.change()` reads `rewrites.json`, changes one Section's state and writes the file back. It queues these steps on `this.queue`, which belongs to one `RewriteStore` instance. The runner builds a new `RewriteStore` for every request (`rewriteStoreFor` in `packages/runner/src/routes/index.ts`), so two requests on the same version each have their own queue. Both read the same file, and the second write removes the first one's change.

Scenario: the owner approves Section A and Section B at the same moment. Only one approval is saved.

## Current code

`packages/core/src/audit/ai/rewrite-store.ts:168` (branch `worktree-audit-cleanup`)

```ts
export class RewriteStore {
  readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  /** `versionDir`: the audit version's folder, chosen and checked by the caller. */
  constructor(versionDir: string) {
    this.file = path.join(versionDir, REWRITES_FILE);
  }
```

Same file, `change()`:

```ts
  private change(s: RewriteSection, apply: (state: RewriteState) => RewriteState | undefined): Promise<RewriteResult> {
    const run = this.queue.then(async (): Promise<RewriteResult> => {
      const states = await this.list();
      ...
      await writeJsonAtomic(this.file, stored);
      return { ok: true, rewrite: next };
    });
    this.queue = run.catch(() => {});
    return run;
  }
```

## Change

1. Above `export class RewriteStore`, add a module-level map:

```ts
/**
 * One save queue per rewrites file, shared by every RewriteStore of this process: the runner builds a new
 * store for each request, so a queue kept on the instance would not stop two requests overwriting each other.
 */
const SAVE_QUEUES = new Map<string, Promise<unknown>>();
```

2. Delete the field `private queue: Promise<unknown> = Promise.resolve();`.

3. In `change()`, replace `const run = this.queue.then(` with:

```ts
    const waitFor = SAVE_QUEUES.get(this.file) ?? Promise.resolve();
    const run = waitFor.then(
```

and replace `this.queue = run.catch(() => {});` with:

```ts
    const tail = run.catch(() => {});
    SAVE_QUEUES.set(this.file, tail);
    // Drop the entry once nothing newer is waiting, so the map does not grow with every version ever edited.
    void tail.then(() => {
      if (SAVE_QUEUES.get(this.file) === tail) SAVE_QUEUES.delete(this.file);
    });
```

Leave the body of the `then` callback unchanged.

## Tests

Edit `packages/core/tests/audit-rewrite-store.test.ts`. Copy the setup of `'approval of one Section does not approve another'` (about line 88), which creates a temp version folder and a store.

Add `'two stores on the same version folder do not lose an update'`:

- build two stores on the same folder: `const a = new RewriteStore(dir); const b = new RewriteStore(dir);`
- approve two different Sections at once with the store's public approve method (the one the existing test calls), one through `a` and one through `b`, inside `await Promise.all([...])`;
- read the list through a third `new RewriteStore(dir)` and expect both Sections to have a non-null `approvedAt`.

Run: `pnpm exec vitest run packages/core/tests/audit-rewrite-store.test.ts`, then `pnpm build`.

## Done when

- [ ] The new test passes (it fails before the change, at least some of the time).
- [ ] No `queue` field is left on the class.
- [ ] Tests and `pnpm build` pass.

## Notes

- This guards one runner process, which is how the tool runs (single instance, ADR 0039). A lock across processes is out of scope.
- Do not change the runner.
