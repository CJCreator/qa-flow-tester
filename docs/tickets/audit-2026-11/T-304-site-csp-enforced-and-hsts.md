# T-304: The static site enforces its CSP and sends HSTS

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | infra | security | todo |

**Files you may edit (no others):**

- `site/nginx.conf`

**Do not build in parallel with:** T-273 (edits `nginx.conf`).

## Problem

The static site (landing page and wizard on Cloud Run, `site/nginx.conf`) sends its Content-Security-Policy only as `Content-Security-Policy-Report-Only` (`site/nginx.conf:23`, `:34`), and there is no report endpoint (no `report-uri` or `report-to`). So the policy blocks nothing and tells nobody: an injected script would run, and the console warnings are seen only by whoever has the console open. The file's own comment says Report-Only was meant to last only "until the built wizard and /sample-report.html are checked in a browser" (`site/nginx.conf:10-11`).

The site also sends no `Strict-Transport-Security`. Cloud Run serves it over https only, but without HSTS a browser that is sent to `http://` (an old link, a typed address) makes that first request in plain text.

This ticket builds after T-273, which moves the policy text into one `map` (`$csp_report_only`) and uses it in both locations. The steps below are written for the file as T-273 leaves it.

## Current code

Branch from `main` after T-273 is merged.

On `main` today (`grep -n "Content-Security-Policy\|Strict-Transport" site/nginx.conf`) the policy is written out twice, at lines 23 and 34, as `add_header Content-Security-Policy-Report-Only "default-src 'self'; ... frame-ancestors 'self'" always;`, and there is no `Strict-Transport-Security` line.

After T-273 the file has, above `server {`:

```nginx
map $server_name $csp_report_only {
  default "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://qa-check-up-809804736896.us-central1.run.app; frame-src 'self'; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
}
```

and in both `location /assets/` and `location /`:

```nginx
    add_header Content-Security-Policy-Report-Only $csp_report_only always;
```

The comment block above the locations (`site/nginx.conf:7-14`) explains why the policy is Report-Only, that `connect-src` names the online copy, that Helper sign-in is off on the site, and why framing is `SAMEORIGIN`.

## Change

1. **Check first, with the file as it is (Report-Only).** Build and serve the site locally:

```sh
pnpm site-build
docker run --rm -p 8080:8080 \
  -v "$PWD/site/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$PWD/public:/usr/share/nginx/html:ro" \
  nginxinc/nginx-unprivileged:1.27-alpine
```

   Open `http://localhost:8080/`, `/check`, `/reports`, `/settings` and `/sample-report.html` in Chromium with the console open, and scroll the landing page so the framed sample report loads. Every "[Report Only] Refused to …" message is something the enforced policy would block. If there is none, go on. If there is one, stop and report it in the PR (which page, which directive, which source); do not widen the policy in this ticket.

2. In the `map`, rename the variable: `map $server_name $csp {`.

3. In both locations, replace `add_header Content-Security-Policy-Report-Only $csp_report_only always;` with:

```nginx
    add_header Content-Security-Policy $csp always;
    add_header Strict-Transport-Security "max-age=31536000" always;
```

   (Each location repeats its headers: nginx drops server-level `add_header` lines once a location has its own, as the file's comment says.)

4. In the comment block, replace the two lines that begin "CSP is Report-Only until the built wizard …" with:

```nginx
  # The CSP is enforced (T-304, after a browser check of /, /check, /reports, /settings and /sample-report.html with
  # Report-Only showed no violations). The landing page frames /sample-report.html, so framing stays 'self'.
  # HSTS: Cloud Run serves this site over https only. No includeSubDomains or preload: the run.app name is Google's.
```

   Keep the other comment lines.

5. Check the syntax: `docker run --rm -v "$PWD/site/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginxinc/nginx-unprivileged:1.27-alpine nginx -t` prints `syntax is ok`. Then repeat the browser check of step 1 with the new file: the console must show no "Refused to …" message.

## Tests

No unit test reads `site/nginx.conf` (`grep -rn "nginx.conf" packages/*/tests` finds nothing). The checks are:

- `grep -c "Content-Security-Policy-Report-Only" site/nginx.conf` prints 0; `grep -c "add_header Content-Security-Policy \$csp always;" site/nginx.conf` prints 2; `grep -c "Strict-Transport-Security" site/nginx.conf` prints 2; `grep -c "default-src" site/nginx.conf` prints 1.
- `nginx -t` in the image passes (step 5).
- The two browser checks (steps 1 and 5) are done. If Docker or a browser is not available, say so in the PR and leave the ticket at `human` for the check.

## Done when

- [ ] The site sends `Content-Security-Policy` (not Report-Only) and `Strict-Transport-Security: max-age=31536000` on `/` and `/assets/...`.
- [ ] The grep counts above hold, and `nginx -t` passes.
- [ ] The browser check shows no CSP violation on the five pages, or the PR names each one and the ticket stops before step 2.
- [ ] After deploy: `curl -sI <site>/` and `curl -sI <site>/assets/<a .js file>` show both headers.

## Notes

- Audit finding M10, site part (audit of 11 Nov 2026 on `d225418`). The runner part is T-303.
- Builds after T-273 (same file).
- Seen, not changed: the runner's Cloud Run address is written by hand in two places, the `connect-src` of the policy here and `RUNNER_URL` / `VITE_ONLINE_APP_URL` in `.github/workflows/deploy.yml`. They must change together (the file's comment says so). Filling it in from the deploy (an nginx template with `envsubst`) would be a separate change to `site/Dockerfile` and `deploy.yml`.
- No report endpoint is added: an enforced policy blocks without one, and collecting reports would need a service to receive them.
