# T-301: Beta and audit quotas survive a restart, and the trusted forwarded hop is configurable

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | runner | security | todo |

**Files you may edit (no others):**

- `packages/runner/src/usage-ledger.ts` (new)
- `packages/runner/src/beta.ts`
- `packages/runner/src/helpers/audit-limit.ts`
- `packages/runner/src/server.ts`
- `docs/CONFIGURATION.md`
- `.env.example`
- `packages/runner/tests/usage-ledger.test.ts` (new)
- `packages/runner/tests/client-address.test.ts` (new)

**Do not build in parallel with:** T-259, T-299, T-300 (all edit `beta.ts`); T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-299, T-300, T-302, T-303, T-308, T-313, T-329, T-331, T-357 (all edit `server.ts`); T-300, T-302, T-313, T-373 (all edit `CONFIGURATION.md`); T-373 (edits `.env.example`).

## Problem

Every limit on the hosted copy lives in process memory:

- The copy's count of check-up starts for the day: `let dayUsage` (`packages/runner/src/beta.ts:166`, "Memory only: a restart starts it again").
- Each visitor's count: `Session.usage` (`beta.ts:35`), inside the in-memory visitor sessions.
- Website Audit starts per owner email (`AUDIT_DAILY_LIMIT`): the `usage` Map of `AuditDailyLimiter` (`packages/runner/src/helpers/audit-limit.ts:14`).

A restart sets them all to zero. The hosted copy restarts on every deploy (each push to `main`), when Cloud Run replaces the instance, and after a crash. So the day cap of 40 and the audit cap can be spent again after each restart. The per-visitor count is lost too, but so is the visitor's session (the cookie names a session the new process does not know), so persisting that count alone would not help; the day cap is what bounds the copy.

