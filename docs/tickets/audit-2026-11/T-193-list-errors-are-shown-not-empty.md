# T-193: A failed list of comparisons or schedules shows an error, not an empty list

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | wizard | bug | built |

**Files you may edit (no others):**
- `packages/wizard/src/api.ts`
- `packages/wizard/src/screens/BenchmarkScreen.tsx`
- `packages/wizard/tests/checkup-schedules.test.tsx`

**Do not build in parallel with:** T-190, T-195 (edit `api.ts`), T-203 (edits `BenchmarkScreen.tsx`).

## Problem

`listBenchmarks` and `listSchedules` return `[]` on any failure. The screens that call them have error states that can never show: `BenchmarkScreen` has a load error with Retry (lines 117-130) and Settings has a schedules error (lines 884-899). A runner that is down reads as "No comparisons yet" and "no schedules".

## Current code

`packages/wizard/src/api.ts:974-982` (branch `worktree-audit-cleanup`)

```ts
/** The running and kept comparisons, newest first, without their full results. */
export async function listBenchmarks(): Promise<BenchmarkJob[]> {
  try {
    const res = await call('/api/runner/benchmarks');
    return res.ok ? json<BenchmarkJob[]>(res) : [];
  } catch {
    return [];
  }
}
```

`packages/wizard/src/api.ts:1006-1018`

```ts
export async function listSchedules(): Promise<CheckupSchedule[]> {
  try {
    const res = await call('/api/runner/schedules');
    if (res.status === 401 || res.status === 403) {
      throw new RunnerError(SCHEDULES_OWNER_ONLY, 'ERR_FORBIDDEN');
    }
    return res.ok ? json<CheckupSchedule[]>(res) : [];
  } catch (err) {
    if (err instanceof RunnerError && err.code === 'ERR_FORBIDDEN') throw err;
    return [];
  }
}
```

`packages/wizard/src/screens/BenchmarkScreen.tsx:114`

```tsx
  const refreshHistory = useCallback(async () => setHistory(await listBenchmarks()), []);
```

`packages/wizard/tests/checkup-schedules.test.tsx:28-31` pins the old behaviour:

```ts
  it('keeps returning [] on other failures', async () => {
    stubFetch(500, {});
    expect(await listSchedules()).toEqual([]);
  });
```

## Change

1. `api.ts`: replace `listBenchmarks` with:

```ts
/** The running and kept comparisons, newest first, without their full results. Throws when they cannot be read. */
export async function listBenchmarks(): Promise<BenchmarkJob[]> {
  const res = await call('/api/runner/benchmarks');
  if (!res.ok) throw new RunnerError('The comparisons couldn’t be read. Try again.');
  return json<BenchmarkJob[]>(res);
}
```

2. `api.ts`: replace `listSchedules` with:

```ts
export async function listSchedules(): Promise<CheckupSchedule[]> {
  const res = await call('/api/runner/schedules');
  if (res.status === 401 || res.status === 403) {
    throw new RunnerError(SCHEDULES_OWNER_ONLY, 'ERR_FORBIDDEN');
  }
  if (!res.ok) throw new RunnerError('The scheduled check-ups couldn’t be read. Try again.');
  return json<CheckupSchedule[]>(res);
}
```

3. `BenchmarkScreen.tsx` line 114: a refresh after an action must not throw into an unhandled rejection. Replace with:

```tsx
  // A refresh that fails keeps the list already shown: the action it follows has its own message.
  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listBenchmarks());
    } catch {
      // keep the current list
    }
  }, []);
```

## Tests

Edit `packages/wizard/tests/checkup-schedules.test.tsx`. Replace the `keeps returning [] on other failures` case with:

```ts
  it('throws a plain error on other failures, so the screen can show it', async () => {
    stubFetch(500, {});
    const err = await listSchedules().catch((e) => e);
    expect(err).toBeInstanceOf(RunnerError);
    expect(err.message).toBe('The scheduled check-ups couldn’t be read. Try again.');
    expect(err.code).not.toBe('ERR_FORBIDDEN');
  });
```

Add, in the same file (import `listBenchmarks` from `'../src/api'`):

```ts
describe('listBenchmarks', () => {
  it('returns the list', async () => {
    stubFetch(200, []);
    expect(await listBenchmarks()).toEqual([]);
  });
  it('throws when the runner refuses', async () => {
    stubFetch(500, {});
    await expect(listBenchmarks()).rejects.toThrow('The comparisons couldn’t be read. Try again.');
  });
});
```

Run: `pnpm exec vitest run packages/wizard/tests/checkup-schedules.test.tsx packages/wizard/tests/sources-screens.test.tsx` then `pnpm build`.

## Done when

- [ ] With the runner down, the comparison screen shows its load error with Retry, and Settings shows the schedules error.
- [ ] 401/403 on schedules still gives the owner-only message.
- [ ] Tests and `pnpm build` pass.

## Notes

- `call()` itself may throw a `RunnerError` when the runner does not answer; that now reaches the screens, which already catch it.
- Run `grep -rn "listBenchmarks\|listSchedules" packages/wizard/src` before finishing: today there are exactly three call sites (`BenchmarkScreen.tsx:114`, `:121`, `SettingsScreen.tsx:887`), and `:121` and `:887` are already inside `try`. If you find another, wrap it in `try/catch`.
