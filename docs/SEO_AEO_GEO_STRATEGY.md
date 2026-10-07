# SEO, AEO and GEO strategy

Release check-up already audits other sites for SEO/AEO/GEO (`packages/checkers/src/seo.ts`, `aeo.ts`, `geo.ts`). This change makes the product's own public surface follow the same rules.

## Scope: what is public

Only the Wizard home page (`/`) is public and indexable. Runs, plans, reports and settings show a person's own data, so they are `noindex` (header and meta) and disallowed in `robots.txt`.

## Changes

| Area              | Change                                                                                                                                                                                                                       | Where                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Metadata          | Keyword-aligned title, description, canonical, robots (`max-snippet`), Open Graph, Twitter card, manifest, favicon                                                                                                           | `packages/wizard/index.html`, `public/` |
| Structured data   | One JSON-LD `@graph`: Organization, WebSite, SoftwareApplication, HowTo, FAQPage, linked by `@id`                                                                                                                            | `index.html`                            |
| Entity clarity    | One consistent name ("Release check-up", alias "QA Flow Tester"), category, feature list, one publisher entity reused everywhere                                                                                             | `index.html`, `llms.txt`                |
| AEO               | Question-style headings, a HowTo section and an FAQ with short self-contained answers; visible text mirrors the JSON-LD                                                                                                      | `lib/faq.ts`                            |
| GEO               | `llms.txt` (facts, features, how it works); explicit AI-crawler rules in `robots.txt` (public summary allowed, private routes blocked)                                                                                       | `public/llms.txt`, `public/robots.txt`  |
| Topical authority | Home content covers the whole cluster: QA, accessibility, performance, security, SEO, AEO, GEO                                                                                                                               | `faq.ts`, `llms.txt`                    |
| Technical         | Sitemap; `%ORIGIN%` templating so canonical/sitemap/JSON-LD are absolute for whichever host serves them (`PUBLIC_URL` override); `X-Robots-Tag: noindex` on private pages; `nosniff`; referrer policy; `<noscript>` fallback | `packages/runner/src/ui-static.ts`      |
| Client-side SEO   | Title, description, robots, canonical and OG kept in step per screen                                                                                                                                                         | `lib/title.ts`                          |
| UX                | Native `<details>` FAQ (keyboard accessible, no JS), semantic `section`/`h2` landmarks                                                                                                                                       | `faq.ts`                                |

## Operating notes

- On a real domain or tunnel set `PUBLIC_URL=https://your.domain`.
- Keep `HOME_FAQ` and the steps in `faq.ts` in sync with the FAQPage/HowTo JSON-LD in `index.html`; markup that doesn't match visible content is penalised.
- Unknown paths still return the app shell (200) so client routing works; they are `noindex`, which avoids soft-404 indexing.
- Validate with the product itself: run a check-up on the deployed home page and review its SEO/AEO/GEO findings.
