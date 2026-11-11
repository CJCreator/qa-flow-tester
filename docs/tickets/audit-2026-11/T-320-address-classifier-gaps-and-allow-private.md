# T-320: The address classifier knows 6to4, Teredo and the benchmark ranges, and allowPrivate follows the guard

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/address-class.ts`
- `packages/core/src/safe-net.ts`
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/core/tests/address-class.test.ts`
- `packages/core/tests/private-allowed-follows-guard.test.ts` (new)

**Do not build in parallel with:** T-326 (edits `safe-net.ts`); T-240, T-307, T-308 (all edit `crawl.ts`).

## Problem

Two separate gaps in the address rules (ADR 0014, ADR 0031).

**1. Addresses the classifier calls public.** `classifyV4` and `classifyV6` (`packages/core/src/address-class.ts:57-87`) miss:

- 6to4 `2002::/16`: the next 32 bits are an IPv4 address, so `2002:7f00:1::` carries `127.0.0.1` and `2002:a9fe:a9fe::` carries the metadata address. Today both are "public".
- Teredo `2001:0::/32`: a tunnel whose last 32 bits are the client's IPv4 address (inverted). Today "public".
- IPv4-translated `::ffff:0:a.b.c.d` (`::ffff:0:0/96`): `g[4]` is `0xffff`, so the "upper 80 bits zero" test at `:70`/`:77` fails and the embedded address is never looked at.
- `198.18.0.0/15` (network benchmarking) and `192.0.0.0/24` (IETF protocol assignments, including the NAT64 discovery addresses). Both are special-purpose (RFC 6890), never a website.

On the hosted copy this classifier decides which addresses the browser guard and the pinned client may reach.

**2. "A policy is set" is read as "a guard is set".** The comments say private addresses are refused when a **browser guard** is set (`packages/core/src/safe-net.ts:321-323`, `packages/core/src/checker-fetch.ts:9-10`). The code checks for **any** browser policy: `opts.allowPrivate !== false && getBrowserPolicy() === null` (`safe-net.ts:362`, `:550`), and the Website Audit crawl does the same (`packages/core/src/audit/crawl/crawl.ts:289`). On a local runner a Check-up of a host alias sets a policy with only `pinned` and no guard (`packages/runner/src/session/checkup-run.ts:686-689`), and the alias's address is `127.0.0.1`. From then on every checker fetch (security headers, robots.txt, broken links) of that run is refused as private, so those checks report nothing. The policy is global and is not cleared after the run, so a Website Audit of `localhost` started later on the same local runner is refused too.

## Current code

Branch from `main`.

`packages/core/src/address-class.ts` (`grep -n "function classifyV4\|function classifyV6\|upperZero" packages/core/src/address-class.ts`):

```ts
function classifyV6(g: number[]): AddressClass | null {
  const upperZero = g.slice(0, 5).every((x) => x === 0);
...
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): the embedded IPv4 decides.
  if (upperZero && (g[5] === 0xffff || g[5] === 0)) {
    return embedded();
  }
```

`packages/core/src/safe-net.ts` (`grep -n "getBrowserPolicy() === null" packages/core/src/safe-net.ts packages/core/src/audit/crawl/crawl.ts`):

```ts
    const allowPrivate = opts.allowPrivate !== false && getBrowserPolicy() === null;
...
        allowPrivate: opts.allowPrivate !== false && getBrowserPolicy() === null,
```

```ts
  const allowPrivate = opts.allowPrivateAddresses === true && getBrowserPolicy() === null;
```

## Change

1. `address-class.ts`:
   - `classifyV4`: before the multicast line add
     `if (a === 198 && (b === 18 || b === 19)) return 'multicast-reserved';` and
     `if (a === 192 && b === 0 && c === 0) return 'multicast-reserved';`
     with a comment "special-purpose ranges (RFC 6890): benchmarking, IETF protocol assignments".
   - `classifyV6`, after the NAT64 line:
     - IPv4-translated: `if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return embedded();`
     - 6to4: `if (g[0] === 0x2002) return classifyV4(g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255);` (the IPv4 address it carries decides).
     - Teredo: `if (g[0] === 0x2001 && g[1] === 0) return 'multicast-reserved';` (refused whole: a tunnel to an address the client hides, and no website is served from it). Note `2001:4860::` (Google) stays public: only `g[1] === 0` is Teredo.
   - Update the `AddressClass` comment so `'multicast-reserved'` reads "multicast, reserved or special-purpose".
