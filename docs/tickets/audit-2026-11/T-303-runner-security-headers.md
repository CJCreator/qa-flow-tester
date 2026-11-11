# T-303: The runner sends frame-ancestors, a CSP and HSTS

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | security | todo |

**Files you may edit (no others):**

- `packages/runner/src/security-headers.ts` (new)
- `packages/runner/src/server.ts`
- `packages/runner/tests/security-headers.test.ts` (new)

**Do not build in parallel with:** T-255, T-258, T-259, T-260, T-261, T-265, T-267, T-296, T-297, T-298, T-299, T-300, T-301, T-302, T-308, T-313, T-329, T-331, T-357 (all edit `server.ts`).

## Problem

The runner serves the wizard and the API on one origin, the hosted copy included. Its pages carry only `X-Content-Type-Options`, `Referrer-Policy` and, on private screens, `X-Robots-Tag` (`seoHeaders`, `packages/runner/src/ui-static.ts:92-102`). JSON answers carry only `Content-Type` (`sendJson`, `packages/runner/src/routes/body.ts:17-20`). There is no `X-Frame-Options`, no `frame-ancestors`, no Content-Security-Policy and no `Strict-Transport-Security` for the wizard or the API. Only three places set any of them, each for its own page: the Shared Link page (`packages/runner/src/routes/audit-share.ts:59-68`), the audit preview (`packages/runner/src/routes/audit-preview.ts:49-57`) and site snapshots in the evidence (`packages/runner/src/evidence-file.ts:52`).

So another site can frame the wizard (a click-jacking risk for a tester who holds the access key cookie: Stop, Approve, delete), nothing limits where the wizard's scripts may come from if an injection is ever found, and a browser that once reached the hosted copy over https may still try plain http first. The static site already sends `X-Frame-Options: SAMEORIGIN` and a Report-Only CSP (`site/nginx.conf`); the runner, which holds the key and the reports, sends neither.

## Current code

Branch from `main`.

`packages/runner/src/ui-static.ts` (`grep -n "function seoHeaders" packages/runner/src/ui-static.ts`):

```ts
function seoHeaders(pathname: string, ext: string): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
```

`packages/runner/src/server.ts`, the top of the request handler (`grep -n "this.server = http.createServer(async (req, res) => {" packages/runner/src/server.ts`):

```ts
      this.server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url || '/', `http://${bracketHost(this.host)}:${this.port}`);
          const pathname = url.pathname;
```

The pages that set their own policy do it in `res.writeHead(status, headers)`. Node merges headers set earlier with `res.setHeader` into `writeHead`, and the ones passed to `writeHead` win. So headers set with `setHeader` at the top of the handler are a default that those pages still override: the Shared Link keeps `X-Frame-Options: DENY` and its per-page CSP, a site snapshot keeps `Content-Security-Policy: sandbox`.

The static site's policy (`grep -n "Content-Security-Policy" site/nginx.conf`) is the model: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://…run.app; frame-src 'self'; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'`. `'unsafe-inline'` for styles is needed: React `style` props, and the tool's own `report.html` uses inline `style` attributes (`packages/core/src/html-report.ts`). Neither `report.html` nor the wizard's `index.html` has an inline script (the only `<script>` in `packages/wizard/index.html` besides the module entry is `application/ld+json` data, which a CSP does not block).

Helper sign-in (Firebase, `packages/wizard/src/screens/audit/saved/firebase-sign-in.ts`) uses `signInWithPopup` with `browserPopupRedirectResolver`. When Helper sign-in is on, the runner knows the auth domain: `helperAccess.firebaseWeb.authDomain` (`packages/runner/src/helpers/helper-access.ts:117`, `:138-141`).

## Change

1. New file `packages/runner/src/security-headers.ts`:

