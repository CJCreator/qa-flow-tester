# Landing measurement

Optional, cookie-free counter for the landing page and the check-up flow. Off by default.

## Provider

GoatCounter (pixel/GET only). No third-party script is loaded: the wizard sends one small GET per event to the
endpoint in `VITE_COUNTER_URL` (`https://CODE.goatcounter.com/count`). The hosted free tier is for non-commercial
use; self-hosting is free. The owner confirms which (see `docs/tickets/HUMAN_TODO.md`).

## Events

| Event               | Fires                                                                      |
| ------------------- | -------------------------------------------------------------------------- |
| `landing-view`      | Landing page shown (once per page load)                                    |
| `start-checkup`     | A "Run a free check-up" button or the address form is used                 |
| `completed-checkup` | A check-up finishes live in this browser (not when an old one is reopened) |

## What is sent, and what is not

Sent: the event name only (`?p=<event>&e=true&t=<event>`).
Not sent: the address being checked, run id, report content, referrer, cookies.
Nothing is written to cookies, localStorage, sessionStorage or IndexedDB. The request uses `keepalive`, no
credentials and no referrer. Nothing is sent when the browser has Do Not Track or Global Privacy Control on.

## Reading it

Open the provider dashboard, then Events (or paths): `landing-view`, `start-checkup`, `completed-checkup`.
Conversion = `completed-checkup` / `landing-view`. Ad blockers drop some requests, so counts are a floor.
The success target is chosen in `docs/research/success-criteria.md`.

## Turning it off

Unset `VITE_COUNTER_URL` and rebuild. Then no code path sends anything. Self-hosted copies are off unless you set it.
Values are build-time: set them in the Vercel project and in Render (Docker build arg), then redeploy.

## CSP

No Content-Security-Policy is set today, so nothing blocks the request. If one is added, allow the counter
host in `connect-src`.
