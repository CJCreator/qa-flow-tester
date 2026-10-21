# Security and redaction review: open findings

Status: review done, nothing fixed yet. One consolidated list to resolve later. Each item has a location, what
was checked, and a fix direction. Items marked **verified** were reproduced or tested directly; the rest are
from reading the code and still need a test before a fix is merged.

Scope: the runner (`packages/runner`), the core engine (`packages/core`), the checkers (`packages/checkers`),
and the repo's secret-file hygiene. Not yet reviewed: the wizard's handling of responses, dependency audit,
the AI provider adapters, and the scheduler.

## Severity summary

| ID  | Severity | Area               | One line                                                                | Status   |
| --- | -------- | ------------------ | ----------------------------------------------------------------------- | -------- |
| S1  | High     | SSRF (hosted beta) | API-level requests skip the address guard                               | verified |
| S2  | High     | SSRF (hosted beta) | Sitemap URLs from `robots.txt` are fetched with no host check           | read     |
| S3  | Medium   | Redaction          | URL secrets in the fragment or path are not hidden                      | verified |
| S4  | Medium   | Redaction          | Some secret parameter names are missing from the list                   | verified |
| S5  | Medium   | Redaction          | Literal matching misses HTML-, JSON- and form-escaped forms             | verified |
| S6  | Medium   | Redaction          | Secrets under 3 characters are never redacted                           | read     |
| S7  | Medium   | Redaction          | Screenshots and videos are not scrubbed                                 | read     |
| S8  | Medium   | Redaction          | Text scrub runs only at the end of a run                                | read     |
| S9  | Medium   | Redaction          | Live events and report use role credentials only, not headers or tunnel | read     |
| S10 | Medium   | Data at rest       | Sign-in sessions stay on disk after a UI run                            | read     |
| S11 | Low      | Access control     | Some GET routes change run state                                        | read     |
| S12 | Low      | Redaction          | Text-evidence list omits common formats (csv, xml, yaml, svg)           | read     |

## High

### S1. API-level requests skip the address guard (hosted beta) — verified

**Where:** `packages/core/src/browser.ts:64-78` (`installRequestGuard`), `packages/core/src/safe-net.ts:228-242`
(`makeRequestGuard`). Request paths that bypass it: `packages/core/src/orchestrator.ts:204` (`page.request.get`),
`packages/checkers/src/seo.ts:397` and `:556-557` (`requestContext.fetch`, HEAD then GET),
`packages/checkers/src/security-depth.ts:48` (`request.fetch`).

**Why:** the guard is a Playwright route handler. Playwright routes do not intercept `context.request` or
`page.request` (APIRequestContext) calls.

**Verified:** a route that aborts `127.0.0.1` stopped browser navigation (0 server hits). `context.request.get`
and `page.request.get` both returned 200 (2 hits). Repro: a local `http.createServer` on `127.0.0.1`, a context
with a `**/*` route that aborts that host, then the three calls.

**Impact:** a visited site can make the hosted runner send GET (and HEAD) requests to internal addresses, such as
a metadata endpoint or another service on the hosting network, and learn the status code. In local mode, a visited
site can probe the user's own network the same way.

**Fix direction:** send every non-browser request through a resolver that pins the resolved address and checks
each redirect hop (`safeGet` in `safe-net.ts` already does this for the domain proof; reuse it). Set redirects to
manual on each path, then follow only with the same check. Add a test: the repro above must show 0 hits after the
fix, for `context.request`, `page.request`, HEAD and redirected GET.

### S2. Sitemap URLs from `robots.txt` are fetched with no host check — read

**Where:** `packages/core/src/discovery/deterministic-spider.ts:406-430`. A `Sitemap:` line is taken as is and
fetched with `context.request.get(smUrl, { timeout: 10000 })`. The body is read (`res.text()`) and `<loc>` entries
are parsed.

**Why:** the sitemap URL is not checked to be same-site or public, and the request is not routed through the guard
(see S1).

**Impact:** a hostile site's `robots.txt` can make the runner GET any URL it can reach and read the body. Parsed
`<loc>` values are later filtered by the same-site check, which limits what is kept, but not what is requested.

**Fix direction:** same as S1, plus restrict sitemap hosts to the target site unless the person has allowed
otherwise. Ignore sitemaps on other hosts with a logged reason.

## Medium: redaction

Redaction code: `packages/core/src/redact.ts`. Secret-parameter list: `packages/checkers/src/security.ts:5-6`.

### S3. URL secrets in the fragment or path are not hidden — verified