```ts
import type http from 'http';

/**
 * The runner's default Content-Security-Policy (T-303): the static site's policy (site/nginx.conf) with
 * connect-src 'self', because the API is on this origin. With Helper sign-in on, Firebase's hosts are added.
 * A page that sends its own policy in writeHead (a Shared Link, a preview, a site snapshot) keeps its own.
 */
export function runnerCsp(signInAuthDomain?: string): string {
  const google = signInAuthDomain
    ? {
        script: ' https://apis.google.com',
        frame: ` https://${signInAuthDomain}`,
        connect: ' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com',
      }
    : { script: '', frame: '', connect: '' };
  return [
    "default-src 'self'",
    `script-src 'self'${google.script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${google.connect}`,
    `frame-src 'self'${google.frame}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/** True when the visitor reached the runner over https (directly, or through Cloud Run's front end or a tunnel). */
export function servedOverHttps(req: http.IncomingMessage): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https' || (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
}

/** Default headers for every answer. Set with setHeader, so a page's own writeHead headers still win. */
export function applySecurityHeaders(req: http.IncomingMessage, res: http.ServerResponse, csp: string): void {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', csp);
  // Only over https: a browser ignores HSTS on plain http, and localhost must keep working without TLS.
  if (servedOverHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
```

   `authDomain` comes from the runner's own settings (`FIREBASE_AUTH_DOMAIN` or `<projectId>.firebaseapp.com`), never from a request.

2. `server.ts`: import `applySecurityHeaders` and `runnerCsp` from `./security-headers.js`. Add a field `private readonly csp: string;` and set it in the constructor after `this.helperAccess` is assigned: `this.csp = runnerCsp(this.helperAccess?.firebaseWeb?.authDomain);`. In the request handler, right after `const pathname = url.pathname;`, add:

```ts
          // Frame, script and transport defaults for every answer (T-303); a page's own writeHead headers win.
          applySecurityHeaders(req, res, this.csp);
```

3. Run `pnpm exec prettier --write` on the two source files and the new test, then `pnpm build`.

4. Browser check (by hand, once): `pnpm start`, open `http://localhost:3001/`, `/check`, `/reports`, a past report's `report.html` and `/sample-report.html` with the browser console open. There must be no "Refused to …" CSP message. If Helper sign-in can be set up locally (`FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `RUNNER_ACCESS_TOKEN`), sign in as a Helper once; if the console names another Google host, add it to the matching directive in `runnerCsp` and to the test. Say in the PR what was checked and what could not be.

## Tests

New file `packages/runner/tests/security-headers.test.ts` (unit tier: loopback runner, no Chromium).

- `runnerCsp()` contains `frame-ancestors 'self'`, `script-src 'self';`, `object-src 'none'` and no `unsafe-eval` and no `apis.google.com`.
- `runnerCsp('proj.firebaseapp.com')` has `https://apis.google.com` in `script-src`, `https://proj.firebaseapp.com` in `frame-src`, and `https://identitytoolkit.googleapis.com` in `connect-src`.
- `servedOverHttps`: `x-forwarded-proto: https` is true, `'https, http'` is true, `http` is false, no header and a plain socket is false.
- A `RunnerServer` (no `beta`, no key) on `await freePort()` (`./helpers/free-port.js`):
  - `GET /api/runner/status`: `x-frame-options` is `SAMEORIGIN`; `content-security-policy` contains `frame-ancestors 'self'`; no `strict-transport-security`.
  - The same with `x-forwarded-proto: https`: `strict-transport-security` is `max-age=31536000`.
  - `GET /s/` plus a 22-character unknown link id (it matches `SHARE_LINK_ID_PATTERN`): `x-frame-options` is `DENY` and the CSP is the Shared Link's own (it does not contain `frame-ancestors 'self'`): the page's own headers still win.

Run: `pnpm exec vitest run packages/runner/tests/security-headers.test.ts packages/runner/tests/seo-static.test.ts packages/runner/tests/evidence-file.test.ts`, then `pnpm exec vitest run --project unit packages/runner/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "applySecurityHeaders(req, res, this.csp)" packages/runner/src/server.ts` finds the call at the top of the handler.
- [ ] The new test passes: wizard and API answers carry `X-Frame-Options: SAMEORIGIN` and the CSP; HSTS only over https; the Shared Link keeps `DENY` and its own CSP.
- [ ] The browser check in Change step 4 is done, or the PR says what could not be checked.
- [ ] The runner unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M10, runner part (audit of 11 Nov 2026 on `d225418`). The static site part is T-304.
- `frame-ancestors 'self'` and `SAMEORIGIN`, not `'none'`/`DENY`: the landing page frames `/sample-report.html` from the same origin.
- HSTS has no `includeSubDomains` and no `preload`: the hosted copy lives on a `run.app` name the project does not own.
- The Vite dev server (`pnpm dev:wizard`) does not get these headers; only the runner's own answers do.
- If a later check finds a library in the wizard bundle that needs `eval`, do not add `'unsafe-eval'` here without an owner decision; report it instead.
