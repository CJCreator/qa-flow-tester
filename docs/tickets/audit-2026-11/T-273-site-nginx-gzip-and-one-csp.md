# T-273: Site nginx compresses text files and states the CSP once

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | infra | speed | todo |

**Files you may edit (no others):**

- `site/nginx.conf`

**Do not build in parallel with:** nothing.

## Problem

1. `site/nginx.conf` has no `gzip`, so the landing page and the wizard bundle (JavaScript, CSS, SVG, JSON) travel uncompressed. The base image's own `nginx.conf` has `gzip` commented out.
2. The long `Content-Security-Policy-Report-Only` string is written out twice, once in `location /assets/` and once in `location /`. Changing one and forgetting the other gives two different policies depending on the path.

## Current code

Branch from `main`. `grep -n "Content-Security-Policy\|server_tokens" site/nginx.conf`.

`site/nginx.conf` lines 1-5:

```nginx
server {
  listen 8080;
  root /usr/share/nginx/html;
  index index.html;
  server_tokens off;
```

Line 23 (in `location /assets/`) and line 34 (in `location /`) are the same line:

```nginx
    add_header Content-Security-Policy-Report-Only "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://qa-check-up-809804736896.us-central1.run.app; frame-src 'self'; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'" always;
```

## Change

1. Put a `map` above the `server {` line (a `map` is allowed there: files in `conf.d` are included inside `http`). Move the policy text into it, unchanged:

```nginx
# The one CSP value, used by both locations below. $server_name is always set, so `default` always applies.
map $server_name $csp_report_only {
  default "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://qa-check-up-809804736896.us-central1.run.app; frame-src 'self'; worker-src 'self' blob:; media-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
}

```

2. In both locations replace the long `add_header Content-Security-Policy-Report-Only "..." always;` line with:

```nginx
    add_header Content-Security-Policy-Report-Only $csp_report_only always;
```

3. In the `server` block, directly after `server_tokens off;`, add:

```nginx

  # Compress text files. `gzip_proxied any` is needed: Cloud Run's front end adds a Via header, and nginx
  # skips compression for proxied requests by default. text/html is always compressed.
  gzip on;
  gzip_vary on;
  gzip_proxied any;
  gzip_min_length 1024;
  gzip_types text/css application/javascript text/javascript application/json image/svg+xml text/plain application/xml;
```

4. In the comment block, the line "connect-src names the online copy (VITE_ONLINE_APP_URL in .github/workflows/deploy.yml); change both together." keeps its meaning. Change it to "...(VITE_ONLINE_APP_URL in .github/workflows/deploy.yml); change the `map` above and that variable together."

## Tests

No unit test reads `site/nginx.conf` (`grep -rn "nginx.conf" packages/*/tests` finds nothing). Check the file:

- `grep -c "add_header Content-Security-Policy-Report-Only" site/nginx.conf` prints 2, and `grep -c "default-src" site/nginx.conf` prints 1.
- If Docker is installed: `docker run --rm -v "$PWD/site/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginxinc/nginx-unprivileged:1.27-alpine nginx -t` must print `syntax is ok`. If Docker is not installed, say so in your notes.
- `pnpm exec prettier --check site/nginx.conf` is not needed (Prettier does not format `.conf`).

## Done when

- [ ] `grep -c "default-src" site/nginx.conf` prints 1.
- [ ] Both locations use `$csp_report_only`.
- [ ] `gzip on;` and `gzip_proxied any;` are in the `server` block.
- [ ] `nginx -t` passes (or Docker is missing and the notes say so).

## Notes

- The policy text must stay byte for byte the same as today. Only its place changes.
- After deploy, check with `curl -sI -H "Accept-Encoding: gzip" <site>/assets/<a .js file>` that `Content-Encoding: gzip` is present and the CSP header is still on `/` and `/assets/...`.
- Not in this ticket: turning the CSP from Report-Only into an enforced policy (the file comment says it waits for a browser check).