The new-session limit (20 new visitor sessions per address per 10 minutes, `beta.ts:83`, `:117`) keys on `clientAddress`, which takes the last `X-Forwarded-For` entry (`beta.ts:88-92`). That is right when exactly one trusted proxy (Cloud Run's front end) appends the client's address. If a load balancer is put in front of Cloud Run, the last entry is the balancer's address, every visitor falls into one bucket, and the 21st new visitor in 10 minutes is refused.

Not a problem: the `AuditDailyLimiter` Map has no eviction, but its keys are owner emails (the short `AUDIT_OWNER_EMAILS` list), and `claim` without an email is allowed on purpose (`audit-limit.ts:24`: callers pass an email only on the hosted copy, `packages/runner/src/routes/audit-crawl.ts:508`).

## Owner decision (open)

Where do the copy's day count and the audit starts per owner live?

- **A. In the audit store backend (recommended default).** One small object, `limits/usage.json`: Cloud Storage on the hosted copy (the same bucket as audits and schedules, ADR 0036 / 0039), a file under `<RUNNER_DATA_DIR>/audit-store/` locally. Loaded when the runner starts, written after each counted start. Owner emails are stored as SHA-256 hashes, like the Helper index. Per-visitor counts stay in memory (their sessions do too).
- **B. Keep memory only and say so.** Document in `docs/CONFIGURATION.md` that a restart or redeploy resets the day cap and `AUDIT_DAILY_LIMIT`. No code change for the counts.

The forwarded-hop setting is built either way: `RUNNER_TRUSTED_PROXY_HOPS`, default `1` (Cloud Run's front end, today's behaviour).

This ticket builds A unless the owner picks another option.

## Current code

Branch from `main`.

`packages/runner/src/beta.ts` (`grep -n "let dayUsage\|function clientAddress" packages/runner/src/beta.ts`):

```ts
/** The client address: the last X-Forwarded-For entry (added by the nearest proxy) or the socket's. */
function clientAddress(req: http.IncomingMessage): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)?.split(',').pop()?.trim();
  return last || req.socket?.remoteAddress || 'unknown';
}
```

```ts
// The whole shared copy's count for one UTC day. Memory only: a restart starts it again.
let dayUsage: { day: string; count: number } = { day: '', count: 0 };
```

`packages/runner/src/helpers/audit-limit.ts`:

```ts
export class AuditDailyLimiter {
  private limit?: number;
  private usage = new Map<string, { day: string; count: number }>();
  ...
  claim(email?: string): AuditLimitOutcome {
    if (!this.limit) return { allowed: true };
    if (!email) return { allowed: true };
    const norm = email.trim().toLowerCase();
```

`packages/runner/src/server.ts`: the limiter and the claims (`grep -n "claimAuditLimit: (email) =>\|const hit = claimBetaRun" packages/runner/src/server.ts`):

```ts
      claimAuditLimit: (email) => this.auditLimiter.claim(email),
```

```ts
  private betaLimitHit(res: http.ServerResponse): boolean {
    if (!this.beta) return false;
    const hit = claimBetaRun(currentSessionId(), { limits: this.betaLimits });
    if (!hit) return false;
```

`start()` (`grep -n "await this.ensurePlanLoaded();" packages/runner/src/server.ts`, the first hit) awaits `auditRecoveryDone`, `moveLegacyData`, `ensurePlanLoaded` and `loadLatestReport` before listening. The audit store is built in the constructor (`const auditStore = createAuditStore(selectAuditStoreBackend({ dataDir: this.dataDir }))`), and `BackendScheduleStore` (`packages/runner/src/scheduler.ts:78`) already keeps one JSON object in that backend.

## Change

1. `helpers/audit-limit.ts`: key the `usage` Map by a hash of the normalised email, and add a snapshot and a restore:

```ts
import { createHash } from 'crypto';

/** The key an owner email is counted (and stored) under: SHA-256 of the trimmed, lower-cased email. */
export function ownerKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
```

   In `claim`, use `const key = ownerKey(email);` in place of `norm`. Add:

```ts
  /** Today's counts per owner key, for the usage ledger (T-301). */
  snapshot(day: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, record] of this.usage) if (record.day === day) out[key] = record.count;
    return out;
  }

  /** Puts back stored counts for `day`; a count already higher in memory is kept. */
  restore(day: string, counts: Record<string, number>): void {
    for (const [key, count] of Object.entries(counts)) {
      const known = this.usage.get(key);
      if (!known || known.day !== day || known.count < count) this.usage.set(key, { day, count });
    }
  }
```

2. `beta.ts`: export the day count and a restore:

```ts
/** The copy's count for today (a copy, for the usage ledger, T-301). */
export function betaDayUsage(now: number = Date.now()): { day: string; count: number } {
  const day = utcDay(now);
  return { day, count: dayUsage.day === day ? dayUsage.count : 0 };
}

/** Puts back a stored count for today; a higher count already in memory is kept. */
export function restoreBetaDayUsage(stored: { day: string; count: number }, now: number = Date.now()): void {
  const day = utcDay(now);
  if (stored.day !== day) return;
  if (dayUsage.day !== day) dayUsage = { day, count: 0 };
  dayUsage.count = Math.max(dayUsage.count, stored.count);
}
```

   and change the comment above `let dayUsage` to "The whole shared copy's count for one UTC day. Also kept in the audit store by the runner (T-301), so a restart does not reset it."

3. `beta.ts`, the trusted hop. Replace `clientAddress` with an exported version:

```ts
/**
 * How many trusted proxies in front of the runner append to X-Forwarded-For (RUNNER_TRUSTED_PROXY_HOPS).
 * Default 1: Cloud Run's front end. 0 ignores the header and uses the socket address. At most 5.
 */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const raw = env.RUNNER_TRUSTED_PROXY_HOPS?.trim();
  return raw !== undefined && /^[0-5]$/.test(raw) ? Number(raw) : 1;
}

/** The client address: the X-Forwarded-For entry the outermost trusted proxy added, or the socket's. */
export function clientAddress(req: http.IncomingMessage, hops: number = trustedProxyHops()): string {
  const socket = req.socket?.remoteAddress || 'unknown';
  if (hops === 0) return socket;
  const forwarded = req.headers?.['x-forwarded-for'];
  const entries = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries[entries.length - hops] || socket;
}
```

4. New file `packages/runner/src/usage-ledger.ts`:

```ts
import type { AuditStoreBackend } from '@qa/core';

/** Where the counts that must survive a restart are kept in the audit store (T-301). */
export const USAGE_KEY = 'limits/usage.json';

/** Today's copy-wide check-up starts and Website Audit starts per owner key (ownerKey, a hash, never an email). */
export interface StoredUsage {
  day: string;
  copyStarts: number;
  auditStarts: Record<string, number>;
}

export class UsageLedger {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly backend: Pick<AuditStoreBackend, 'getJson' | 'putJson'>) {}

  /** The stored counts for `day`, or null when there are none for that day, or they cannot be read. */
  async load(day: string): Promise<StoredUsage | null> { ... }

  /** Queues a write of the latest counts, one write at a time. A failure is logged with fixed text, never thrown. */
  save(usage: StoredUsage): Promise<void> { ... }

  /** Resolves when every queued write has finished (tests, shutdown). */
  flush(): Promise<void> {
    return this.queue;
  }
}
```

   `load` checks the shape (a `day` string equal to `day`, a non-negative whole `copyStarts`, `auditStarts` an object of non-negative whole numbers) and returns null otherwise; it catches a backend error, logs `[Release check-up] Couldn’t read the saved usage counts; starting from zero.` and returns null. `save` chains `this.backend.putJson(USAGE_KEY, usage)` onto `queue` and catches with `[Release check-up] Couldn’t save the usage counts.` The log lines never include the error text (it could name the bucket).

5. `server.ts`:
   - Imports: `UsageLedger` from `./usage-ledger.js`; `betaDayUsage`, `restoreBetaDayUsage` from `./beta.js`.
   - A field `private usageLedger: UsageLedger;`, set in the constructor right after `auditStore` is created: `this.usageLedger = new UsageLedger(auditStore.backend);`.
   - A private method:

```ts
  /** Writes today's counted starts to the audit store, so a restart keeps them (T-301). */
  private saveUsage(): void {
    const today = betaDayUsage();
    void this.usageLedger.save({
      day: today.day,
      copyStarts: today.count,
      auditStarts: this.auditLimiter.snapshot(today.day),
    });
  }
```

   - In `start()`, after `await this.auditRecoveryDone;`:

```ts
    // Today's counts from before a restart (T-301). Unreadable or another day's: start from zero.
    const today = betaDayUsage();
    const stored = await this.usageLedger.load(today.day);
    if (stored) {
      restoreBetaDayUsage({ day: stored.day, count: stored.copyStarts });
      this.auditLimiter.restore(stored.day, stored.auditStarts);
    }
```

   - `betaLimitHit`: change `if (!hit) return false;` to `if (!hit) { this.saveUsage(); return false; }`.
   - The wiring: `claimAuditLimit: (email) => { const outcome = this.auditLimiter.claim(email); if (outcome.allowed && email && this.auditDailyLimit) this.saveUsage(); return outcome; },`.

6. `docs/CONFIGURATION.md`:
   - `RUNNER_BETA_RUNS_PER_VISITOR`: keep "Memory only; a restart resets it" and add "(a restart also forgets the visitor's session)".
   - `RUNNER_BETA_RUNS_PER_DAY`: add "Kept in the audit store (`limits/usage.json`; Cloud Storage on the hosted copy), so a restart or redeploy keeps the day's count."
   - `AUDIT_DAILY_LIMIT`: add the same sentence.
   - New row after `RUNNER_BETA_RUNS_PER_DAY`: `RUNNER_TRUSTED_PROXY_HOPS` | `1` | "How many trusted proxies in front of the runner add to `X-Forwarded-For`. `1` is Cloud Run's own front end; set `2` with a load balancer in front of Cloud Run; `0` ignores the header. Used for the per-address limit on new visitor sessions on a beta copy. Whole number 0 to 5; anything else uses the default".

7. `.env.example`: after `# RUNNER_BETA_RUNS_PER_DAY=40` add:

```
# Beta only: trusted proxies in front of the runner that add to X-Forwarded-For (default 1: Cloud Run's front end)
# RUNNER_TRUSTED_PROXY_HOPS=1
```

8. Run `pnpm exec prettier --write` on the changed files and the new tests, then `pnpm build`.

If the owner picks **B**: skip steps 1, 2, 4 and 5; in step 6 write "Memory only; a restart or redeploy resets it" on `RUNNER_BETA_RUNS_PER_DAY` and `AUDIT_DAILY_LIMIT`; keep steps 3, 6 (the new row) and 7, and only the `client-address.test.ts` test.

## Tests

New file `packages/runner/tests/usage-ledger.test.ts` (unit tier). A fake backend: a `Map` behind `getJson`/`putJson`.

- `save` then `load(day)` gives the same object; `load` of another day gives null; a stored `{ day, copyStarts: -1 }` or `'x'` gives null; a `getJson` that throws gives null and logs a line that does not contain the thrown message.
- A `putJson` that rejects: `save` resolves and `flush()` resolves (nothing thrown).
- `AuditDailyLimiter({ limit: 2 })`: after `restore(today, { [ownerKey('a@x.com')]: 2 })`, `claim(' A@X.com ')` is refused; `snapshot(today)` has that key with 2; a restore with a lower count does not lower a higher one in memory.
- `restoreBetaDayUsage({ day: today, count: 40 })`, then `claimBetaRun(undefined, { limits: { perVisitor: 5, perDay: 40 } })` returns a hit with `scope: 'day'`; a stored count for yesterday changes nothing. The day count is module state shared by the whole file: call `resetBetaUsage()` in `afterEach`.
- Through a runner: write `{ day: today, copyStarts: 3, auditStarts: {} }` to `limits/usage.json` with `new LocalAuditStoreBackend(dataDir)` (from `../../core/src/audit/store/index.js`), start a `RunnerServer` with `beta: true`, that `dataDir` and `betaLimits: { perVisitor: 5, perDay: 3 }` on `await freePort()`, then call its private `betaLimitHit` through a cast (as `beta-privacy.test.ts` reaches into the server) with a stub response that records `writeHead` and `end`: it answers 429. Stop each server in `afterEach`. With `perDay: 4` instead, it allows one start, and after `await` of the ledger's `flush()` (through the same cast) the stored `copyStarts` is 4.

New file `packages/runner/tests/client-address.test.ts` (unit tier):

- `trustedProxyHops({})` is 1; `'0'` is 0; `'2'` is 2; `'9'`, `'-1'`, `'two'` are 1.
- `X-Forwarded-For: 'spoofed, 203.0.113.7'`, hops 1: `203.0.113.7`. `'203.0.113.7, 10.0.0.1'`, hops 2: `203.0.113.7`. Hops 0: the socket address. One entry with hops 2: the socket address. No header: the socket address; no socket either: `'unknown'`.

Run: `pnpm exec vitest run packages/runner/tests/usage-ledger.test.ts packages/runner/tests/client-address.test.ts packages/runner/tests/helper-access.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "USAGE_KEY = 'limits/usage.json'" packages/runner/src/usage-ledger.ts` finds the key.
- [ ] `grep -n "this.saveUsage()" packages/runner/src/server.ts` finds the two counted paths.
- [ ] `grep -n "export function clientAddress\|export function trustedProxyHops" packages/runner/src/beta.ts` finds both.
- [ ] `docs/CONFIGURATION.md` lists `RUNNER_TRUSTED_PROXY_HOPS` and says which counts survive a restart.
- [ ] The two new tests, `helper-access.test.ts` and the runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M2 (audit of 11 Nov 2026 on `d225418`).
- Scaling out is not a concern today: the runner is one instance (`--max-instances 1`, ADR 0036 / 0039 amendment). With more instances the ledger's last write would win; a shared counter would then need a new decision.
- Check after deploy: Cloud Run's front end appends the client address as the last `X-Forwarded-For` entry; that is what today's code and the default of 1 assume. If a load balancer is ever added, set `RUNNER_TRUSTED_PROXY_HOPS=2` in `.github/workflows/deploy.yml` (not in this ticket).
- Related: T-300 adds sign-in tests and Smoke Check-ups to the counted starts and edits `beta.ts` and the same `docs/CONFIGURATION.md` rows; T-302 edits the dispatch lines around `sessionFor` in `server.ts`.
