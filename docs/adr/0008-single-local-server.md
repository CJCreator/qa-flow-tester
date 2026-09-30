# 0008: One Local Server for the Runner, Wizard and Studio

**Partly superseded by [0010](0010-one-app-with-details-on-demand.md) on 2026-09-30:** Studio is retired, and `/studio` redirects to Past check-ups. The single server, port and loopback rules stand.

## Context and Decision
Running the tool took three processes on three ports:
- the runner on 3001
- the Wizard on 3002, served by Vite or nginx
- QA Flow Studio on 3000 or 5173, served by Vite with a proxy

The runner's address was baked into the Wizard at build time. Getting a check going meant knowing all of this.

We decided that the runner serves both built UIs itself, on port 3001:
- The Wizard is at `/` and Studio is at `/studio`. The API is unchanged, and both UIs call it on their own origin.
- The static serving is a small module inside `@qa/runner`, not a new package, because it amounts to about 50 lines of logic.
- When `HUB_API_URL` is set, the runner forwards `/api/v1/*` to the Report Hub. The Hub stays a separate, optional team service (ADR 0005).
- `pnpm start` builds anything missing and opens the browser. `pnpm bootstrap` does a first-time install and a clean rebuild.
- Each person runs the server on their own machine. It binds to localhost and rejects requests whose Host header isn't a loopback name.

We rejected a shared team server. It would need sign-in, a run queue, per-user AI keys and a way to reach each person's localhost targets. The runner's single run slot doesn't allow any of that.

## Consequences
- There is one command, one port and one URL. Docker runs one service instead of separate runner and wizard containers, and the wizard's nginx image goes away.
- The UIs no longer need `VITE_RUNNER_URL` or cross-origin calls.
- Vite dev servers remain for contributors editing the UIs, but running the app doesn't need them.
- The runner now knows about UI builds, so it must be built after them for the UIs to be served.
- Rejecting non-loopback Host headers blocks DNS-rebinding pages from reading reports and evidence. It also means the server can't be opened from another machine by IP.
