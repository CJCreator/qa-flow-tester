# T-248: `isPrivateHost` uses the shared address classifier

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | core | bug | todo |

**Files you may edit (no others):**

- `packages/core/src/competitive/safe-crawler.ts`
- `packages/core/tests/private-host.test.ts` (new)

**Do not build in parallel with:** T-240 (edits `safe-crawler.ts`).

## Problem

`isPrivateHost` in `competitive/safe-crawler.ts` decides "is this address on this computer or a private network?" with five regular expressions. `address-class.ts` (ADR 0014) already has the full classifier (`classifyAddress`, `isPrivateTextHost`). The copy is weaker:

- It misses `169.254.0.0/16` (link-local, includes the cloud metadata address `169.254.169.254`), `0.0.0.0`, `100.64.0.0/10`, IPv6 `fc00::/7` and `fe80::/10`, and IPv4 inside IPv6 (`::ffff:10.0.0.1`).
- It treats a public name that starts with a number and a dot, such as `10.example.com`, as private.

Where it is used: the beta (shared machine) refusal in `post-deploy-smoke.ts` (`169.254.169.254` is let through that check), "is this our own machine" in the discovery crawl and `runner/routes/plan.ts` (skip robots.txt and the page delay), `live-site.ts` `isTestHost` (which patches some of the gaps itself), `runner/src/beta.ts`, `server.ts`, `benchmarks.ts` and `checkup-run.ts`.

## Current code

Branch from `main`. `packages/core/src/competitive/safe-crawler.ts` (`grep -n "export function isPrivateHost" packages/core/src/competitive/safe-crawler.ts`):

```ts
/** This machine, a private network address, or Docker's name for the host. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === 'host.docker.internal' ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}
```

`packages/core/src/address-class.ts` (import-free, pure) exports:

```ts
export function classifyAddress(address: string): AddressClass | null; // null: public, or not an IP
export function isPrivateTextHost(hostname: string): boolean; // localhost, *.localhost, host.docker.internal
```

`classifyAddress` accepts brackets and zone ids, and returns a class for loopback, private, link-local, metadata, unique-local, carrier-nat, unspecified and multicast-reserved addresses.

## Change

1. In `safe-crawler.ts` add `import { classifyAddress, isPrivateTextHost } from '../address-class.js';` with the other imports, and replace the function body:

```ts
/** This machine, a private network address, or Docker's name for the host (the shared classifier, ADR 0014). */
export function isPrivateHost(hostname: string): boolean {
  return isPrivateTextHost(hostname) || classifyAddress(hostname) !== null;
}
```

2. Run `pnpm exec prettier --write packages/core/src/competitive/safe-crawler.ts packages/core/tests/private-host.test.ts`, then `pnpm build`.

## Tests

New file `packages/core/tests/private-host.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPrivateHost } from '../src/competitive/safe-crawler.js';

describe('isPrivateHost', () => {
  it.each([
    'localhost',
    'app.localhost',
    'host.docker.internal',
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.5',
    '172.20.0.1',
    '[::1]',
    '::1',
    '169.254.169.254',
    '169.254.1.1',
    '0.0.0.0',
    '100.64.0.1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('%s is private', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(['example.com', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '10.example.com'])('%s is public', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});
```

Run: `pnpm exec vitest run packages/core/tests/private-host.test.ts packages/core/tests/safe-crawler-guard.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "/\^127" packages/core/src/competitive/safe-crawler.ts` prints nothing.
- [ ] The new test passes; the core and runner unit tests pass; `pnpm build` passes.

## Notes

- Behaviour change to expect: addresses such as `169.254.x.x` and `fd00::1` now count as "this machine or a private network" everywhere `isPrivateHost` is used. For the discovery crawl that means no robots.txt fetch and no page delay for them, the same as `localhost`. `isTestHost` already treated them as test copies.
- Not in this ticket: removing the lines in `live-site.ts` `isTestHost` that now repeat what `isPrivateHost` covers (`0.0.0.0`, `fc00::/7`, `169.254.`). They are harmless. A later cleanup can drop them.
- If a runner unit test fails because it used `169.254...` or `100.64...` as a "public" address, change that test address to `8.8.8.8` and say so in the PR.
