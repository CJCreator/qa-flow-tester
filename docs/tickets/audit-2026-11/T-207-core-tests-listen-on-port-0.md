# T-207: Two core tests listen on port 0 instead of a fixed port

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | tests | bug | todo |

**Files you may edit (no others):**
- `packages/core/tests/access-control.test.ts`
- `packages/core/tests/preflight-result-truth.test.ts`

**Do not build in parallel with:** none.

## Problem
Both files start an `http.createServer` on a fixed port (3097 and 3540). Two runs on one machine (two
worktrees, or a second terminal) fail with `EADDRINUSE`. The neighbouring test files listen on port 0 and read
the port the OS gave them.

## Current code
`packages/core/tests/access-control.test.ts:17-18`
```ts
const PORT = 3097;
const BASE = `http://127.0.0.1:${PORT}`;
```
`packages/core/tests/access-control.test.ts:49-51`
```ts
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', () => r()));
});
```

`packages/core/tests/preflight-result-truth.test.ts:11-12`
```ts
const PORT = 3540;
const BASE = `http://localhost:${PORT}`;
```
`packages/core/tests/preflight-result-truth.test.ts:55`
```ts
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
```

## Change
1. `access-control.test.ts`
   - Replace lines 17-18 with:
     ```ts
     let BASE = '';
     ```
   - Replace the `beforeAll` at lines 49-51 with:
     ```ts
     beforeAll(async () => {
       await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
       const addr = server.address();
       BASE = `http://127.0.0.1:${addr && typeof addr === 'object' ? addr.port : 0}`;
     });
     ```
2. `preflight-result-truth.test.ts`
   - Replace lines 11-12 with:
     ```ts
     let BASE = '';
     ```
   - Replace line 55 with:
     ```ts
         await new Promise<void>((resolve) => server.listen(0, resolve));
         const addr = server.address();
         BASE = `http://localhost:${addr && typeof addr === 'object' ? addr.port : 0}`;
     ```
3. Change nothing else. `BASE` is only read inside `it(...)` bodies and inside the request handler, which run
   after `beforeAll`.

## Tests
```
pnpm exec vitest run packages/core/tests/access-control.test.ts packages/core/tests/preflight-result-truth.test.ts
pnpm typecheck
```
This grep must print nothing:
```
grep -n "\bPORT\b\|3097\|3540" packages/core/tests/access-control.test.ts packages/core/tests/preflight-result-truth.test.ts
```

## Done when
- [ ] Both files pass.
- [ ] No `PORT` constant and no fixed port number is left in either file.
- [ ] `pnpm typecheck` passes.

## Notes
- If `access-control.test.ts` reads `BASE` at module level (outside `it`, `beforeAll` or a function), stop and
  report it: that read would see the empty string. On branch `worktree-audit-cleanup` every read is inside an
  `it(...)` (lines 96, 115, 129, 140, 151, 165, 176, 188, 213).
- These servers are loopback only. Owner decision (2026-11-10): that is allowed in the unit tier (T-213).
