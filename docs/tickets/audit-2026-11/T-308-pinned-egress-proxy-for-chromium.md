# T-308: Decide, then build, a pinned egress proxy for Chromium

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | L | core | security | todo |

**Files you may edit (no others):**

- `docs/adr/0045-pinned-egress-proxy-for-chromium.md` (new)
- `docs/adr/0014-verified-domains-and-safe-host-classification.md`
- `SECURITY.md`
- `packages/core/src/egress-proxy.ts` (new)
- `packages/core/src/index.ts`
- `packages/core/src/browser.ts`
- `packages/core/src/audit/crawl/crawl.ts`
- `packages/core/src/competitive/safe-crawler.ts`
- `packages/runner/src/server.ts`
- `packages/runner/src/session/checkup-run.ts`
- `packages/core/tests/egress-proxy.test.ts` (new)
- `packages/core/tests/egress-proxy-browser.test.ts` (new)
- `vitest.workspace.ts`

(Option B needs only the ADR, the ADR 0014 line and `SECURITY.md`.)

**Do not build in parallel with:** T-385 (edits `SECURITY.md`); T-250 (edits `index.ts`); T-251, T-307, T-312, T-358 (all edit `browser.ts`); T-240, T-307, T-320 (all edit `crawl.ts`); T-240, T-248, T-307 (all edit `safe-crawler.ts`); T-296, T-312, T-313, T-331, T-355, T-358, T-360 (all edit `checkup-run.ts`); T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-299, T-300, T-301, T-302, T-303, T-313, T-329, T-331, T-357 (all edit `server.ts`); T-336, T-341, T-349, T-379, T-380 (all edit `vitest.workspace.ts`).

## Problem

On the hosted copy (`RUNNER_BETA=1`) every browser request must reach only public addresses (ADR 0014). Today that rests on a Playwright route guard (`installRequestGuard`, `packages/core/src/browser.ts:67-82`) plus one `--host-resolver-rules` pin for the start host (`browser.ts:114-125`, `packages/runner/src/session/checkup-run.ts:679-683`; the Website Audit pins its own start host and `www` twin, `packages/core/src/audit/crawl/crawl.ts:244-260` and `:354`).

That leaves gaps a route guard cannot close:

- **DNS rebinding of any other host.** The guard resolves the name, then Chromium resolves it again for the real connection. A name with a TTL of 0 can answer a public address to the guard and `10.0.0.5` or `169.254.169.254` to Chromium. ADR 0014 accepted this as "a blind GET". That no longer holds: a page on `rebind.example` that rebinds its own name is same-origin with the private service, so its script can read the replies.
- **Traffic routes never see.** WebSockets opened from a Web Worker, service workers in a context that forgot to block them, and WebRTC TURN over TCP. T-307 closes the main-page WebSocket and service-worker gaps with routes and flags, but each new browser feature is another hole.

An HTTP/CONNECT proxy inside the runner fixes all of it at one point: Chromium sends every connection to the proxy and resolves nothing itself; the proxy resolves each host with `resolvePublic` and connects to the address it checked, the same rule `safeGet` already follows for the runner's own requests (ADR 0031).

## Owner decision (open)

Should Chromium on the hosted copy send all its traffic through a pinned egress proxy?

