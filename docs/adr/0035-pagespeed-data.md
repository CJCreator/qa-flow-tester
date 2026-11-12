# 0035: Page Speed for the Website Audit Comes from the PageSpeed Insights API

Status: Accepted, 2026-11-03. Amended by [0042](0042-website-audit-reliability-and-access.md) (lab timing by this tool when PageSpeed Insights cannot answer). Amended by T-326 (up to 4 requests at once, the first 20 Sample Pages only). Follow-up record named in [0033](0033-website-audit-entry-point.md). Records Q-03 (speed
part) and Q-32 for REQ-012 and REQ-043.

## Context
The Website Audit shows how fast each Sample Page loads and its Core Web Vitals, with their source (REQ-012). Q-03
picked the outside source: the Google PageSpeed Insights API. REQ-043 (FR-12, Q-32) asks that external data APIs are
used on a free tier first, so an audit costs nothing beyond the tool user's AI key. Field data exists only for sites
with enough Chrome visitors, and a free quota can run out in the middle of an audit. ADR 0018 says every number names
how it was measured and that something not measured is never shown as a clean result.

## Decision
- **One source.** Speed comes from the PageSpeed Insights v5 API,
  `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`, with `strategy=mobile` and `category=performance`.
  It is the only external data API the Website Audit calls (`packages/core/src/audit/ai/pagespeed.ts`). Every value
  carries `source: 'pagespeed-insights'`.
- **Free tier.** The API is free. Without a key the request is keyless (Google's lower anonymous limit). With a free
  Google API key the per-day and per-minute limits are higher; no billing account is needed. Nothing in the tool
  needs payment. Limits are Google's and can change; the tool does not count them, it reacts to the answer.
- **Mobile strategy.** Most visitors in the audited market (India) are on phones, so only the mobile run is asked
  for. One request per Sample Page, never per covered page.
- **Lab vs field wording (ADR 0018).** `lighthouseResult` gives **lab** values: one Lighthouse run by Google on a
  simulated mid-range phone on a slow network (performance score, LCP, CLS, FCP, server response time as TTFB, TBT,
  Speed Index). `loadingExperience` gives **field** values: the 75th percentile of real Chrome visitors over the last
  28 days from the Chrome UX Report (LCP, INP, CLS, FCP, TTFB), with `scope: 'page'`. When the page has too few
  visitors PSI gives the whole origin's data (`origin_fallback` or `originLoadingExperience`), shown with
  `scope: 'origin'`. A report says which method and scope a number has: "lab, one test run" is never presented as
  what real visitors see.
- **Not measured.** A value that was not measured is `status: 'not-measured'` with a reason and no values, so it can
  never read as good:
  - HTTP 429, or a Google quota or rate-limit error (`RESOURCE_EXHAUSTED`, `rateLimitExceeded`,
    `dailyLimitExceeded`...): `quota`. After a quota answer no further PSI request is made in that audit; the
    remaining Sample Pages are `quota` without a request (requests already sent still finish).
  - The whole request did not finish within 90 seconds: `timeout`.
  - DNS or connection failure: `no-network`.
  - A 200 answer without field data for page or origin: field `no-field-data` (lab is still shown).
  - Anything else (Lighthouse could not load the page, a bad key, a redirect, an answer that is not JSON or too
    large): `failed`.
  Up to 4 requests go at once, for the first 20 Sample Pages; the other Sample Pages use this tool's own timing (ADR 0042). A failed page does not stop the others. Stop cancels the requests in flight.
- **Outbound path (ADR 0031).** The request goes through `makeOutboundFetch`: the host is the fixed
  `www.googleapis.com`, resolved once, pinned, public addresses only (even on a local run), no redirects followed.
  The audited page address is only the `url` query parameter and has already passed the public-address check of the
  crawl.
- **Key storage (ADR 0034).** The optional key is the named service key `pagespeed`, read with
  `resolveServiceKey('pagespeed')`: OS keychain, then the encrypted `.qa-keys.json`, then `PAGESPEED_API_KEY`. It is
  sent in the `x-goog-api-key` header, never in the request address, and never appears in returned values, errors or
  log lines. A key that cannot be read gives a keyless request.

## Why this, not running Lighthouse locally
A local Lighthouse run would need no quota, but its numbers depend on the tool user's machine and network, and it
has no field data. PSI gives the same lab setup for every audit and the only free source of real-visitor data for a
site the tool user does not own. The Check-up's own browser speed measurement is unchanged.

## Consequences
- Keyless audits share Google's anonymous limit and can hit `quota` sooner; the audit settings let the tool user save
  a free key.
- A PSI run takes 10 to 60 seconds per page, so speed adds minutes to an audit with many Sample Pages.
- Field data is often missing for small sites; reports show `no-field-data` instead of a value.
- The hosted beta must keep the key in the visitor's session (ADR 0034 consequences) before it offers the key setting.
