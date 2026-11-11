# T-307: The browser guard covers WebSockets and blocks service workers in every context

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | M | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/browser.ts`
- `packages/core/src/competitive/safe-crawler.ts`
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/core/tests/browser-sockets-and-workers.test.ts` (new)
- `packages/core/tests/browser-guard.test.ts`
- `packages/core/tests/audit-crawl-retry.test.ts`
- `packages/core/tests/safe-crawler-guard.test.ts`

**Do not build in parallel with:** T-251, T-308, T-312, T-358 (all edit `browser.ts`); T-240, T-248, T-308 (all edit `safe-crawler.ts`); T-240, T-308, T-320 (all edit `crawl.ts`).

## Problem

On the hosted copy every browser request must reach only public addresses (ADR 0014). The address guard is a Playwright `context.route('**/*')` handler (`installRequestGuard`, `packages/core/src/browser.ts:67-82`), and the read-only rule for a live App is another one (`blockChanges`, `packages/core/src/live-site.ts:94-107`). Playwright routes do not see three kinds of traffic:

- **WebSockets.** A route never sees a WebSocket handshake. `makeRequestGuard` already accepts `ws:` and `wss:` (`packages/core/src/safe-net.ts:470`), so the intent is clear, but nothing asks it: `routeWebSocket` appears 0 times in `packages/`. A checked page can open `new WebSocket('ws://10.0.0.5:8080/')` or reach a service on the runner's own network.
- **Service workers.** Requests a service worker makes do not pass through `context.route`. The Website Audit's own browser blocks them (`packages/core/src/audit/crawl/crawl.ts:363-364`, with that reason in the comment), but `BrowserManager.createContext` (`browser.ts:144-156`), which every Check-up, sign-in test and the audit's shared-browser path use, does not. Nor does the Competitive Benchmark crawler (`packages/core/src/competitive/safe-crawler.ts:184-187`). A service worker can also send the POST that `blockChanges` is meant to stop on a live App.
- **WebRTC.** A page can send STUN/TURN packets to any address with `RTCPeerConnection`. No Chromium flag limits it (`browser.ts:117-127`, `crawl.ts:64-70`, `safe-crawler.ts:178-181`).

The only pin is `--host-resolver-rules` for the start host (`browser.ts:125`, `crawl.ts:354`). This ticket is the interim fix; T-308 decides on a pinned proxy that closes the rest (DNS rebinding of other hosts, sockets opened from Web Workers).

## Current code

Branch from `main`.

`packages/core/src/browser.ts` (`grep -n "export async function installRequestGuard" packages/core/src/browser.ts`):

```ts
export async function installRequestGuard(
  context: BrowserContext,
  guard: (url: string, redirected: boolean) => Promise<boolean>
): Promise<void> {
  await context.route('**/*', async (route) => {
    ...
    if (!allowed) return route.abort('blockedbyclient');
    return route.fallback();
  });
}
```

`grep -n "ignoreHTTPSErrors: true" packages/core/src/browser.ts` (the context options, no `serviceWorkers`):

```ts
      baseURL: options.baseUrl,
      ignoreHTTPSErrors: true,
      storageState: options.storageState as NonNullable<Parameters<Browser['newContext']>[0]>['storageState'],
```

`grep -n "disable-extensions" packages/core/src/browser.ts packages/core/src/audit/crawl/crawl.ts` (the Chromium flags), and `packages/core/src/competitive/safe-crawler.ts` (`grep -n "chromium.launch" packages/core/src/competitive/safe-crawler.ts`):

```ts
    const browser = await chromium.launch({
      headless: options.headless !== false,
      args: pinned.length ? [`--host-resolver-rules=${pinned.join(', ')}`] : [],
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ${USER_AGENT_TOKEN}/1.0`,
      });
