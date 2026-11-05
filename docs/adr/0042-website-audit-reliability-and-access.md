# 0042: Website Audit Reliability and Access

Status: Accepted, 2026-11-05 (owner's answers in a grilling session, 2026-11-05). It amends:
- [0033](0033-website-audit-entry-point.md): private addresses (Q-22), and AI notes on Sample Pages only.
- [0035](0035-pagespeed-data.md): PageSpeed Insights as the one speed source.
- [0037](0037-route-access-levels.md): D-004, audit rows closed on the beta copy.

[0018](0018-claim-wording.md) wording and the "no release verdict" rule of 0033 are unchanged.

## Context
A diagnosis on 2026-11-05 (local runner, `example.com`, `htmx.org` and the owner's own dev tunnel) found that the Website Audit does not crash. Instead it finishes as `done` with wrong or empty content, and no one is told why:

1. **Tunnel audits read the tunnel's warning page.** An audit of a `*.devtunnels.ms` address records one page: Microsoft's "You are about to connect to a developer tunnel" page. The audit's own Chromium (`core/src/audit/crawl/crawl.ts:271-277`) never sends `X-Tunnel-Skip-AntiPhishing-Page`; the Check-up's browser does (`core/src/browser.ts:88-94`). The owner used a tunnel because `localhost` and LAN addresses are refused with `ERR_PRIVATE_ADDRESS`.
2. **Every AI step fails silently.** An expired key returns `401 API key expired`. Three places turn any error into a bare "failed" and discard the reason: `assessment.ts:234`, `page-recommendation.ts:257` and `preview/generate.ts:97`. The user only sees "The AI did not answer", and the AI preview answers 502.
3. **Speed is never measured.** The keyless PageSpeed Insights quota is used up (`429`), so every page shows `reason: 'quota'`.
4. **Real errors are hidden.** Any crawl exception becomes `ERR_UNREACHABLE` ("could not be read to the end"), with no log line (`runner/src/routes/audit-crawl.ts:289-312`). A site whose home page answers 4xx or 5xx, which includes bot-blocking sites, is refused before a browser ever tries.
5. **The hosted copy blocks audits.** `RUNNER_BETA=1` closes every audit row except Shared Links (0037 D-004), and `BetaAuditNotice` replaces the screens.

## Decision
- **No silent wrong result.** A Website Audit finishes `done` only when it read the site:
  - **Interstitial Pages.** A tunnel warning (devtunnels, ngrok), a bot challenge (Cloudflare-style "checking your browser") or an empty body on the start page is detected. The page is retried with the skip headers in a real browser. If it is still an Interstitial Page, the audit fails with `ERR_SITE_BLOCKED` ("This site blocks automated visitors"). It never records the Interstitial Page as the site.
  - The audit's Chromium always sends `X-Tunnel-Skip-AntiPhishing-Page: true` and `ngrok-skip-browser-warning: 1`.
  - **Home-page check.** A 4xx or 5xx home page no longer refuses at once. A real-browser load is tried first, and only a failed browser load refuses.
  - **Sanity flag.** When 1 page was recorded but the sitemap or the start page's links list more on the same site, the result carries a note: "Only 1 page was read; the rest could not be reached". The wizard shows the note on the results.
- **Specific errors, logged.** New codes: `ERR_SITE_BLOCKED`, `ERR_DNS`, `ERR_BROWSER_LAUNCH` and `ERR_PIPELINE`, beside `ERR_UNREACHABLE` and `ERR_PRIVATE_ADDRESS`. Every crawl and pipeline failure writes one structured log line: code, stage, message and the redacted address. AI failures keep a reason: `key-expired` (401/403), `quota` (429), `timeout` or `provider-error`, with the provider's message, redacted.
- **Private addresses on a local runner.** `localhost`, loopback and private LAN addresses are accepted when the runner is local: not a beta copy and bound to a loopback host. The hosted copy keeps public addresses only. This amends 0033's Q-22 rule.
  - The runner sets this, never the start body. A shared machine's browser policy still turns it off.
  - A local crawl pins no address, so Chromium reaches `localhost` on `::1` or `127.0.0.1`, whichever the server listens on.
  - On a local run, `safeGet` tries a name's other addresses when one refuses. Vite dev servers often listen on `::1` only while the resolver prefers `127.0.0.1`. A public name keeps one pinned address.
- **Audit-only time limits.** One page load may take 30 s (its retry 45 s), the whole crawl 60 min, and the start address check 30 s. The Check-up keeps 10 s and 10 min. `QA_CRAWL_MAX_MINUTES` still overrides the crawl limit. A dev server behind a tunnel took 10 to 25 s per page, so the old limits skipped half a site and refused the start with a 422.
- **AI notes on every recorded page** (amends 0033). Notes run 4 at a time. Before the crawl starts, a pre-flight call checks the key and shows the result as "AI: ready", "AI: key expired" or "AI: no key".
- **AI keys that cannot be used** (added 2026-11-05, after every AI step failed with a Gemini key and Google sign-in both on the computer):
  - **Gemini model from the key.** Saving a Gemini key lists the models that key can use, tries them, and keeps the first that answers, free-tier Flash models first. Settings offers "Choose automatically (recommended)" and the key's own list. A key that no model answers is refused with the reason, and is not saved. A `-latest` alias is never sent to Vertex AI, which does not know it.
  - **Gemini falls back to Google sign-in.** When the AI Studio key is refused (401, 402, 403, 429, or an invalid key) and the computer has Application Default Credentials, the same request goes to Vertex AI. If both fail, the error names both.
  - **The audit falls back to Google sign-in, on a local runner only.** With no saved key, or a saved key the provider refuses (401, 402, 403, expired, out of credit), the audit uses Gemini through Google sign-in for the rest of the run. Parallel requests share one switch. A beta copy never uses the host's credentials.
  - **OpenRouter reasoning.** When the free router picks a model that cannot turn reasoning off, the request is sent once more with low reasoning, left out of the answer.
  - **One log line per AI failure:** `[Website Audit] AI request failed (provider): <message>`. Keys and tokens are redacted, and the line is capped at 300 characters.
- **Template text when AI cannot run.** Without a working key, the Proposal, the Pitch Glimpse, the Owner Audit and the AI preview use template text filled from the findings. AI improves the wording when a key works. A failed AI step never leaves an Audit Document empty and never returns a bare 502.
- **Speed without a PageSpeed key** (amends 0035):
  - When PageSpeed Insights cannot answer (no key, quota, error), the Sample Pages are measured in the audit's own Chromium.
  - The measurement reuses the Check-up's lab profile (`packages/checkers/src/performance.ts`).
  - The values are labelled `source: 'this-tool'` and worded "lab, measured by this tool, one run".
  - PageSpeed Insights stays the first choice when it works.
- **Audit Documents at the end of the audit.**
  - A `writing-documents` stage builds every Audit Document, the Pitch Glimpse and the Owner Audit in parallel, in Markdown and HTML. They are stored with the version.
  - PDF and Word are made on export, as today.
  - A document that fails is listed as not written, with its reason; the audit still finishes.
- **Skipped Pages are reported, and the site's own failures are findings.**
  - A page that answers an error or times out after its retry is a Skipped Page: `http-error`, `timeout` or `did-not-load`.
  - When the site caused it (an HTTP error, or a timeout on a page that answered other pages fine), it is also a finding in the Findings Audit Document, with the status code or the wait time.
  - When the tool caused it (browser crash), the page is listed as not checked.
- **Hosted access** (amends 0037 D-004):
  - On a beta copy, the audit rows serve the owner: whoever holds the access key, or a Google account signed in through the existing Helper sign-in whose email is in `AUDIT_OWNER_EMAILS`. Everyone else is refused as before.
  - `AUDIT_DAILY_LIMIT` caps audit starts per owner email per day. Unset means unlimited, which is the setting for now.
  - CPU stays request-based, at $0. The progress screen says "Keep this tab open until the audit finishes" and reconnects to the stream on its own.
- **Interrupted runs.** On start-up, the runner marks any version still `running` as `stopped`, with the reason "the tool restarted". A stream request for an unknown run answers the stored status, not a bare 404.
- **Busy runner.** `ERR_RUN_IN_PROGRESS` names what is running (a Check-up or a Website Audit) and links to it. There is no queue.

## Consequences
- Audits of tunnels and local dev servers read the real site. A local runner can audit the owner's own App without a tunnel.
- AI cost grows with page count: about one request per recorded page plus one for the whole site. The start screen's "Limits (optional)" panel shows an estimate before starting.
- A second speed source exists. Reports must name it, and "lab, one run" is never presented as real-visitor data (0035, 0018).
- Opening the hosted copy to anyone beyond `AUDIT_OWNER_EMAILS` needs a later decision: each person's own Website Audit list and a daily limit. This is not built now.
- The rest is built by T-79 to T-90 in [WEBSITE-AUDIT-RELIABILITY-PLAN.md](../tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md).

## Already built (2026-11-05)
- **`feaa7f9`** (merged through `aed2615`, Prettier fix in #57):
  - the tunnel skip headers, on same-site requests only;
  - a start page that is still a tunnel warning or a bot check fails the audit with a plain sentence (`AuditCrawlBlockedError`, `core/src/audit/crawl/interstitial.ts`); it is sent as `ERR_INVALID_REQUEST` until T-79 adds `ERR_SITE_BLOCKED`;
  - the audit-only time limits.
- **#58 (`5bef5e9`):**
  - private addresses on a local runner (`AuditWiring.localRun` → `allowPrivateAddresses`);
  - the `safeGet` address fallback;
  - `makeRequestGuard(deps, { allowPrivate })`.
- **In review, #59 (`feat/audit-parallel-crawl`, not merged):**
  - the "AI keys that cannot be used" decision above, in full;
  - AI notes 4 at a time;
  - a local run of htmx.org, 5 pages: 30 of 30 page areas and 6 of 6 site areas done, 5 of 5 recommendations decided by AI, no AI failure logged.
  - Not built yet: `classifyAiError`, the pre-flight call and the template preview (T-81).
- **Verified on the owner's app behind devtunnels:** 19 of 24 pages recorded, against 1 before. On a Vite dev server listening on `[::1]` only, through `http://localhost:3002/`: 11 pages, robots.txt read, no false broken links.
