# 0021: Saved Sessions Are Memory-Only; Docs-URL Fetch Is Confined

Status: Accepted by plan approval, 2026-10-09 (the owner approved this through the ADR 0020 plan).

Builds on [0020](0020-sources-role-binding-and-pipelined-planning.md), [0014](0014-verified-domains-and-safe-host-classification.md) (safe host classification), [0016](0016-evidence-redaction.md) (what is redacted) and [0018](0018-claim-wording.md) (wording).

## Context and Decision
ADR 0020 adds three things that touch secrets or outbound requests: a role can use a saved session instead of a password, Product Context can be a docs URL, and a new issues document embeds screenshots. Each needs a rule and a test.

### Saved sessions
- A saved session (Playwright cookies and local storage) is sent in the body of `POST /api/runner/run` as `savedSessions`, one per role.
- It is held in the runner's memory only, keyed by run, and dropped when the run ends, is aborted or fails, or the Plan is cleared. It is never written to the plan file, the data folder, logs, SSE events, API responses or reports.
- It is checked on arrival: JSON shape `{cookies[], origins[]}` only, at most 256 KB, and every cookie domain must match the target host. A cookie for another site is refused so a session cannot be sent to a site the person did not choose.
- A restart loses it. Approval then asks for it again (`sessionNotSaved`), like a sign-in that was not saved.
- An expired or rejected session gives the failure reason `session-expired`. That role is reported under "Roles not tested and why" and is not run signed out. Expiry in the middle of a run is not handled.

### Docs URL
- The given page and links on the same host are read, at most 20 pages, `text/html` and `text/markdown` only, 1 MB per page.
- Every request goes through the same checks as the target: same-site rule, robots policy, and on a shared machine (beta) the public-address guard, with each redirect checked again. `file:` and non-http addresses are refused.
- A page that can't be read becomes a note in the Plan. It never stops the run. Pages behind a sign-in simply give nothing.

### Issues document
- `issues.md` and `issues.html` are built from the already-redacted report. The HTML is one file with inline CSS, no script, link, font or `http(s)` address. Screenshots are the existing evidence files (visual masks of ADR 0019 apply), embedded as `data:` URIs up to 6 MB in total, then a text note. Files outside the report folder are never read. All page text is escaped.

## Consequences
- Safer than a stored session; costs the person a re-upload after a restart.
- Tests: sentinel cookie value absent from plan, SSE, files and logs; foreign-domain cookie refused; private and redirected docs URLs refused under beta; HTML scanned for external addresses.
- Loosening any of these needs a new ADR.