```

Playwright 1.63 (`packages/core/package.json`) has `BrowserContext.routeWebSocket(url, handler)`. In the handler, `ws.url()` is the socket address, `ws.connectToServer()` lets it through, and `ws.close({ code, reason })` closes it. A handler that does neither leaves a fake open socket, so the handler must always do one of the two.

## Change

1. `browser.ts`: export the WebRTC flag next to `BREAKPOINT_VIEWPORTS`:

```ts
/** No direct UDP for WebRTC: STUN/TURN packets cannot reach addresses the request guard never sees. */
export const WEBRTC_NO_DIRECT_UDP = '--force-webrtc-ip-handling-policy=disable_non_proxied_udp';
```

2. `browser.ts`, `installRequestGuard`: after the `context.route(...)` call, guard WebSockets too. A later `routeWebSocket` on the same context would replace an earlier one, so keep one socket route per context that asks every guard installed on it:

```ts
type RequestGuard = (url: string, redirected: boolean) => Promise<boolean>;
/** Every guard installed on a context; its one WebSocket route asks all of them. */
const socketGuards = new WeakMap<BrowserContext, RequestGuard[]>();
```

and at the end of `installRequestGuard`:

```ts
  // route() never sees a WebSocket handshake: the same guard decides, and a refused socket is closed.
  const guards = socketGuards.get(context);
  if (guards) {
    guards.push(guard);
    return;
  }
  socketGuards.set(context, [guard]);
  await context.routeWebSocket(/.*/, async (ws) => {
    let allowed = false;
    try {
      const all = socketGuards.get(context) ?? [];
      allowed = (await Promise.all(all.map((g) => g(ws.url(), false)))).every(Boolean);
    } catch {
      allowed = false;
    }
    if (!allowed) return ws.close({ code: 1008, reason: 'Blocked: not a public address' });
    ws.connectToServer();
  });
```

3. `browser.ts`, `createContext`: add `serviceWorkers: 'block' as const,` to `contextOptions` with the comment `// route() never sees a service worker's requests: blocked, so every request passes the guard and blockChanges.` The video path spreads `contextOptions`, so it is covered too.

4. `browser.ts`, `BrowserManager.launch`: in the Chromium `args`, add `...(browserPolicy?.guard ? [WEBRTC_NO_DIRECT_UDP] : [])` after `--disable-extensions`. Only a shared machine (a guard is set) loses direct WebRTC; the pins are read at launch the same way.

5. `crawl.ts`: import `WEBRTC_NO_DIRECT_UDP` with the other `../../browser.js` imports and add it as the last entry of `CHROMIUM_ARGS`. The audit only reads pages, so it needs no WebRTC on any machine.

6. `safe-crawler.ts`: import `WEBRTC_NO_DIRECT_UDP` with `getBrowserPolicy, installRequestGuard`. Launch with `args: [WEBRTC_NO_DIRECT_UDP, ...(pinned.length ? [`--host-resolver-rules=${pinned.join(', ')}`] : [])]`, and add `serviceWorkers: 'block',` to its `newContext` options.

7. Run `pnpm exec prettier --write` on the changed source and test files, then `pnpm build`.

## Tests

New file `packages/core/tests/browser-sockets-and-workers.test.ts` (unit tier, no Chromium). Mock Playwright as `safe-crawler-guard.test.ts` does: `vi.mock('playwright', () => ({ chromium: { launch: (...a) => launch(...a) }, webkit: {}, firefox: {} }))`, where `launch` resolves to a fake browser `{ newContext, isConnected: () => true, close }`, and `newContext` resolves to a fake context `{ route: async () => {}, routeWebSocket: async (_p, h) => { socketHandlers.push(h); } }`. A fake socket is `{ url: () => address, close: vi.fn(async () => {}), connectToServer: vi.fn() }`. Use a fake lookup like `fakeLookup` in `browser-guard.test.ts` with `makeRequestGuard(deps)`. `afterEach(() => setBrowserPolicy(null))`.

