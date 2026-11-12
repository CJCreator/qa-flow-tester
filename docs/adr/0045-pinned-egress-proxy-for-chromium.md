# 0045: A Pinned Egress Proxy for Chromium on the Shared Machine

Status: Accepted, 2026-11-12 (owner's answer on T-308). Amends [0014](0014-verified-domains-and-safe-host-classification.md) "Browser guard and its limit"; builds on [0031](0031-every-outbound-request-uses-pinned-resolver.md).

## Context
On the hosted copy (`RUNNER_BETA=1`) every browser request must reach only public addresses (ADR 0014). Until now that rested on a Playwright route guard plus one `--host-resolver-rules` pin for the start host. A route guard cannot close these gaps:

- **DNS rebinding of any other host.** The guard resolves a name, then Chromium resolves it again for the real connection. A name with a TTL of 0 can answer a public address to the guard and a private address to Chromium. ADR 0014 accepted this as "a blind GET". That no longer holds: a page on a rebinding name is same-origin with the private service, so its script can read the replies.
- **Traffic the route layer never sees.** WebSockets opened from a Web Worker, service workers in a context that forgot to block them, and WebRTC TURN over TCP. T-307 closes the main-page WebSocket and service-worker gaps, but each new browser feature is another hole.

## Decision
On a shared machine (`RUNNER_BETA=1`) the runner starts one in-process egress proxy, and every Chromium it launches uses it: Check-ups, sign-in tests, Plan Review page loads, the Website Audit and the Competitive Benchmark. The rules:

1. **One proxy per runner process**, listening on `127.0.0.1` only, on a port the OS picks. It is unref'd, so it never keeps the process alive. It starts with the runner and closes with it.
2. **Fresh resolution per connection.** Each connection to a host is checked with `resolvePublic`; there is no cache. A pin from the shared browser policy (the start host, ADR 0014) is used only if it is a public address. Every address must be public, and the proxy connects to the address it checked, never to a second lookup.
3. **CONNECT** handles `https:`, `wss:` and `ws:` as tunnels. The proxy does not read or change TLS traffic.
4. **Absolute-form forwarding** handles plain `http:`. Other schemes are refused with `400`.
5. **Refusal is `403`.** A malformed CONNECT target (missing or out-of-range port) is `400`. A plain `Upgrade` request is refused with `403`, because Chromium tunnels WebSockets with CONNECT.
6. **A cap on open connections.** Above 256 open connections, new ones get `503`. A connect that takes longer than 10 s gets `504`.
7. The route guard stays as a second layer, and it keeps its clear error text.

Local runs (`RUNNER_BETA` unset) keep direct connections: the owner's own network and risk (ADR 0014, "local mode is unchanged"). Company proxies on the owner's computer keep working.

## Consequences
- One extra local hop per connection.
- A dead proxy fails closed: no page loads. The runner does not fall back to direct connections.
- `PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK` must never be set on the hosted copy. Playwright adds `<-loopback>` to Chromium's bypass list unless that variable is set; without the bypass, loopback addresses from a page also reach the proxy and are refused there.
- WebRTC: with `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` (T-307), WebRTC goes over TCP through the proxy.
- Local runs are unchanged.
- Not covered: the runner's own requests (already pinned by `safeGet`, ADR 0031), the AI provider calls (fixed addresses), and `render-pdf.ts` (offline, scripts off).