2. `safe-net.ts`: add and export

   ```ts
   /**
    * Whether private addresses may be reached now: the caller allows it and no browser guard is set (a shared
    * machine, ADR 0014). A policy that only pins a host (a local alias) is not a guard.
    */
   export function privateAddressesAllowed(allow: boolean | undefined): boolean {
     return allow !== false && !getBrowserPolicy()?.guard;
   }
   ```

   and use it at `:362` (`const allowPrivate = privateAddressesAllowed(opts.allowPrivate);`) and `:550` (`allowPrivate: privateAddressesAllowed(opts.allowPrivate),`).
3. `crawl.ts:289`: `const allowPrivate = opts.allowPrivateAddresses === true && privateAddressesAllowed(true);` (import it from `../../safe-net.js`, already imported for `makeRequestGuard`).
4. Run `pnpm exec prettier --write` on the edited files, then `pnpm build`.

## Tests

`packages/core/tests/address-class.test.ts`, new cases:

- `it.each` refused, with their class: `2002:7f00:1::` → `loopback`; `2002:a00:1::1` → `private`; `2002:a9fe:a9fe::` → `metadata`; `2001:0:4136:e378:8000:63bf:3fff:fdd2` → `multicast-reserved`; `::ffff:0:7f00:1` → `loopback`; `::ffff:0:a00:1` → `private`; `198.18.0.1` and `198.19.255.255` → `multicast-reserved`; `192.0.0.170` → `multicast-reserved`.
- Still public: `2002:808:808::1` (6to4 of `8.8.8.8`), `198.17.255.255`, `198.20.0.1`, `192.0.1.1`, and the existing `2001:4860:4860::8888`.

New file `packages/core/tests/private-allowed-follows-guard.test.ts` (a fake `NetDeps` whose `lookup` returns `['127.0.0.1']` and whose `connect` records the request and answers 200; `afterEach(() => setBrowserPolicy(null))`):

- `privateAddressesAllowed`: `undefined` and `true` with no policy → true; `false` → false; with `setBrowserPolicy({ pinned: { 'app.test': '127.0.0.1' } })` → true; with `setBrowserPolicy({ guard: async () => true })` → false.
- `makeOutboundFetch({ deps })('http://app.test/')` with only a pin set: one connect to `127.0.0.1`, a response with status 200.
- The same with a guard set: no connect, the result is `null`.
- `makeGuardedFetch({ deps })('http://app.test/')` with only a pin set: answers 200; with a guard set: rejects with `GuardedFetchBlockedError`.

Run: `pnpm exec vitest run packages/core/tests/address-class.test.ts packages/core/tests/private-allowed-follows-guard.test.ts packages/core/tests/guarded-fetch.test.ts packages/core/tests/safe-net.test.ts packages/core/tests/browser-guard.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -rn "getBrowserPolicy() === null" packages/core/src/safe-net.ts packages/core/src/audit/crawl/crawl.ts` prints nothing.
- [ ] `grep -n "0x2002\|0x2001" packages/core/src/address-class.ts` finds the 6to4 and Teredo lines.
- [ ] The tests above and the core and runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding L17 (part) (audit of 11 Nov 2026 on `d225418`).
- `crawl.ts:289` was not named in the finding; it is the same rule and the same stale-policy effect on the Website Audit, so it is fixed here.
- Not in this ticket: `competitive/safe-crawler.ts` (`isPrivateHost` delegation is T-248; do not touch that file). Clearing the browser policy after a local Check-up is not needed once a pin alone no longer narrows the rule.
- Not added: the documentation ranges `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`. They are not routed on the internet, so a name resolving to them reaches nothing; add them later only if a test needs it.
- Related: T-307 and T-308 (WebSockets, service workers, a pinned egress proxy) build on the same classifier.