**Where:** `redact.ts:10` (`SECRET_PARAM_IN_TEXT`). The pattern is `([?&](?:names)=)[^&#\s"'<>)]*`.

**Why:** only a `?` or `&` before the parameter name matches. The fragment (`#`) and path segments do not.

**Verified (node regex test):** `https://app/cb#access_token=…` and `https://app/reset/<token>` both pass through
unchanged.

**Impact:** OAuth implicit-flow tokens in the hash, and password-reset or magic-link tokens in the path, can appear
in step URLs, findings, network logs and reports.

**Fix direction:** also match `#name=` in the fragment (and `;name=` path parameters). For known token-bearing
path shapes, such as `/reset/`, `/verify/`, `/confirm/` followed by a long opaque segment, hide the segment.

### S4. Some secret parameter names are missing — verified

**Where:** `packages/checkers/src/security.ts:5-6`. The list has `pass|password|passwd|pwd|pin|otp|token|access_token|…|key|session|sid|ssn|cvv|card`.

**Verified:** `?code=`, `?reset_token=` (name must follow `?` or `&` directly) and `?X-Amz-Signature=` (presigned
storage URLs) all pass through.

**Fix direction:** add `code`, `signature`, `sig`, `x-amz-signature`, `x-goog-signature`, `jwt`, `bearer`,
`magic`, and a suffix rule for names ending in `_token`, `-token`, `_secret`, `_key`. Keep the list in one place
(`SECRET_PARAM_NAMES`) and have the test cover each name.

### S5. Literal matching misses escaped forms — verified

**Where:** `redact.ts:31-34` (the constructor adds the raw value and `encodeURIComponent` variants only).

**Verified (node test):** a password `p&ss"w<rd` in HTML attribute form (`&amp;`, `&quot;`, `&lt;`) and in JSON text
form is not found by a literal search. A form-encoded body (`URLSearchParams`) produces `%21 %27 %28 %29 %2A` where
`encodeURIComponent` leaves `!'()*` unescaped, so that variant is missed too.

**Impact:** a page or response that echoes a typed secret in escaped form leaks it into DOM snapshots, network logs
and reports. Passwords with `& " < ' \ ! * ( )` are the most exposed. The exposure needs the page or response to
echo the value; typed values alone usually do not appear in `page.content()`.

**Fix direction:** add HTML-escaped, JSON-escaped and form-encoded (`URLSearchParams`) variants of each secret, and
add a test for each of the four forms.

### S6. Secrets under 3 characters are never redacted — read

**Where:** `redact.ts:24` (`secret.length >= 3`), and the same threshold for custom headers in `plan-store.ts:280-290`,
`routes/plan.ts:203-207`.

**Impact:** a two-character or one-character secret, such as a short PIN, is written and streamed in full.

**Fix direction:** redact any non-empty secret, and rely on the exact-match rule for short values. Accept the
false positives on short common strings, or hide only in the places where the value is a credential (fields that
came from a role). Decide with the person; it is a trade-off.

### S7. Screenshots and videos are not scrubbed — read

**Where:** `packages/core/src/evidence.ts:100` (`page.screenshot({ fullPage: true })`), video recording
`packages/core/src/browser.ts:194-200`. `redact.ts:16` covers only text formats.

**Why:** the text pass cannot touch images or video. A screenshot of a signed-in page can show the username, email
address or personal data, and the video shows the typing.

**Impact:** personal data and sign-in names reach the report folder, the report download and the wizard evidence view.

**Fix direction:** (a) mask known sensitive fields before the screenshot, the same way visual baselines mask
(`visual-capture.ts:113-152` already takes a mask); (b) for signed-in roles, capture the evidence with the sign-in
email masked; (c) document that screenshots may contain personal data, and offer a switch to turn off step
screenshots and video for sensitive runs. Video cannot be scrubbed after the fact, so it needs (c).

### S8. The text scrub runs only at the end of a run — read

**Where:** `orchestrator.ts:1564` (`redactor.files(evidenceDir)`), `checkup-run.ts:578` (`files(runDir)`).

**Why:** evidence is written in plaintext during the run and scrubbed once at the end. If the run crashes, is
stopped, or the process is killed, the plaintext files stay on disk.