- **A. Yes, on the shared machine (recommended default).** The runner starts an in-process proxy when `RUNNER_BETA=1`. Every Chromium it launches there (Check-ups, sign-in tests, Plan Review page loads, the Website Audit, the Competitive Benchmark) uses it. The proxy resolves each host once per connection with `resolvePublic`, refuses non-public addresses, and connects to the checked address. It covers WebSockets from any context, service workers, rebinding of every host, and WebRTC (with T-307's flag, WebRTC goes over TCP through the proxy). Local runs keep direct connections: the owner's own network and risk (ADR 0014, "local mode is unchanged"), and company proxies on the owner's computer keep working.
- **B. No proxy.** Keep the route guard plus T-307, and write the remaining risk (rebinding of hosts other than the start host, worker WebSockets, TURN over TCP) into ADR 0045 and `SECURITY.md` as accepted.
- **C. The proxy on every runner, local too** (private addresses allowed on a local run). One code path everywhere, but a person whose computer reaches the web only through a company proxy loses their connection until upstream-proxy support is added.

This ticket builds A unless the owner picks another option.

## Current code

Branch from `main`. Build after T-307 (same files: `browser.ts`, `crawl.ts`, `safe-crawler.ts`).

`packages/core/src/browser.ts` (`grep -n "export interface BrowserPolicy" -A 4 packages/core/src/browser.ts`):

```ts
export interface BrowserPolicy {
  guard?: (url: string, redirected: boolean) => Promise<boolean>;
  pinned?: Record<string, string>;
}
```

`BrowserManager.launch` (`grep -n "b = await launcher.launch" packages/core/src/browser.ts`) passes only `headless` and `args`.

`packages/runner/src/server.ts` (`grep -n "setBrowserPolicy" packages/runner/src/server.ts`):

```ts
    if (this.beta) setBrowserPolicy({ guard: makeRequestGuard(this.hostChecks) });
...
    if (this.beta) setBrowserPolicy(null);
```

`packages/runner/src/session/checkup-run.ts` (`grep -n "setBrowserPolicy({" -A 4 packages/runner/src/session/checkup-run.ts`) replaces the whole policy at the start of each run:

```ts
        setBrowserPolicy({
          guard: makeRequestGuard(deps.hostChecks),
          pinned: checked.ok && !isIpLiteral(typed.hostname) ? { [typed.hostname]: checked.address } : undefined,
        });
```

`packages/core/src/safe-net.ts` exports `resolvePublic(host, { lookup })` (`grep -n "export async function resolvePublic" packages/core/src/safe-net.ts`): every address must be public, a literal IP is classified, `localhost` and private text hosts are refused.

Playwright 1.63 forces loopback through a configured proxy (it adds `<-loopback>` to Chromium's bypass list unless `PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK` is set), so `http://127.0.0.1:…` from a page also reaches the proxy and is refused there.

## Change

1. **ADR.** Write `docs/adr/0045-pinned-egress-proxy-for-chromium.md` (the next free number; check `docs/adr/` again before writing). Shape as in ADR 0043:
   - Title `# 0045: A Pinned Egress Proxy for Chromium on the Shared Machine`. `Status: Accepted, <date> (owner's answer on T-308).` Amends [0014](0014-verified-domains-and-safe-host-classification.md) "Browser guard and its limit"; builds on [0031](0031-every-outbound-request-uses-pinned-resolver.md).
   - Context: the gaps above, and why 0014's "blind GET" reasoning fails for a same-origin rebind.
   - Decision: the option the owner chose, with the rules in steps 2 to 6 below (one proxy per runner process, loopback only, fresh public-only resolution per connection, pins honoured, CONNECT for `https:` and `wss:`, absolute-form forwarding for `http:`, refusal = 403, a cap on open tunnels). The route guard stays as a second layer and for its clear error text.
   - Consequences: one extra local hop per connection; a dead proxy fails closed (no page loads); `PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK` must never be set on the hosted copy; local runs are unchanged.
   - In `0014-verified-domains-and-safe-host-classification.md`, add under the Status line: `Amended by [0045](0045-pinned-egress-proxy-for-chromium.md): on a shared machine Chromium connects only through a pinned egress proxy, which closes the residual risk stated under "Browser guard and its limit".` In `SECURITY.md` (Verified Domains section), replace the sentence that starts `Residual: the browser resolves third-party hosts itself` with one saying that on a shared machine every browser connection goes through the runner's egress proxy, which resolves each host once and connects only to a checked public address (ADR 0045).

2. **The proxy**, new file `packages/core/src/egress-proxy.ts` (Node only):

```ts
export interface EgressProxy {
  /** `http://127.0.0.1:<port>`, for Playwright's `proxy.server`. */
  url: string;
  close(): Promise<void>;
}

export interface EgressProxyOptions {
  /** DNS lookup (tests pass a fake). Default: safe-net's lookup. */
  lookup?: NetDeps['lookup'];
  /** Opens the TCP connection to a checked address (tests point it at a loopback server). Default: net.connect. */
  connect?: (address: string, port: number) => net.Socket;
  /** Most connections open at once; more are answered 503. Default 256. */
  maxOpen?: number;
}

export async function startEgressProxy(opts: EgressProxyOptions = {}): Promise<EgressProxy>;
```

   - `checkedAddress(host)`: when `getBrowserPolicy()?.pinned?.[host.toLowerCase()]` is set, use it only if `isPublicAddress` says so; otherwise `resolvePublic(host, { lookup })`. `null` when refused. No cache: each connection resolves afresh.
   - `server.on('connect', ...)` for `https:`, `wss:` and `ws:` tunnels: parse `req.url` (`host:port`; refuse a missing or out-of-range port with `400`). Refused host: write `HTTP/1.1 403 Forbidden\r\n\r\n` and end. Allowed: `connect(address, port)`; on connect write `HTTP/1.1 200 Connection Established\r\n\r\n`, write `head`, pipe both ways; any error or close destroys both sockets. A 10 s connect timeout answers `504`.
   - `server.on('request', ...)` for plain `http:` in absolute form: only `http:` URLs (anything else `400`). Refused host: `403`. Allowed: `http.request({ method, path: url.pathname + url.search, headers, setHost: false, createConnection: () => connect(address, port) })`, with `Proxy-Connection` and `Proxy-Authorization` removed from the forwarded headers; pipe the request body and the answer. Upstream error: `502`.
   - `server.on('upgrade', ...)`: Chromium tunnels `ws:` with CONNECT, so a plain upgrade is unexpected. Answer `403` and destroy (fail closed). If the browser test shows Chromium does send plain upgrades, handle them like `connect` (resolve, connect, write the request line and headers, pipe) and say so in the PR.
   - Count open connections; above `maxOpen` answer `503`.
   - Listen on `127.0.0.1`, port `0`; `server.unref()` so it never keeps the process alive. `close()` destroys open sockets, then closes the server.
   - Export it from `packages/core/src/index.ts` (`export * from './egress-proxy.js';` next to `safe-net.js`).

3. **`browser.ts`:** add `proxy?: string` to `BrowserPolicy` (`/** The egress proxy every browser on this machine uses (ADR 0045). */`). In `BrowserManager.launch`, pass `...(browserPolicy?.proxy ? { proxy: { server: browserPolicy.proxy } } : {})` to `launcher.launch` for every engine. Keep the `--host-resolver-rules` pins (harmless; the proxy honours the same pins).

4. **`crawl.ts`** (the audit's own Chromium) and **`safe-crawler.ts`:** pass the same `proxy` option to their `launch` calls when `getBrowserPolicy()?.proxy` is set.

5. **`server.ts`:** add `private egress: EgressProxy | undefined;`. In `start()`, on beta: `this.egress = await startEgressProxy({ lookup: this.hostChecks?.lookup });` then `setBrowserPolicy({ guard: makeRequestGuard(this.hostChecks), proxy: this.egress.url });`. In `stop()`, after `setBrowserPolicy(null)`: `await this.egress?.close(); this.egress = undefined;`.

6. **`checkup-run.ts`:** the per-run beta policy keeps the proxy: `setBrowserPolicy({ ...getBrowserPolicy(), guard: makeRequestGuard(deps.hostChecks), pinned: ... })` (import `getBrowserPolicy` from `@qa/core` with `setBrowserPolicy`).

7. Run `pnpm exec prettier --write` on every changed file, then `pnpm build`.

## Tests

New file `packages/core/tests/egress-proxy.test.ts` (unit tier: loopback servers on port 0 only, no Chromium, no outside network). Start a plain `http.createServer` "site" on `127.0.0.1:0` that answers `ok`. Start the proxy with a fake `lookup` (`site.test` → `['8.8.8.8']`, `rebind.test` → `['8.8.8.8']` then `['10.0.0.5']`, `evil.test` → `['10.0.0.1']`) and a `connect` that opens `net.connect(sitePort, '127.0.0.1')` when the address is `8.8.8.8` and throws otherwise. Send requests to the proxy with `http.request` (`method: 'CONNECT', path: 'site.test:443'` and absolute-form `GET http://site.test/`).

- CONNECT to `site.test:443` answers 200, and bytes written after it reach the site server.
- Absolute-form `GET http://site.test/x` answers the site's `ok`; the site sees `Host: site.test` and no `Proxy-Connection` header.
- CONNECT to `evil.test:443`, to `127.0.0.1:9222` and to `localhost:80` answer 403; `connect` was never called for them.
- `rebind.test`: the first CONNECT answers 200, the second answers 403 (resolved afresh per connection).
- A pin: with `setBrowserPolicy({ pinned: { 'pinned.test': '8.8.8.8' } })`, CONNECT to `pinned.test:443` answers 200 without calling `lookup`; a pin to `10.0.0.9` answers 403. `afterEach(() => setBrowserPolicy(null))`.
- With `maxOpen: 1`, a second CONNECT while the first tunnel is open answers 503.
- `close()` ends open tunnels and the port stops accepting connections.

New file `packages/core/tests/egress-proxy-browser.test.ts` (browser tier: launches Chromium; add `'egress-proxy-browser'` to `BROWSER_TESTS.core` in `vitest.workspace.ts`). Same fake `lookup`/`connect` as above; the loopback site server also accepts a WebSocket upgrade on `/ws` (reply `101` with `Sec-WebSocket-Accept` = base64 SHA-1 of the key plus `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`). Launch `chromium.launch({ proxy: { server: proxy.url } })`; `page.goto('http://site.test/')`.

- The page loads through the proxy.
- In the page, `fetch('http://evil.test/')` rejects, and `new WebSocket('ws://site.test/ws')` opens while `new WebSocket('ws://evil.test/ws')` does not.
- From a Web Worker (a `blob:` worker created in the page), `new WebSocket('ws://evil.test/ws')` does not open and `ws://site.test/ws` does. (This is the gap T-307 cannot close.)
- `fetch('http://127.0.0.1:<sitePort>/')` from the page fails: loopback goes through the proxy and is refused.

Run: `pnpm exec vitest run packages/core/tests/egress-proxy.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests packages/runner/tests`, then `pnpm build`. Run the browser test with `pnpm exec vitest run --project browser packages/core/tests/egress-proxy-browser.test.ts` when Chromium is installed; otherwise it runs nightly.

## Done when

- [ ] `docs/adr/0045-pinned-egress-proxy-for-chromium.md` exists with the owner's choice, and ADR 0014 names it under its Status line.
- [ ] `grep -n "startEgressProxy" packages/runner/src/server.ts` finds the beta start; `grep -n "egress?.close" packages/runner/src/server.ts` finds the stop.
- [ ] `grep -n "proxy: { server" packages/core/src/browser.ts packages/core/src/audit/crawl/crawl.ts packages/core/src/competitive/safe-crawler.ts` finds all three launches.
- [ ] `grep -n "Residual: the browser resolves third-party hosts itself" SECURITY.md` prints nothing.
- [ ] The new unit test and the core and runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding H6, full fix (audit of 11 Nov 2026 on `d225418`). T-307 is the interim fix and builds first.
- Under option B, write ADR 0045 with the residual risk listed as accepted, update `SECURITY.md` to name the same gaps, and change nothing else.
- Out of scope: the runner's own requests (already pinned by `safeGet`, ADR 0031), the AI provider calls (fixed addresses), and `render-pdf.ts` (offline, scripts off).
- The proxy does not read or change TLS traffic: `https:` and `wss:` pass as tunnels, so certificate handling (T-312) is unchanged.
- T-300 (one browser-launch limit on the hosted copy) also edits `server.ts`.
