# T-206: Runner tests take a free port instead of a fixed one

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | tests | bug | built |

**Files you may edit (no others):**
- `packages/runner/tests/helpers/free-port.ts` (new file)
- `packages/runner/tests/helper-wizard-access.test.ts`
- `packages/runner/tests/schedule-routes.test.ts`

**Do not build in parallel with:** none.

## Problem
Two `unit` files use the same fixed ports as two `browser` files. `pnpm test:all` runs both tiers in parallel,
so a run can fail with `EADDRINUSE`.

| unit file | ports | browser file with the same ports |
|---|---|---|
| `helper-wizard-access.test.ts` | 3571, 3572, 3573 | `beta.test.ts` (3571, 3572, 3573) |
| `schedule-routes.test.ts` (first `describe`) | 3761 | `audit-documents-flow.test.ts` (3761) |

Fixing the two unit files removes both collisions. The browser files are not changed.

`RunnerServer` cannot take port 0: `packages/runner/src/server.ts:772` is `this.port = options.port || 3001;`.
So a test asks the OS for a free port first, then passes that number. `health-route.test.ts:21-28` already does
this inline.

## Current code
`packages/runner/tests/helper-wizard-access.test.ts:16-18`
```ts
const KEYED_PORT = 3571;
const LOCAL_PORT = 3572;
const BETA_PORT = 3573;
```

`packages/runner/tests/helper-wizard-access.test.ts:89-91` (inside `beforeAll(async () => {`)
```ts
  const keys = new MemoryStore();
  keys.secrets.set('openrouter', SECRET);
  keyed = new RunnerServer({
```

`packages/runner/tests/schedule-routes.test.ts:113-124`
```ts
describe('POST /api/runner/schedules/tick (non-beta)', () => {
  const PORT = 3761;
  const store = memoryStore([
    sched({ id: 'sched_1_due', name: 'due' }),
    sched({ id: 'sched_2_off', enabled: false }),
    sched({ id: 'sched_3_later', nextRunAt: new Date(Date.now() + 3_600_000).toISOString() }),
  ]);
  let server: RunnerServer;
  let run: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    server = new RunnerServer({
```

## Change
1. Create `packages/runner/tests/helpers/free-port.ts` with exactly:
   ```ts
   import http from 'http';

   /**
    * A free loopback port, picked by the OS. RunnerServer reads port 0 as "use 3001", so a test asks for a
    * real number first. Ask for several at once with Promise.all: each probe holds its port until all answer.
    */
   export function freePort(): Promise<number> {
     return new Promise((resolve, reject) => {
       const probe = http.createServer();
       probe.once('error', reject);
       probe.listen(0, '127.0.0.1', () => {
         const addr = probe.address();
         const port = addr && typeof addr === 'object' ? addr.port : 0;
         probe.close(() => resolve(port));
       });
     });
   }
   ```
2. `helper-wizard-access.test.ts`:
   - Add after the line `import { RunnerServer } from '../src/server.js';`:
     ```ts
     import { freePort } from './helpers/free-port.js';
     ```
   - Replace lines 16-18 with:
     ```ts
     let KEYED_PORT = 0;
     let LOCAL_PORT = 0;
     let BETA_PORT = 0;
     ```
   - Insert immediately before the line `  const keys = new MemoryStore();`:
     ```ts
       [KEYED_PORT, LOCAL_PORT, BETA_PORT] = await Promise.all([freePort(), freePort(), freePort()]);

     ```
3. `schedule-routes.test.ts`:
   - Add `import { freePort } from './helpers/free-port.js';` after the last existing `import` line at the top.
   - In the first `describe` only, change `  const PORT = 3761;` to `  let PORT = 0;`.
   - In that `describe`'s `beforeAll`, insert `    PORT = await freePort();` as the first line, before
     `    server = new RunnerServer({`.
   - Leave the other three `describe` blocks (ports 3762, 3763, 3764) as they are: no other file uses them.

## Tests
```
pnpm exec vitest run packages/runner/tests/helper-wizard-access.test.ts packages/runner/tests/schedule-routes.test.ts
pnpm typecheck
pnpm lint
```
This grep must print nothing:
```
grep -n "357[1-3]\|3761" packages/runner/tests/helper-wizard-access.test.ts packages/runner/tests/schedule-routes.test.ts
```

## Done when
- [x] Both test files pass.
- [x] Neither file contains 3571, 3572, 3573 or 3761.
- [x] `pnpm typecheck` passes and `pnpm lint` reports no errors.

## Notes
- Every use of the three ports is inside an `it(...)` or inside `beforeAll`, so they are read after they are set.
- `prefer-const` does not fire: the variables are reassigned.
- Do not change `RunnerServer` to accept port 0. Out of scope.
- Owner decision (2026-11-10): unit tests may start loopback servers on an OS-assigned port (see T-213).