**Fix direction:** redact on write (the evidence writer already has the redactor's inputs), keeping the end-of-run
pass as a second layer. Add a test that a stopped run leaves no plaintext secret in the evidence folder.

### S9. Live events and the report use role credentials only — read

**Where:** `orchestrator.ts:350-352` (the event redactor is built from `options.profile?.roles` only), and
`orchestrator.ts:1565` (`redactor.deep(fullReport)`, roles only). Custom headers and tunnel auth are only applied in
the file pass (`checkup-run.ts:578`) and the error-message path (`checkup-run.ts:300-345`).

**Why:** a header value that appears in a live event, or in the report before the file pass, is not redacted by
that stage.

**Impact:** a custom header value echoed into a finding or an event would stream to the wizard unredacted. I have
not confirmed a path that does this.

**Fix direction:** build the orchestrator's redactor from roles, custom headers and tunnel auth (the same list the
runner already builds in `checkup-run.ts:338`). Share one function that builds the full secret list so the two
places cannot drift.

## Medium: data at rest

### S10. Sign-in sessions stay on disk after a UI run — read

**Where:** the UI path puts per-run auth under `<outputDir>/auth` (`checkup-session.ts:68`, `run-secrets.ts:72-77`).
The only removal is `plan-store.ts:185-192` on plan clear. The CI path deletes its temp folder (`checkup.ts`, the
`qa-checkup-` work dir). The file routes refuse to serve anything under an `auth` folder (`server.ts:208-213`,
`:1150-1166`), so the exposure is the local disk, not the HTTP API.

**Impact:** cookies and local-storage tokens for a signed-in role remain on the host after a run finishes, until
the plan is cleared. A later backup or a shared machine would expose them.

**Fix direction:** delete the run's auth folder when the run ends (success, failure or stop), and keep the plan's
ability to reuse a session only while the plan is still waiting for review.

## Low

### S11. Some GET routes change run state — read

**Where:** `server.ts:979-990` (status), which calls `ensurePlanLoaded()` (`server.ts:3137-3144`) and can begin a run
session. A cross-origin GET gets no CORS headers, so the response cannot be read, but the state change still happens.

**Fix direction:** keep GET read-only. Move the plan-load step into an explicit POST, or make it a no-op for requests
without the same-origin headers.

### S12. The text-evidence list omits common formats — read

**Where:** `redact.ts:16` (`.html .htm .ts .js .json .md .txt .log`). `.csv`, `.xml`, `.yml`, `.yaml`, `.svg` and `.har`
are missing.

**Why:** the app does not write these into evidence today, so the impact is low. It would become a gap if a new
exporter or a HAR capture is added.

**Fix direction:** add the formats now, and add a test that fails when a new text extension is written into the
evidence folder without being listed.

## What is in good shape (checked, no finding)

- **CORS:** only exact origins are echoed; cross-origin non-GET requests are refused (`server.ts:868-886`).
- **DNS rebinding:** the Host header must be loopback, or an allowed tunnel host (`server.ts:235-244`, `:851`).
- **Access key:** compared with `timingSafeEqual` (`server.ts:266`). Cookie is `HttpOnly; SameSite=Lax` (`server.ts:805`,
  `beta.ts:111`), and `Secure` on HTTPS.
- **File routes:** real-path check before serving, a refusal for any path segment named `auth`, `runId` validated with
  `isRunId` (`server.ts:221-223`), and a fixed allowlist for report downloads (`server.ts:2220-2240`).
- **Sign-in passwords:** kept in the OS keychain. A plan saved to disk stores `{{password}}` placeholders
  (`plan-store.ts:269-300`).
- **AI keys:** keychain first. The plaintext `.qa-keys.json` fallback is documented and written with mode `0600`
  (`key-resolver.ts:61-79`).
- **Repo hygiene:** `.env`, `.qa-keys.json`, `.qa-*` output and the auth folders are git-ignored; `.dockerignore`
  excludes them from the image. A scan of tracked files for key-shaped strings (`sk-or-`, `sk-ant-`, `AKIA`, private
  key headers) found none.

## Not yet reviewed

- The wizard: how it renders evidence and whether it sanitises HTML from the page under test.
- Dependency audit (`pnpm audit`) and the Docker base image.
- AI provider adapters: what page content is sent, and whether a visual review can include unmasked screenshots (S7).
- The scheduler and beta session handling in `beta.ts` (token generation, expiry, per-visitor limits).
- Rate limiting on the public beta endpoints beyond the daily caps.

## Suggested order to resolve

1. S1 and S2 together, since they share one fix (route all non-browser requests through the pinned resolver).
2. S3, S4, S5 (redaction matching, one test file covering every form).
3. S9 and S8 (redact on write, one shared secret list).
4. S10 (delete sessions when a run ends).
5. S6, S7, S11, S12, then the not-yet-reviewed areas.
