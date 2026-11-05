# Landing measurement

Optional, cookie-free event counter in the wizard. Off unless `VITE_COUNTER_URL` is set at build time. Code: `packages/wizard/src/lib/counter.ts`.

## Provider

GoatCounter-style endpoint (`https://CODE.goatcounter.com/count`). No third-party script loads: each event is one GET. The endpoint must be `https` (`http` only for localhost) with no credentials, query or hash; otherwise the counter stays off. Variable reference: [CONFIGURATION.md](CONFIGURATION.md).

## Events

| Event               | Fires (file)                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `landing-view`      | Landing screen shown, once per page load (`screens/LandingScreen.tsx`)                       |
| `start-checkup`     | A start link or the address form on the landing screen is used (`screens/LandingScreen.tsx`) |
| `completed-checkup` | A Check-up finishes live in this browser, not when an old one is reopened (`App.tsx`)        |

## What is sent

The event name only: `?p=<event>&e=true&t=<event>`. Not sent: the address being checked, run id, report content, referrer, cookies. Nothing is stored in cookies or browser storage. The request is `keepalive`, `no-cors`, with credentials omitted and no referrer. Nothing is sent when the browser has Do Not Track or Global Privacy Control on.

## Reading it

In the provider dashboard, read the three events. Conversion is `completed-checkup` / `landing-view`. Ad blockers drop some requests, so counts are a floor.

## Turning it on or off

The value is read at build time. The runner image takes it as the build arg `VITE_COUNTER_URL` (`packages/runner/Dockerfile`); a local `pnpm build` or `pnpm site-build` reads it from the environment. Unset it and rebuild to turn counting off; no code path then sends anything. If the host sets a Content-Security-Policy, allow the counter host in `connect-src`.
