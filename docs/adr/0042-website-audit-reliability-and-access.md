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
- **AI notes on every recorded page** (amends 0033). Notes run 4 at a time. Before the crawl starts, a pre-flight call checks the key and shows the result as "AI: ready", "AI: key expired" or "AI: no key".
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
- AI cost grows with page count: about one request per recorded page plus one for the whole site. The start screen's "More options" shows an estimate before starting.
- A second speed source exists. Reports must name it, and "lab, one run" is never presented as real-visitor data (0035, 0018).
- Opening the hosted copy to anyone beyond `AUDIT_OWNER_EMAILS` needs a later decision: each person's own Website Audit list and a daily limit. This is not built now.
- Built by T-79 to T-89 in [WEBSITE-AUDIT-RELIABILITY-PLAN.md](../tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md).