- "every BrowserManager context blocks service workers": `await new BrowserManager().createContext({ baseUrl: 'https://a.test' })`; `newContext` was called with `expect.objectContaining({ serviceWorkers: 'block' })`.
- "a shared machine's Chromium has no direct WebRTC UDP": `setBrowserPolicy({ guard: async () => true })`, then `createContext`; `launch.mock.calls[0][0].args` contains `WEBRTC_NO_DIRECT_UDP`. With no policy (a new `BrowserManager`) the args do not contain it.
- "a WebSocket to a private address is closed": `installRequestGuard(ctx, makeRequestGuard(deps))` with `bad.test` resolving to `10.0.0.1`; call the recorded handler with a fake socket for `wss://bad.test/live`. `close` was called with `expect.objectContaining({ code: 1008 })`; `connectToServer` was not called.
- "a WebSocket to a public address connects": `ok.test` resolves to `8.8.8.8`; `connectToServer` called once, `close` not called.
- "a loopback socket is closed without a lookup": `ws://127.0.0.1:9222/devtools/browser` is closed.
- "a guard that throws closes the socket (fail closed)".
- "two guards on one context share one socket route": install two guards (the first allows all, the second is `makeRequestGuard(deps)`); `routeWebSocket` was called once, and a socket to `bad.test` is closed.

`packages/core/tests/browser-guard.test.ts`: add `routeWebSocket: async () => {}` to `fakeContext()`'s object (the guard now registers a socket route). No assertion changes.

`packages/core/tests/audit-crawl-retry.test.ts`: add `routeWebSocket: async () => {}` to the fake `context` object.

`packages/core/tests/safe-crawler-guard.test.ts`: the two `args` expectations become `[WEBRTC_NO_DIRECT_UDP, '--host-resolver-rules=MAP example.com 93.184.216.34']` and `[WEBRTC_NO_DIRECT_UDP]` (import it from `../src/browser.js`). Hold `newContext` in a `const` and assert `newContext.mock.calls[0][0]` matches `{ serviceWorkers: 'block' }`.

Run: `pnpm exec vitest run packages/core/tests/browser-sockets-and-workers.test.ts packages/core/tests/safe-crawler-guard.test.ts packages/core/tests/audit-crawl-retry.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`. `browser-guard.test.ts` is in the browser tier (`BROWSER_TESTS`); run it with `pnpm exec vitest run --project browser packages/core/tests/browser-guard.test.ts` if Chromium is installed, otherwise leave it to the nightly run and say so in the PR.

## Done when

- [ ] `grep -n "routeWebSocket" packages/core/src/browser.ts` finds the socket route in `installRequestGuard`.
- [ ] `grep -n "serviceWorkers: 'block'" packages/core/src/browser.ts packages/core/src/competitive/safe-crawler.ts packages/core/src/audit/crawl/crawl.ts` finds all three.
- [ ] `grep -rn "WEBRTC_NO_DIRECT_UDP" packages/core/src` finds `browser.ts`, `crawl.ts` and `safe-crawler.ts`.
- [ ] The new test and the core and runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding H6, interim part (audit of 11 Nov 2026 on `d225418`). T-308 is the full fix and decides on a pinned egress proxy.
- Residual risk this ticket does not close, for T-308: Playwright routes a WebSocket by replacing `WebSocket` in each page frame, so a socket opened from a Web Worker is probably not routed (check this while building and say what you found in the PR). The guard resolves the name, then Chromium resolves it again, so a host other than the pinned start host can still be rebound between the two lookups. `disable_non_proxied_udp` stops UDP; a TURN-over-TCP connection is still possible.
- Not in this ticket: WebSocket messages on a live App are not read-only checked (`blockChanges` covers HTTP methods only). That is a separate decision about read-only mode.
- `packages/core/src/audit/documents/render-pdf.ts` already blocks service workers and runs offline: not touched.
- T-248 and T-240 also edit `safe-crawler.ts`; T-312 builds after this ticket (`browser.ts`).
