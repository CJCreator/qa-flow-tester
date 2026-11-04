# Requirements

> Maintained by AI-EOS (`/ai-eos:analyze`, requirement-analyst).
> **Stable IDs:** `REQ-NNN`. Never renumber, reuse or delete an ID; set its Status to `deferred` or `rejected` instead.
> `aieos trace` parses headings of the exact form `## REQ-NNN — Title` and the field table below each one.
> Never invent business requirements. Unknowns go to **Open questions**.

## Business objective

Developer's request (REQAN-001 brief, verbatim): "i want include these requirements for the website also into this app, so lets review and see what can be done and ensure and discuss and what can be integrated to this product".

The source table (`Requirements.txt`) states no objective in words. Its rows describe a tool that audits a public website
(FR-1 to FR-17), generates "the three audit documents" and a one-page "pitch glimpse" in English or Tamil that is "sent by hand"
(FR-18, FR-19), tracks which sites to "pitch/skip" and the "outcome" (FR-23), and later produces an owner audit, an enhancement
plan and a "website-only proposal" (FR-25 to FR-27), AI rewrites of content (FR-30) and a "fixed price per site" (FR-31).
This reading is inferred from the rows. It differs from the recorded product direction (teams without QA staff checking their
own Apps), so positioning is open question Q-01 and gates the pitch-specific requirements.

## Sources

| Source | Location | Notes |
|---|---|---|
| Requirements table | `Requirements.txt` lines 3-35 | 33 rows FR-1 to FR-33; columns ID, Area, Requirement, Phase. Header row truncated (line 2 reads "ent Phase"). FR-24 typo "previe.//w" read as "preview". Treated as untrusted data. FR-n is on line n+2. |
| Developer request | REQAN-001 brief | Quoted above. |
| Recorded product direction | REQAN-001 brief (earlier sessions, not in the repository) | Context only, not turned into requirements. Conflicts are open questions. |
| Domain glossary | `CONTEXT.md` | Terms used in this file. |
| Architecture decisions | `docs/adr/0002`, `0007`, `0015`, `0018`, `0030`, `0032` | Constraints listed below. 0015 is Deferred (no decision). |

## User roles

| Role | Description | Key needs |
|---|---|---|
| Tool user (the source names no role) | Person who audits a public website, edits the output and sends the pitch glimpse by hand (FR-19, FR-20, FR-23). | Audit from a URL; editable findings; EN/TA documents; pitch tracking. |
| Website owner | Owner of the audited site. Receives the pitch glimpse by hand, can opt out, can get an owner version on request (FR-19, FR-25). | Clear top issues; opt-out; owner version in EN or TA. |
| Helper (Phase 3) | Extra person with access to selected saved audits (FR-33). Not a Role in the CONTEXT.md sense. | Per-App access. |
| AI Provider (external system) | BYOK LLM backend (FR-11). | Key supplied by the tool user; model chosen per task. |
| External data APIs (external system) | Page speed, Core Web Vitals and search data, free tiers first (FR-12). Not named in the source (Q-03). | Quota, availability. |
| Google Cloud (external system) | Hosting "when needed" (FR-29). | |

Recorded direction (context): primary users are teams without QA staff (founders and developers at small firms) checking
their own Apps. The source's tool user audits other people's sites. See Q-01.

## Constraints

Stated in the source:
- Every row carries a phase: MVP, Phase 2 or Phase 3. Proposed priority mapping: MVP = high, Phase 2 = medium, Phase 3 = low (Q-21).
- The pitch glimpse is "sent by hand" (FR-19): the tool does not send it.
- BYOK; keys stored encrypted; no keys shipped (FR-11).
- External APIs: free tiers first (FR-12).
- Crawl respects robots.txt and rate limits (FR-3); login and payment areas are flagged and skipped (FR-6).
- English and Tamil in MVP (FR-13); Hindi and other Indian languages in Phase 3 (FR-32).
- Local by default; Google Cloud when needed (FR-29).
- Rewrites happen after approval and reuse no original wording (FR-30).

From the repository (accepted decisions any implementation must respect):
- ADR 0018 (claim wording): never "compliant", "certified", "secure", "fully accessible", "passes WCAG"; say what was checked
  and what was not; say how a number was measured; a step that did not run is reported as not checked. Applies to REQ-012,
  REQ-016, REQ-018, REQ-019, REQ-025, REQ-038.
- ADR 0030 and the Test Copy definition (`CONTEXT.md`): on Apps that are not a Test Copy, the tool only reads (visits and GETs).
  No form submissions, no Security Probes.
- ADR 0007: third-party sites are explored in Safe Interaction Mode (no form submits, no mutations, no off-domain links).
- ADR 0015: pacing rules for live sites are Deferred, no decision. REQ-035 needs that decision.
- ADR 0032: the hosted copy runs on Cloud Run, `--max-instances 1`, sessions in memory, `/tmp` wiped on redeploy or
  scale-down. Affects REQ-028 and REQ-033.
- ADR 0002: key resolution order (OS keychain, legacy `.qa-keys.json` file, environment variables); the beta copy keeps keys in
  the session only.
- `CLAUDE.md`: use `CONTEXT.md` terms; no Node-only code in the wizard bundle.

Recorded product direction (context from earlier sessions, not in the repository, not requirements): teams without QA staff;
browser-only hosted, $0 hosting until revenue; free tier plus monthly plans, global, USD; findings shared as Markdown and JSON;
read-only checks on any site, active probes only on Verified Domains; first check-up on the product's key, then BYOK.
Conflicts: FR-19, FR-23, FR-25, FR-27 (use case, Q-01); FR-31 (pricing, Q-05); FR-29 (hosting, Q-06); FR-11 (keys, Q-07).

Glossary mapping (`CONTEXT.md`):
- Source "site" is written as App, except for web-only ideas.
- Source "project" (FR-28, FR-33) is an _Avoid_ word for App; written as "saved App" or "per-App".
- Source "navigation map" (FR-7) and "sitemap" (FR-20) are written as App Flow plus page hierarchy. App Flow avoids "sitemap";
  `sitemap.xml` (FR-4) is the file name and stays.
- Source "login areas" (FR-6) is written as Sign-in Wall.
- Source "Plan" (FR-26) collides with the glossary Plan; working name "enhancement roadmap" (Q-18).
- Source "helper accounts" (FR-33) are tool users, not Roles.
- Whether one audit pass is a Check-up or needs a new term is part of Q-01. This file says "audit".

## Security, privacy and compliance considerations

- Data classes handled:
  - public content of third-party sites (text, images, screenshots, form fields);
  - business contact details found on those sites (NAP: name, address, phone), which can identify a sole trader;
  - the tool user's notes and outcomes (FR-23), which may hold owner contact details;
  - AI keys (secrets);
  - helper account credentials (Phase 3).
- No payment data is processed in MVP: payment areas are flagged and skipped (REQ-036). FR-31 pricing could bring payment data
  into scope (Q-05).
- Third-party site content is sent to the AI Provider behind the tool user's key (REQ-016, REQ-030).
- AI keys: encrypted at rest (REQ-040) and never shipped (REQ-041). Not in the source, recommended: keys never appear in exports,
  documents or logs.
- Authentication and authorization: helper accounts need sign-in to the tool itself and per-App access control (REQ-033).
  Today the hosted copy uses one access key (ADR 0032).
- Read-only boundary: the audit never submits forms or sends probes to sites that are not a Test Copy (ADR 0030, ADR 0007).
- Legal exposure, recorded as risks. The tool makes no compliance claim:
  - unsolicited pitches to owners (FR-19 opt-out wording implies outreach rules);
  - crawling third-party sites (terms of service, robots.txt, load);
  - copying screenshots and content of third-party sites into documents (FR-19, FR-24);
  - AI rewrites of third-party copy (FR-30).
- Retention and deletion of stored third-party content, screenshots and notes: not stated (Q-30).
- Never claim compliance with any regulation or standard (ADR 0018). Accessibility results name the standard and say
  "automatic checks only".

## Requirement format

Copy this block for each requirement (the fenced example is ignored by the parser):

```markdown
## REQ-001 — Short imperative title

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Business value | Why this matters, in one sentence |
| Verification method | test |
| Dependencies | REQ-000, external system X |
| Risks | What could go wrong |

**Description:** One paragraph.

**Functional expectations:**
- Observable behavior 1

**Acceptance criteria:**
- AC-1: Given <context>, when <action>, then <observable result>.
```

Allowed values: Type `functional | non-functional`; Priority `critical | high | medium | low`;
Status `proposed | approved | implemented | verified | deferred | rejected`;
Verification method `test | inspection | demo | analysis`.

## Source traceability

REQ-001 to REQ-033 map one-to-one to FR-1 to FR-33. FRs that bundle independent requirements were split. The extra parts are
REQ-034 to REQ-045, and each one keeps its source FR in its `Source` row.

| Source FR | Area | Phase | Requirement(s) |
|---|---|---|---|
| FR-1 | Input | MVP | REQ-001 |
| FR-2 | Input | MVP | REQ-002 |
| FR-3 | Crawl | MVP | REQ-003, REQ-034, REQ-035 |
| FR-4 | Crawl | MVP | REQ-004 |
| FR-5 | Crawl | MVP | REQ-005 |
| FR-6 | Crawl | MVP | REQ-006, REQ-036 |
| FR-7 | Structure | MVP | REQ-007 |
| FR-8 | Structure | MVP | REQ-008 |
| FR-9 | Content | MVP | REQ-009 |
| FR-10 | Content | MVP | REQ-010, REQ-037, REQ-038 |
| FR-11 | AI providers | MVP | REQ-011, REQ-039, REQ-040, REQ-041 |
| FR-12 | Data | MVP | REQ-012, REQ-042, REQ-043 |
| FR-13 | Language | MVP | REQ-013, REQ-044 |
| FR-14 | Content | MVP | REQ-014 |
| FR-15 | Marketing | MVP | REQ-015 |
| FR-16 | Analysis | MVP | REQ-016 |
| FR-17 | Analysis | MVP | REQ-017, REQ-045 |
| FR-18 | Documents | MVP | REQ-018 (pitch glimpse detail in REQ-019) |
| FR-19 | Pitch | MVP | REQ-019 |
| FR-20 | Review | MVP | REQ-020 |
| FR-21 | Export | MVP | REQ-021 |
| FR-22 | Export | Phase 2 | REQ-022 |
| FR-23 | Shortlist | Phase 2 | REQ-023 |
| FR-24 | Design glimpse | Phase 2 | REQ-024 |
| FR-25 | Owner audit | Phase 2 | REQ-025 |
| FR-26 | Plan | Phase 2 | REQ-026 |
| FR-27 | Proposal | Phase 2 | REQ-027 |
| FR-28 | Projects | Phase 2 | REQ-028 |
| FR-29 | Hosting | Phase 2 | REQ-029 |
| FR-30 | Rewrite | Phase 3 | REQ-030 |
| FR-31 | Pricing | Phase 3 | REQ-031 |
| FR-32 | Language | Phase 3 | REQ-032 |
| FR-33 | Helpers | Phase 3 | REQ-033 |

## Overlap with the existing product (indicative)

These rows come from targeted searches, not from reading the implementation logic. Repository analysis must confirm them
before planning.

| Source FR | What exists today | Evidence | Gap seen |
|---|---|---|---|
| FR-2 | Max pages setting | `packages/types/src/checkup-api.ts:79` (`maxPages`) | Depth, include and exclude paths not found in that file |
| FR-3 | robots.txt skip on public sites; Skipped Page reason `robots` | `packages/core/src/discovery/deterministic-spider.ts:82-83`, `packages/core/src/competitive/robots.ts`, `CONTEXT.md:184` | Pacing: ADR 0015 Deferred |
| FR-4 | Seeding from `/sitemap.xml` and robots.txt `Sitemap:` lines | `packages/core/src/discovery/deterministic-spider.ts:405-412` | Merge and de-duplication not confirmed |
| FR-5 | Browser-based crawl | `CONTEXT.md:16` (Deterministic Spider) | None seen |
| FR-6 | Sign-in Wall and Skipped Page reason `sign-in`; Safety Filter pauses payment actions | `CONTEXT.md:151-157`, `CONTEXT.md:179-184` | No `payment` skip reason |
| FR-7 | App Flow page graph | `CONTEXT.md:31-33` | Link region (menu, footer, breadcrumb) and hierarchy not confirmed |
| FR-10, FR-14, FR-15 | axe, SEO/AEO/GEO, performance and marketing checkers; Navigation Check for broken links; `tel:` and LocalBusiness handling | `CLAUDE.md` (Layout), `CONTEXT.md:111-113`, `packages/checkers/src/seo.ts`, `packages/checkers/src/aeo.ts` | Coverage of each listed item not confirmed |
| FR-11 | BYOK with four AI Providers; OS keychain first, legacy `.qa-keys.json` fallback | `docs/adr/0002-multi-provider-byok-ai-adapter.md:6-12` | No `createCipheriv` or `aes-256-gcm` in `packages/`; model per task not confirmed |
| FR-12 | Speed measured in a test browser | `packages/checkers/src/performance.ts:57` | No external API call found |
| FR-17 | Effort and impact ranking for Competitive Benchmarks | `docs/adr/0007-competitive-reference-flow-benchmarking.md:17-19` | Not confirmed for own-site findings; no redesign or repair verdict |
| FR-21 | Findings shared as Markdown and JSON (recorded direction) | REQAN-001 brief | "Laid out for Claude Code" undefined |
| FR-28 | Past check-ups screen | `packages/wizard/src/screens/PastCheckupsScreen.tsx` | Hosted copy loses `/tmp` data (`docs/adr/0032-google-cloud-only-hosting.md:27`) |
| FR-29 | Local `pnpm start`; hosted copy on Cloud Run | `CLAUDE.md` (Commands), `docs/adr/0032-google-cloud-only-hosting.md:12-15` | Which one is the default is undecided (Q-06) |
| Third-party read-only exploration | Safe Interaction Mode | `docs/adr/0007-competitive-reference-flow-benchmarking.md:11-13` | None seen |

Not assessed (no search run): FR-1, FR-8, FR-9, FR-13, FR-16, FR-18 to FR-20, FR-22 to FR-27, FR-30 to FR-33.

## Requirements

## REQ-001 — Accept a public URL and confirm it is reachable

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | proposed |
| Source | FR-1 (Input) |
| Phase | MVP |
| Business value | Every audit starts from a URL the tool can reach (FR-1). |
| Verification method | test |
| Dependencies | none |
| Risks | "Public" and "reachable" are undefined (Q-22). The Check-up also accepts local and private addresses for Test Copies; a public-only rule must not remove that. |

**Description:** The tool user enters the URL of a public website. Before the audit starts, the tool confirms the URL is reachable.

**Functional expectations:**
- Accepts one URL as the audit's start address.
- Rejects input that is not a URL.
- Confirms reachability before any page is crawled, and says why when the URL is not reachable.

**Acceptance criteria:**
- AC-1: Given a public URL that answers, when the tool user submits it, then the audit can start.
- AC-2: Given a URL whose host does not resolve or does not answer, when submitted, then the tool reports it as unreachable and no crawl starts.
- AC-3: Given input that is not a URL, when submitted, then the tool rejects it with a message and no crawl starts.

## REQ-002 — Set crawl limits: max pages, depth, include and exclude paths

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-2 (Input) |
| Phase | MVP |
| Business value | Keeps an audit to the part of the site the tool user wants (FR-2). |
| Verification method | test |
| Dependencies | REQ-003 |
| Risks | The source gives no defaults, depth rule or pattern syntax (Q-11). The Skipped Page reasons in CONTEXT.md have none for an excluded path. |

**Description:** Before the crawl starts, the tool user sets how far it goes.

**Functional expectations:**
- Max pages.
- Max depth.
- Include paths: only matching pages are crawled.
- Exclude paths: matching pages are not crawled.

**Acceptance criteria:**
- AC-1: Given max pages set to N and an App with more than N internal pages, when the crawl runs, then at most N pages are recorded and the rest are listed as Skipped Pages with reason `page-limit`.
- AC-2: Given max depth set to D, when the crawl runs, then no page deeper than D is recorded (depth rule per Q-11).
- AC-3: Given an exclude path, when the crawl meets a matching URL, then that page is not recorded.
- AC-4: Given one or more include paths, when the crawl runs, then every recorded page matches an include path (start page handling per Q-11).

## REQ-003 — Crawl the App's internal pages

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-3 (Crawl), crawl part; robots.txt in REQ-034, rate limits in REQ-035 |
| Phase | MVP |
| Business value | The audit covers the site, not one page (FR-3). |
| Verification method | test |
| Dependencies | REQ-001, REQ-002, REQ-034, REQ-035 |
| Risks | Crawling third-party sites without the owner's knowledge (Security section, Q-01). |

**Description:** Starting from the URL, the Deterministic Spider follows links to the App's internal pages (hosts in the Domain Allowlist) and records each page. Exploration only reads (ADR 0030): it visits pages and never submits forms.

**Functional expectations:**
- Follows links to hosts in the Domain Allowlist.
- Lists links to other hosts as leaving the site, without crawling them.
- Submits no forms.

**Acceptance criteria:**
- AC-1: Given a start page that links to other pages on the same host, when the crawl runs, then those pages are recorded, within the REQ-002 limits.
- AC-2: Given a link to a host outside the Domain Allowlist, when the crawl finds it, then the page is not crawled and the link is listed as leaving the site.
- AC-3: Given a page with a form, when the crawl visits it, then no form is submitted.

## REQ-004 — Read sitemap.xml and merge it with discovered links

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-4 (Crawl) |
| Phase | MVP |
| Business value | Finds pages that no menu or link reaches (FR-4). |
| Verification method | test |
| Dependencies | REQ-003, REQ-034 |
| Risks | A large sitemap.xml can exceed max pages; the source does not say which pages win the limit. |

**Description:** The crawl reads the App's sitemap.xml and adds its pages to the pages found through links, without duplicates.

**Functional expectations:**
- Pages listed only in sitemap.xml are crawled.
- A page found both ways is recorded once.

**Acceptance criteria:**
- AC-1: Given sitemap.xml lists a page that no crawled page links to, when the crawl runs, then that page is crawled, within the REQ-002 limits.
- AC-2: Given a page that is both linked and listed in sitemap.xml, when the results are merged, then the page is recorded once.
- AC-3: Given the App has no sitemap.xml, when the crawl runs, then it continues from discovered links without error.

## REQ-005 — Render JavaScript-heavy pages

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-5 (Crawl) |
| Phase | MVP |
| Business value | Sites built with client-side frameworks are audited as visitors see them (FR-5). |
| Verification method | test |
| Dependencies | REQ-003 |
| Risks | Rendering adds time per page; slow pages can hit the timeout (Skipped Page reason `timeout`). |

**Description:** Pages are rendered in a browser before content and links are extracted.

**Functional expectations:**
- Content and links that JavaScript adds after load are extracted and followed.

**Acceptance criteria:**
- AC-1: Given a page whose text and links are inserted by JavaScript after load, when crawled, then the extracted content (REQ-009) and the followed links include them.

## REQ-006 — Flag and skip sign-in areas (source: "login areas")

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-6 (Crawl), login part; payment part in REQ-036 |
| Phase | MVP |
| Business value | The audit stays out of areas that need an account (FR-6). |
| Verification method | test |
| Dependencies | REQ-003 |
| Risks | A missed detection lets the crawl into account areas. A false detection hides public pages. |

**Description:** The crawl detects Sign-in Walls, flags them in the output and does not go past them. No sign-in is attempted.

**Functional expectations:**
- Sign-in Walls are flagged and listed as Skipped Pages with reason `sign-in`.
- No credentials are entered.

**Acceptance criteria:**
- AC-1: Given a page that answers 401 or is nothing but a sign-in form, when the crawl reaches it, then it is flagged in the output, listed as a Skipped Page with reason `sign-in`, and no sign-in is attempted.

## REQ-007 — Map the page hierarchy and navigation

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-7 (Structure) |
| Phase | MVP |
| Business value | Shows how the site is organised and how visitors move through it (FR-7). |
| Verification method | test |
| Dependencies | REQ-003 |
| Risks | How the hierarchy is built is undefined (Q-23). |

**Description:** From the crawl, the tool builds the page hierarchy and a navigation map. The map records each internal link with the region it sits in: menus, footer, breadcrumbs or other internal links. It builds on the App Flow.

**Functional expectations:**
- Page hierarchy covering every recorded page.
- Every internal link recorded with its target page and its region.

**Acceptance criteria:**
- AC-1: Given a page with a header menu, footer links, breadcrumbs and links in its body, when mapped, then each internal link is recorded with its target page and one region: menu, footer, breadcrumb or internal link.
- AC-2: Given a finished crawl, when the hierarchy is produced, then every recorded page appears in it exactly once.

## REQ-008 — Break each page into sections with their content

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-8 (Structure) |
| Phase | MVP |
| Business value | Lets findings point to a part of a page (FR-8, used by FR-17). |
| Verification method | test |
| Dependencies | REQ-009 |
| Risks | How section boundaries are found is undefined (Q-23). |

**Description:** Each recorded page is split into sections, in page order, each with its own content.

**Functional expectations:**
- Sections listed in page order.
- Each section carries its content.

**Acceptance criteria:**
- AC-1: Given a page with distinct sections, when analysed, then the output lists the sections in page order, each with its own content.
- AC-2: Given any recorded page, when analysed, then each part of its extracted text belongs to exactly one section.

## REQ-009 — Extract each page's content

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-9 (Content) |
| Phase | MVP |
| Business value | Every later finding and document is built from these facts (FR-9). |
| Verification method | test |
| Dependencies | REQ-003, REQ-005 |
| Risks | How CTAs are identified is undefined (Q-33). Extracted text can contain personal data (Security section). |

**Description:** For each recorded page, the tool extracts the elements FR-9 lists.

**Functional expectations:**
- Text.
- Headings, with their level.
- Images, with their alt text, or a note that alt is missing.
- Links.
- Forms and their fields. Forms are read, never submitted.
- Metadata, including title and description (needed by REQ-014).
- CTAs.

**Acceptance criteria:**
- AC-1: Given a page containing each listed element, when extracted, then the page's output contains its text, headings with levels, images with alt text, links, forms with their fields, title, description and CTAs.
- AC-2: Given an image with no alt attribute, when extracted, then the output records that its alt is missing.

## REQ-010 — Record the CMS or framework

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-10 (Content), CMS/framework part; mobile layout in REQ-037, accessibility and SEO basics in REQ-038 |
| Phase | MVP |
| Business value | Tells the tool user what the site is built with (FR-10). |
| Verification method | test |
| Dependencies | REQ-003 |
| Risks | Which CMSs and frameworks must be recognised is undefined (Q-28). |

**Description:** The audit records the CMS or framework the App is built with.

**Functional expectations:**
- Names a recognised CMS or framework.
- Says "not identified" otherwise.

**Acceptance criteria:**
- AC-1: Given a page built with a recognised CMS or framework, when audited, then the output names it.
- AC-2: Given a page whose CMS or framework is not recognised, when audited, then the output says it was not identified instead of leaving it blank.

## REQ-011 — Use the tool user's own AI keys (BYOK)

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-11 (AI providers), BYOK part; model per task in REQ-039, encryption in REQ-040, no keys shipped in REQ-041 |
| Phase | MVP |
| Business value | AI steps run on the tool user's own AI Provider account (FR-11). |
| Verification method | test |
| Dependencies | REQ-040, REQ-041 |
| Risks | Conflicts with the recorded direction that the first check-up runs on the product's key (Q-07). Third-party site content is sent to the AI Provider. |

**Description:** The tool user supplies keys for one or more AI Providers, and the audit's AI steps use those keys.

**Functional expectations:**
- One or more AI Providers can be configured with the tool user's key.
- AI steps use the configured key.

**Acceptance criteria:**
- AC-1: Given the tool user has saved a key for an AI Provider, when an AI step runs, then it calls that provider with that key.
- AC-2: Given the tool user has supplied no key, when an AI step is needed, then the step does not run and the tool says a key is needed (pending Q-07).

## REQ-012 — Get page speed and Core Web Vitals from an external API

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-12 (Data), speed part; search data in REQ-042, free tiers in REQ-043 |
| Phase | MVP |
| Business value | Speed figures from an outside source (FR-12). |
| Verification method | test |
| Dependencies | REQ-043 |
| Risks | The API is not named (Q-03). Free-tier quotas can run out during an audit. Field data exists only for sites with enough traffic. |

**Description:** For audited pages, the tool gets page speed and Core Web Vitals from an external API and shows them with their source.

**Decision 2026-10-30 (Q-03):** use the Google PageSpeed Insights API (free tier, free Google API key) for lab speed and real-user Core Web Vitals.

**Functional expectations:**
- Each value names its API and how it was measured (ADR 0018).
- A missing value is reported as not measured.

**Acceptance criteria:**
- AC-1: Given a public page, when audited, then the output shows its page speed and Core Web Vitals values from the external API, naming the API and how the values were measured.
- AC-2: Given the API fails or its free quota is used up, when the page is audited, then the output says the values were not measured and never shows them as good.

## REQ-013 — Detect each page's language

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-13 (Language), detection part; EN/TA handling in REQ-044 |
| Phase | MVP |
| Business value | Lets extraction, audit and documents handle English and Tamil (FR-13). |
| Verification method | test |
| Dependencies | REQ-009 |
| Risks | Pages mixing Tamil and English (Q-13). |

**Description:** The audit records the language of each page.

**Functional expectations:**
- Language recorded per page.

**Acceptance criteria:**
- AC-1: Given a page whose main text is Tamil, when audited, then its language is recorded as Tamil.
- AC-2: Given a page whose main text is English, when audited, then its language is recorded as English.

## REQ-014 — Report content problems

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-14 (Content) |
| Phase | MVP |
| Business value | Finds common content defects (FR-14). |
| Verification method | test |
| Dependencies | REQ-003, REQ-009, REQ-017 |
| Risks | Duplicate content and heading problems are undefined (Q-26). Alt text quality needs a person (ADR 0018); only missing alt can be decided by rule. |

**Description:** The audit reports the content problems FR-14 lists. Each finding cites its page (and section, REQ-017).

**Functional expectations:**
- Broken links.
- Duplicate content (criteria per Q-26).
- Missing and duplicate titles.
- Missing and duplicate descriptions.
- Heading problems (criteria per Q-26).
- Alt problems.

**Acceptance criteria:**
- AC-1: Given an internal link whose target answers 404, when audited, then a broken-link finding names the page and the link.
- AC-2: Given two pages with the same title, when audited, then a duplicate-title finding lists both pages.
- AC-3: Given a page with no title, when audited, then a missing-title finding names the page.
- AC-4: Given a page with no meta description, when audited, then a missing-description finding names the page.
- AC-5: Given two pages with the same meta description, when audited, then a duplicate-description finding lists both pages.
- AC-6: Given an image with no alt attribute, when audited, then an alt finding names the page and the image.

## REQ-015 — Report marketing signals

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-15 (Marketing) |
| Phase | MVP |
| Business value | Shows how well the site supports search, sharing and leads (FR-15). |
| Verification method | test |
| Dependencies | REQ-009 |
| Risks | "Trust signals" and local signals beyond NAP and map are undefined (Q-27). Lead forms are only read (ADR 0030). |

**Description:** The audit reports the ten marketing signals FR-15 lists, for each page and for the whole site.

**Functional expectations:**
- On-page SEO.
- Schema.
- Internal linking.
- Social tags.
- Analytics and tags.
- CTAs.
- Lead forms.
- Click-to-call.
- Trust signals.
- Local signals (NAP, map).

**Acceptance criteria:**
- AC-1: Given an audited App, when the marketing report is produced, then it has an entry for each of the ten listed signals, each stating what was found or that it was not found.
- AC-2: Given a page with a `tel:` link, when audited, then click-to-call is reported as found on that page.
- AC-3: Given a page with a lead form, when audited, then the form is reported and is not submitted.
- AC-4: Given a page that shows a business name, address and phone number, when audited, then the NAP is reported with the page it was found on.

## REQ-016 — AI assessment per page and for the whole site

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-16 (Analysis) |
| Phase | MVP |
| Business value | Judgement on what fixed rules cannot measure (FR-16). |
| Verification method | test |
| Dependencies | REQ-009, REQ-011, REQ-012, REQ-014, REQ-015, REQ-039 |
| Risks | Output shape undefined (Q-04). AI cost grows with page count (AI Request Budget). AI judgement can be wrong. ADR 0018 wording applies. |

**Description:** Using the tool user's AI key, the tool assesses six areas for each page and for the whole site: ranking, marketing, usability, content, accessibility and speed. "Ranking" is read as search ranking (Q-04).

**Decision 2026-10-30 (Q-04):** grades per area come from the existing deterministic checks; AI writes the explanation per area, per page and site-wide, citing evidence. No AI numeric score. "Ranking" means search ranking.

**Functional expectations:**
- Six areas per page and site-wide.
- Wording follows ADR 0018.

**Acceptance criteria:**
- AC-1: Given an audited App and a working AI key, when the assessment runs, then the output has an assessment of each of the six areas for every audited page and for the whole site.
- AC-2: Given the assessment output, when read, then it contains none of the words ADR 0018 forbids (compliant, certified, secure, fully accessible, passes WCAG).
- AC-3: Given the AI step did not run or failed for a page, when the output is produced, then that page's assessment is shown as not done, never as a clean result.

## REQ-017 — Rank issues by impact and effort, citing page and section

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-17 (Analysis), ranking and citation parts; redesign vs repair in REQ-045 |
| Phase | MVP |
| Business value | Puts the most valuable fixes first (FR-17). |
| Verification method | test |
| Dependencies | REQ-008, REQ-014, REQ-015, REQ-016 |
| Risks | The impact and effort scales and the ordering rule are undefined (Q-14). |

**Description:** Every issue gets an impact value and an effort value, the list is ordered by them, and each issue cites the page and section where it was found.

**Functional expectations:**
- Impact and effort on every issue.
- Ordered list.
- Page and section cited.

**Acceptance criteria:**
- AC-1: Given a set of issues, when ranked, then each issue has an impact value and an effort value and the list is ordered by them (rule per Q-14).
- AC-2: Given an issue found on a page, when reported, then it cites the page URL and the section (REQ-008) where it was found.

## REQ-018 — Generate the audit documents (five in MVP)

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-18 (Documents) |
| Phase | MVP |
| Business value | The deliverable of an audit (FR-18). |
| Verification method | test |
| Dependencies | REQ-007 to REQ-017, REQ-019, REQ-020, REQ-021, REQ-026, REQ-027 |
| Risks | The source never names or describes the three documents (Q-02). |

**Description:** After review (REQ-020), the tool generates three audit documents. FR-18 also names the pitch glimpse, which REQ-019 specifies.

**Decision 2026-10-30 (Q-02):** the MVP generates five documents: Structure (page hierarchy and navigation), Content (per page and section), Findings (grouped into technical, marketing and content sections, ranked per REQ-017), Improvement roadmap (REQ-026) and Proposal (REQ-027). Grades come from deterministic checks; AI writes the notes (Q-04).

**Functional expectations:**
- Three audit documents (contents per Q-02).
- One pitch glimpse (REQ-019).

**Acceptance criteria:**
- AC-1: Given a finished audit, when documents are generated, then exactly three audit documents and one pitch glimpse are produced.

## REQ-019 — Produce a one-page pitch glimpse in English or Tamil, sent by hand

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-19 (Pitch) |
| Phase | MVP |
| Business value | A short summary the tool user can hand to the site owner (FR-19). |
| Verification method | test |
| Dependencies | REQ-017, REQ-021, REQ-044 |
| Risks | Unsolicited outreach rules vary by country, and opt-out wording alone does not make outreach lawful. Screenshots copy third-party content. Persuasive wording can break ADR 0018. Number of issues, opt-out text and MVP format are undefined (Q-09). Depends on Q-01. |

**Description:** A one-page document in English or Tamil with the top issues, screenshots and opt-out wording. The tool user sends it by hand; the tool never sends it.

**Decision 2026-10-30 (Q-09):** shows the top 3 issues by the REQ-017 ranking, one screenshot each, on one A4 page. The tool ships default opt-out text in English and Tamil; the tool user edits it and owns checking it.

**Decision 2026-10-30 (Q-09, partial):** the tool user sends the pitch glimpse printed (one A4 page) or as a shared link to a page the tool hosts. A shared link needs persistent storage on the hosted copy (RISK-002) and makes the glimpse reachable by anyone with the link. Number of top issues and opt-out wording still open.

**Functional expectations:**
- One page.
- Top issues.
- Screenshots.
- Opt-out wording.
- English or Tamil.
- No send action in the tool.

**Acceptance criteria:**
- AC-1: Given a finished audit, when the pitch glimpse is generated, then it is one page long and contains the top issues, screenshots and opt-out wording.
- AC-2: Given the tool user picks Tamil, when the pitch glimpse is generated, then its text is in Tamil.
- AC-3: Given the tool user picks English, when the pitch glimpse is generated, then its text is in English.
- AC-4: Given a generated pitch glimpse, when the tool user finishes the export, then the tool has sent nothing to anyone (no email, message or form submission).

## REQ-020 — Edit the page hierarchy, content and findings before export

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-20 (Review); source text "Edit sitemap, content and findings before export" |
| Phase | MVP |
| Business value | The tool user corrects crawl and AI mistakes before anything leaves the tool (FR-20). |
| Verification method | test |
| Dependencies | REQ-007, REQ-008, REQ-009, REQ-014 to REQ-017, REQ-021 |
| Risks | Whether originals are kept is unstated (Q-25). |

**Description:** Before export, the tool user can edit the page hierarchy (source: "sitemap"), the extracted content and the findings. Exports carry the edits.

**Functional expectations:**
- Page hierarchy can be edited.
- Section content can be edited.
- Findings can be edited.

**Acceptance criteria:**
- AC-1: Given a finding, when the tool user edits its text and exports, then the export contains the edited text.
- AC-2: Given the page hierarchy, when the tool user removes a page from it and exports, then the export does not list that page.
- AC-3: Given a section's content, when the tool user edits it and exports, then the export contains the edited content.

## REQ-021 — Export Markdown documents and a JSON structure laid out for Claude Code

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-21 (Export) |
| Phase | MVP |
| Business value | Hands the audit to Claude Code as input (FR-21). |
| Verification method | test |
| Dependencies | REQ-018, REQ-020 |
| Risks | "Laid out for Claude Code" is undefined (Q-24). |

**Description:** The export holds the audit documents as Markdown and the audit structure (pages, sections, findings) as JSON, arranged for Claude Code.

**Functional expectations:**
- Markdown documents.
- A JSON structure.
- Layout per Q-24.

**Acceptance criteria:**
- AC-1: Given a finished audit, when exported, then the export contains the audit documents as Markdown files and a JSON file with pages, sections and findings.
- AC-2: Given the exported JSON, when parsed, then it is valid JSON and every finding in the Markdown documents appears in it.

## REQ-022 — Export PDF and Word

| Field | Value |
|---|---|
| Type | functional |
| Priority | medium |
| Status | approved |
| Source | FR-22 (Export) |
| Phase | Phase 2 |
| Business value | Adds PDF and Word to the export formats (FR-22). |
| Verification method | test |
| Dependencies | REQ-021, REQ-044 |
| Risks | Tamil text needs embedded fonts in PDF and Word. |

**Description:** The audit documents can also be exported as PDF and as Word (.docx).

**Functional expectations:**
- PDF export.
- Word export.

**Acceptance criteria:**
- AC-1: Given a finished audit, when exported as PDF, then a PDF with the same documents is produced.
- AC-2: Given a finished audit, when exported as Word, then a .docx file with the same documents is produced.
- AC-3: Given documents in Tamil, when exported as PDF or Word, then the Tamil text displays without missing-glyph boxes.

## REQ-023 — Shortlist: mark an audited site to pitch or skip, with notes and outcome

| Field | Value |
|---|---|
| Type | functional |
| Priority | medium |
| Status | approved |
| Source | FR-23 (Shortlist) |
| Phase | Phase 2 |
| Business value | Tracks which audited sites the tool user pursues and what happened (FR-23). |
| Verification method | test |
| Dependencies | REQ-028 |
| Risks | Notes and outcomes may hold personal data about owners. Outcome values are undefined (Q-31). Depends on Q-01. |

**Description:** For each saved App, the tool user can mark it pitch or skip, add notes and record an outcome.

**Functional expectations:**
- Pitch or skip mark.
- Notes.
- Outcome.

**Acceptance criteria:**
- AC-1: Given a saved audit, when the tool user marks it pitch or skip, then the mark is saved and shown with the App.
- AC-2: Given a saved audit, when the tool user adds notes, then the notes are saved with the App.
- AC-3: Given a saved audit, when the tool user records an outcome, then the outcome is saved with the App.

## REQ-024 — Clickable improved-homepage preview

| Field | Value |
|---|---|
| Type | functional |
| Priority | medium |
| Status | approved |
| Source | FR-24 (Design glimpse); source text "previe.//w" read as "preview" |
| Phase | Phase 2 |
| Business value | A visual glimpse of an improved homepage (FR-24). |
| Verification method | demo |
| Dependencies | REQ-007, REQ-009, REQ-011, REQ-016, REQ-017 |
| Risks | Format and hosting are undefined (Q-16). Reuses the owner's brand and images. Depends on Q-01. |

**Description:** The tool generates a clickable preview of an improved version of the audited App's homepage.

**Functional expectations:**
- Opens in a browser.
- Links and navigation are clickable.

**Acceptance criteria:**
- AC-1: Given an audited App, when the preview is generated, then the tool user can open it in a browser and click its links and navigation.

## REQ-025 — Owner audit: cleaned-up owner version in English or Tamil, on request

| Field | Value |
|---|---|
| Type | functional |
| Priority | medium |
| Status | approved |
| Source | FR-25 (Owner audit) |
| Phase | Phase 2 |
| Business value | A version of the audit fit to give to the site owner (FR-25). |
| Verification method | test |
| Dependencies | REQ-018, REQ-044 |
| Risks | "Cleaned-up" and "on request" are undefined (Q-17). ADR 0018 wording applies. Depends on Q-01. |

**Description:** On request, the tool generates a cleaned-up version of the audit for the site owner, in English or Tamil.

**Functional expectations:**
- Generated on request.
- English or Tamil.
- Content removed per Q-17.

**Acceptance criteria:**
- AC-1: Given a finished audit, when the tool user asks for the owner version in English or Tamil, then the tool generates it in that language.
- AC-2: Given the owner version, when generated, then it contains none of the content Q-17 marks for removal.

## REQ-026 — Enhancement roadmap with priorities, phases and effort (source: "Enhancement plan")

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-26 (source Area "Plan") |
| Phase | MVP (moved from Phase 2 by the developer, 2026-10-30, Q-02) |
| Business value | Turns findings into ordered work (FR-26). |
| Verification method | test |
| Dependencies | REQ-017 |
| Risks | "Plan" is a glossary term with another meaning (CONTEXT.md); working name pending Q-18. |

**Description:** The tool generates an enhancement roadmap from the findings. Each item has a priority, a phase and an effort value.

**Functional expectations:**
- Priority, phase and effort on every item.

**Acceptance criteria:**
- AC-1: Given ranked findings, when the roadmap is generated, then every item has a priority, a phase and an effort value.

## REQ-027 — Website-only proposal from an editable template

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-27 (Proposal) |
| Phase | MVP (moved from Phase 2 by the developer, 2026-10-30, Q-02) |
| Business value | A proposal for website work, built from the audit (FR-27). |
| Verification method | test |
| Dependencies | REQ-018, REQ-026 |
| Risks | Template format and "website-only" scope are undefined (Q-19). Pricing content depends on Q-05. Depends on Q-01. |

**Description:** The tool user edits a proposal template. The tool fills it with an audited App's data to produce a website-only proposal.

**Decision 2026-10-30 (Q-19):** the Proposal contains a findings summary and scope (redesign or repair per page), price and payment terms the tool user fills in (INR), a timeline from the Improvement Roadmap, and the tool user's company details and terms saved once and reused. Markdown, as one of the five Audit Documents.

**Functional expectations:**
- Editable template that is kept.
- Proposal generated from the template and the audit.

**Acceptance criteria:**
- AC-1: Given the tool user edits the proposal template, when the template is saved and reopened, then the edits are kept.
- AC-2: Given the edited template and an audited App, when a proposal is generated, then it follows the edited template and is filled with that App's audit data.

## REQ-028 — Saved audits per App with version history and re-run (source: "Saved projects")

| Field | Value |
|---|---|
| Type | functional |
| Priority | medium |
| Status | approved |
| Source | FR-28 (Projects) |
| Phase | Phase 2 |
| Business value | Lets the tool user come back to audits and repeat them (FR-28). |
| Verification method | test |
| Dependencies | REQ-002 |
| Risks | The hosted copy wipes `/tmp` on redeploy and scale-down (ADR 0032), so history there needs persistent storage, which has a cost against the recorded $0 hosting direction. Whether review edits create versions is unstated (Q-25). |

**Description:** Audits are saved per App, each App keeps its version history, and a saved App can be re-run.

**Decision 2026-10-30 (Q-25, Q-39):** each re-run is a new version; original and edited text are both kept. On the hosted copy saved audits live in the Cloud Storage always-free bucket (DEC-005), one folder per audit and version; local runs keep plain files.

**Functional expectations:**
- Audits are saved.
- Version history per App.
- Re-run.

**Acceptance criteria:**
- AC-1: Given a finished audit, when the tool user comes back later, then they can open it.
- AC-2: Given an App audited twice, when its history is opened, then both versions are listed and each one opens.
- AC-3: Given a saved App, when the tool user chooses re-run, then a new audit starts with the same URL and limits and is added to the history as a new version.

## REQ-029 — Run locally by default, on Google Cloud when needed

| Field | Value |
|---|---|
| Type | non-functional |
| Priority | medium |
| Status | approved |
| Source | FR-29 (Hosting) |
| Phase | Phase 2 |
| Business value | Runs on the tool user's computer, with Google Cloud as an option (FR-29). |
| Verification method | demo |
| Dependencies | none |
| Risks | Conflicts with the recorded direction (browser-only hosted) and with ADR 0032 (hosted copy on Cloud Run) (Q-06). "When needed" is undefined. |

**Description:** The audit runs on the tool user's computer by default and can also run on Google Cloud.

**Functional expectations:**
- Full audit locally with no cloud account.
- Full audit on Google Cloud.

**Acceptance criteria:**
- AC-1: Given a fresh clone, when the documented local start command runs, then a full audit works on that computer without any cloud account.
- AC-2: Given the Google Cloud deployment, when a tool user opens it, then a full audit works there.

## REQ-030 — AI agents rewrite content after approval, without reusing original wording

| Field | Value |
|---|---|
| Type | functional |
| Priority | low |
| Status | approved |
| Source | FR-30 (Rewrite) |
| Phase | Phase 3 |
| Business value | New copy for the site (FR-30). |
| Verification method | analysis |
| Dependencies | REQ-008, REQ-011, REQ-020 |
| Risks | What is rewritten, where it goes, whose approval counts and how "no reuse" is measured are undefined (Q-08). Agents acting on a live third-party site would break the read-only boundary (ADR 0030). AI can invent facts such as prices or phone numbers. Copyright of derived text. |

**Description:** After approval, AI agents with browser access rewrite content. The rewrite reuses none of the original wording.

**Functional expectations:**
- No rewrite before approval.
- No reuse of original wording.

**Acceptance criteria:**
- AC-1: Given no approval has been recorded (approval per Q-08), when a rewrite is requested, then no rewrite runs.
- AC-2: Given an approved rewrite, when its output is compared with the original section, then it reuses no original wording, under the rule set in Q-08.

## REQ-031 — Pricing: free for the first 10, then a fixed price per site

| Field | Value |
|---|---|
| Type | functional |
| Priority | low |
| Status | deferred |
| Source | FR-31 (Pricing); source text "Free first 10 over ~3 months, then fixed price per site" |
| Phase | Phase 3 |
| Business value | The pricing the source states (FR-31). |
| Verification method | test |
| Dependencies | none |
| Risks | Conflicts with the recorded direction (free tier plus monthly plans, global, USD). The unit of "10", the meaning of "~3 months" and who pays are undefined (Q-05). Price amount and currency are not stated. Payment data would come into scope. |

**Description:** The first 10 are free over about three months; after that a fixed price per site applies. Whether this is product billing or the tool user's own service pricing is open (Q-05).

**Functional expectations:**
- Free allowance of 10 (unit per Q-05).
- Fixed per-site price after the allowance.

**Acceptance criteria:**
- AC-1: Given the free allowance of 10 has been used (unit and window per Q-05), when another site is started, then the fixed per-site price applies.
- AC-2: Given fewer than 10 used inside the free window, when another site is started, then no charge applies.

## REQ-032 — Support Hindi and other Indian languages

| Field | Value |
|---|---|
| Type | non-functional |
| Priority | low |
| Status | approved |
| Source | FR-32 (Language) |
| Phase | Phase 3 |
| Business value | Extends language support beyond English and Tamil (FR-32). |
| Verification method | test |
| Dependencies | REQ-013, REQ-044 |
| Risks | "Other Indian languages" are not listed (Q-20). Each script needs fonts in PDF and Word (REQ-022). |

**Description:** Hindi and other Indian languages get the same handling as English and Tamil (REQ-044).

**Functional expectations:**
- Detection, extraction, audit and documents for each added language.

**Acceptance criteria:**
- AC-1: Given a page in Hindi, when audited, then its language is detected and it is handled in extraction, audit and documents as REQ-044 handles Tamil.

## REQ-033 — Helper accounts with per-App access (source: "per-project access")

| Field | Value |
|---|---|
| Type | functional |
| Priority | low |
| Status | approved |
| Source | FR-33 (Helpers) |
| Phase | Phase 3 |
| Business value | Other people can help with selected audits (FR-33). |
| Verification method | test |
| Dependencies | REQ-028 |
| Risks | The tool has no user accounts today (the hosted copy uses one access key, ADR 0032), so this needs sign-in to the tool itself. Helper permissions are undefined (Q-15). Helper accounts are not Roles (CONTEXT.md). |

**Description:** The tool user creates helper accounts and gives each one access to chosen Apps only.

**Decision 2026-10-30 (Q-15, Q-38):** helpers sign in with Google accounts through Firebase Authentication (free tier) on the hosted copy; they can view, edit and export audits they are given, never see or use the owner's AI keys, delete audits or add helpers.

**Functional expectations:**
- Helper accounts.
- Access granted and removed per App.

**Acceptance criteria:**
- AC-1: Given a helper with access to App A only, when signed in, then the helper can open App A and cannot see or open any other App.
- AC-2: Given the helper's access to App A has been removed, when the helper next tries to open App A, then access is refused.

## REQ-034 — Honour robots.txt

| Field | Value |
|---|---|
| Type | non-functional |
| Priority | high |
| Status | approved |
| Source | FR-3 (Crawl), robots.txt part |
| Phase | MVP |
| Business value | Respects the site owner's crawl rules (FR-3). |
| Verification method | test |
| Dependencies | REQ-003, REQ-004 |
| Risks | The user-agent the crawler identifies as is not stated; robots.txt rules are per user-agent. |

**Description:** Pages that robots.txt disallows are not fetched, whether found by link or in sitemap.xml.

**Functional expectations:**
- Disallowed pages are listed as Skipped Pages with reason `robots`.

**Acceptance criteria:**
- AC-1: Given robots.txt disallows a path for all crawlers, when the crawl meets a URL under it by link or in sitemap.xml, then the page is not fetched and is listed as a Skipped Page with reason `robots`.
- AC-2: Given the App has no robots.txt, when the crawl runs, then it proceeds normally.

## REQ-035 — Limit the request rate to the audited site

| Field | Value |
|---|---|
| Type | non-functional |
| Priority | high |
| Status | approved |
| Source | FR-3 (Crawl), rate-limit part |
| Phase | MVP |
| Business value | Keeps the audit from loading the owner's server (FR-3). |
| Verification method | test |
| Dependencies | REQ-003, ADR 0015 (Deferred) |
| Risks | The rate value is not stated (Q-12). ADR 0015 records no pacing decision yet. |

**Description:** The crawl never sends requests to the audited host faster than the set limit.

**Functional expectations:**
- One rate limit per audited host (value per Q-12).

**Acceptance criteria:**
- AC-1: Given the rate limit set per Q-12, when the crawl runs against a test server that counts requests, then the request rate to that host never exceeds the limit.

## REQ-036 — Flag and skip payment areas

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-6 (Crawl), payment part |
| Phase | MVP |
| Business value | The audit never works through a site's checkout or payment pages (FR-6). |
| Verification method | test |
| Dependencies | REQ-003 |
| Risks | The detection rule is undefined (Q-10). A missed payment area risks interaction with a real checkout. The Skipped Page reasons in CONTEXT.md have none for payment. |

**Description:** The crawl detects payment areas, flags them in the output and does not go further into them.

**Functional expectations:**
- Payment areas flagged.
- No click, submit or link follow inside them.

**Acceptance criteria:**
- AC-1: Given a page identified as a payment area (rule per Q-10), when the crawl reaches it, then the page is flagged in the output, nothing on it is clicked or submitted, and its links are not followed.

## REQ-037 — Record the mobile layout

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-10 (Content), mobile layout part |
| Phase | MVP |
| Business value | Shows how the site looks on phones (FR-10). |
| Verification method | test |
| Dependencies | REQ-003 |
| Risks | What is recorded is undefined (Q-28). |

**Description:** The audit records each page's layout at a phone screen size.

**Functional expectations:**
- Layout recorded at a phone screen size (details per Q-28).

**Acceptance criteria:**
- AC-1: Given an audited page, when audited, then the output records the page as laid out at a phone screen size.

## REQ-038 — Record accessibility and SEO basics

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-10 (Content), accessibility and SEO part |
| Phase | MVP |
| Business value | Baseline accessibility and SEO facts per page (FR-10). |
| Verification method | test |
| Dependencies | REQ-009; overlaps REQ-014, REQ-015 |
| Risks | "Basics" is undefined (Q-28). Overlap with REQ-014 and REQ-015 can report one issue twice. |

**Description:** The audit records basic accessibility and SEO results for each page, worded per ADR 0018.

**Functional expectations:**
- Accessibility results name the standard and level tested.
- No "accessible" or "compliant" claims.

**Acceptance criteria:**
- AC-1: Given an audited page, when audited, then the output records its accessibility and SEO basics, names the standard and level for the accessibility results, and does not call the page accessible or compliant.

## REQ-039 — Choose the AI model per task

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-11 (AI providers), model-per-task part |
| Phase | MVP |
| Business value | Lets the tool user pick a model for each AI task (FR-11). |
| Verification method | test |
| Dependencies | REQ-011 |
| Risks | The list of tasks is undefined (Q-29). |

**Description:** The tool user can set a different AI model for each AI task.

**Functional expectations:**
- One model setting per task.

**Acceptance criteria:**
- AC-1: Given model A set for one task and model B for another, when both tasks run, then each task calls its own model.

## REQ-040 — Store AI keys encrypted

| Field | Value |
|---|---|
| Type | non-functional |
| Priority | high |
| Status | implemented |
| Source | FR-11 (AI providers), "keys stored encrypted" |
| Phase | MVP |
| Business value | A copied disk or file does not expose the keys (FR-11). |
| Verification method | test |
| Dependencies | REQ-011 |
| Risks | ADR 0002 keeps a legacy `.qa-keys.json` fallback, and the search found no encryption code in `packages/`. Where the encryption key lives is not stated. |

**Description:** Saved AI keys are never stored in plain text.

**Functional expectations:**
- Keys encrypted at rest.
- Keys still usable after a restart.

**Acceptance criteria:**
- AC-1: Given a saved AI key, when the tool's stored files are read directly outside the tool, then the key does not appear in plain text.
- AC-2: Given a saved AI key, when the tool restarts, then the key still works for AI steps.

## REQ-041 — Ship no AI keys

| Field | Value |
|---|---|
| Type | non-functional |
| Priority | high |
| Status | implemented |
| Source | FR-11 (AI providers), "no keys shipped" |
| Phase | MVP |
| Business value | No product key can leak through a distributed copy (FR-11). |
| Verification method | test |
| Dependencies | none |
| Risks | Conflicts with the recorded direction that the first check-up runs on the product's key (Q-07). |

**Description:** No AI key is included in anything the product distributes.

**Functional expectations:**
- No key in the repository, container image or wizard bundle.

**Acceptance criteria:**
- AC-1: Given a release (repository, container image, wizard bundle), when scanned for AI provider key patterns, then no key is found.

## REQ-042 — Get search data from an external API

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | deferred |
| Source | FR-12 (Data), search data part |
| Phase | MVP |
| Business value | Search facts for the audit (FR-12). |
| Verification method | test |
| Dependencies | REQ-043 |
| Risks | What "search data" means and where it comes from are undefined (Q-03). Owner-only sources such as Google Search Console need the site owner's access, which an audit of someone else's site does not have. |

**Description:** The audit includes search data from an external API, with its source named.

**Decision 2026-10-30 (Q-03):** deferred. Search data for a site the tool user does not own needs the owner's Search Console access; revisit with the owner audit (REQ-025).

**Functional expectations:**
- Search data shown with its source.
- Missing data reported as not available.

**Acceptance criteria:**
- AC-1: Given a configured search data source, when an App is audited, then the output shows the search data and names the source.
- AC-2: Given the source fails or has no data for the App, when audited, then the output says search data was not available.

## REQ-043 — Prefer free tiers of external APIs

| Field | Value |
|---|---|
| Type | non-functional |
| Priority | high |
| Status | approved |
| Source | FR-12 (Data), "free tiers first" |
| Phase | MVP |
| Business value | Keeps external API costs at zero where a free tier exists (FR-12). |
| Verification method | inspection |
| Dependencies | REQ-012, REQ-042 |
| Risks | "First" may mean build order or run-time order (Q-32). Free quotas limit audits per day. |

**Description:** External data APIs are used on their free tiers first.

**Functional expectations:**
- MVP external API calls work on a free tier (pending Q-32).

**Acceptance criteria:**
- AC-1: Given the MVP build, when its external data API calls are reviewed, then each one uses an API that is usable on a free tier without payment.

## REQ-044 — Handle English and Tamil in extraction, audit and documents

| Field | Value |
|---|---|
| Type | non-functional |
| Priority | high |
| Status | approved |
| Source | FR-13 (Language), EN/TA part |
| Phase | MVP |
| Business value | Serves English and Tamil sites and readers (FR-13). |
| Verification method | test |
| Dependencies | REQ-009, REQ-013, REQ-016, REQ-018 |
| Risks | How the document language is chosen and whether Tamil-specific rules apply are undefined (Q-13). AI output quality in Tamil varies by model. |

**Description:** Extraction, audit and documents work for English and for Tamil.

**Functional expectations:**
- Tamil text is kept intact through extraction and export.
- Tamil pages are audited like English pages.
- Documents are available in English and in Tamil.

**Acceptance criteria:**
- AC-1: Given a Tamil page, when extracted and exported, then the Tamil text in the export matches the page text character for character.
- AC-2: Given a Tamil page, when audited, then findings are produced for it as for an English page.
- AC-3: Given the tool user picks Tamil or English for the documents (choice per Q-13), when they are generated, then they are in that language.

## REQ-045 — Recommend redesign or repair for each page

| Field | Value |
|---|---|
| Type | functional |
| Priority | high |
| Status | approved |
| Source | FR-17 (Analysis), redesign vs repair part |
| Phase | MVP |
| Business value | Tells the tool user which pages to rebuild and which to fix (FR-17). |
| Verification method | test |
| Dependencies | REQ-014, REQ-015, REQ-016, REQ-017 |
| Risks | The criteria are undefined (Q-14). |

**Description:** Each audited page gets one recommendation, redesign or repair, with the issues behind it.

**Functional expectations:**
- One recommendation per page.
- The issues behind it are cited.

**Acceptance criteria:**
- AC-1: Given an audited page, when analysed, then the output gives it exactly one recommendation, redesign or repair, with the issues that led to it.

## REQ-046 — The full test suite passes on the developer's Windows PC

| Field | Value |
|---|---|
| Type | non-functional |
| Priority | high |
| Status | approved |
| Source | Developer, 2026-10-31 (Q-40), from the PLAN-001 baseline (EV-0006) |
| Phase | MVP |
| Business value | The completion gate needs a passing unit suite; 54 tests in 29 files fail locally while CI passes. |
| Verification method | test |
| Dependencies | none |
| Risks | A failure may be a real product bug rather than a slow test; that needs its own fix task. |

**Description:** Resolve each failing test so `pnpm test` passes on the developer's Windows PC with the repository in its current folder (inside OneDrive; moving it is out of scope).

**Functional expectations:**
- Each of the 29 failing test files from EV-0006 passes.
- The root cause of each failure is recorded.

**Acceptance criteria:**
- AC-1: Given the developer's PC and the repository in its current folder, when `pnpm test` runs, then every test passes.
- AC-2: Given the fixes, when the diff is reviewed, then no test was deleted or skipped and no assertion was weakened; any raised timeout names its reason.
- AC-3: Given the fixes, when CI's sharded test workflow runs, then it still passes.

## Open questions

| ID | Question | Impacts | Asked | Answer | Status |
|---|---|---|---|---|---|
| Q-01 | The source audits other people's sites in order to pitch redesign or repair work. The recorded direction is teams without QA staff checking their own Apps. Is this (a) a new audit mode inside QA Flow Tester, (b) a separate product that reuses the engine, or (c) owner-side features only, dropping the pitch rows? Which glossary term names one audit pass? Recommended: build the shared audit capabilities (FR-1 to FR-17, FR-20 to FR-22, FR-28) into the Check-up, and hold FR-19, FR-23 to FR-25, FR-27, FR-31 and FR-33 until this is decided. | All; REQ-019, REQ-023 to REQ-025, REQ-027, REQ-031, REQ-033 | 2026-10-30 | Developer, 2026-10-30: (b) a separate "Website audit" entry point on the shared engine, beside the Check-up. Check-up stays for teams checking their own Apps. Pitch-specific requirements stay in scope. Glossary term for one audit pass still to be added to CONTEXT.md. | answered |
| Q-02 | What are "the three audit documents" (name, audience, contents)? Recommended: the three things FR-20 makes editable: page hierarchy (source: "sitemap"), content, and findings. | REQ-018, REQ-021 | 2026-10-30 | Developer, 2026-10-30: all five in MVP: Structure, Content, Findings (technical, marketing and content sections), Improvement roadmap, Proposal. REQ-026 and REQ-027 move from Phase 2 to MVP. | answered |
| Q-03 | Which external APIs supply page speed and Core Web Vitals, and what is "search data" and its source? Recommended: Google PageSpeed Insights API for speed and Core Web Vitals; defer search data until a source is named, because Search Console data needs the owner's access. | REQ-012, REQ-042, REQ-043 | Developer, 2026-10-30: Google PageSpeed Insights API for speed and Core Web Vitals; search data deferred (REQ-042 deferred) until an owner connects Search Console. | answered |
| Q-04 | What is the shape of the AI assessment: a numeric score per area, a grade, or written findings? Does "ranking" mean search ranking? Recommended: written findings per area with evidence and no AI numeric score, kept out of any verdict; ranking means search ranking. | REQ-016 | Developer, 2026-10-30: grades from the existing deterministic checks, AI writes notes per area citing evidence; no AI numeric score; ranking means search ranking. | answered |
| Q-05 | Is FR-31 the price tool users pay (which conflicts with the recorded free tier plus monthly USD plans), or the price the tool user charges site owners? What is the unit of "10", and is "~3 months" a time window? Recommended: treat FR-31 as the tool user's service pricing shown in proposals (REQ-027) and keep the recorded product pricing. | REQ-031, REQ-027 | 2026-10-30 | Developer, 2026-10-30: "keep it in the free tier as of now". The audit entry point is part of the free tier; REQ-031 is deferred; recorded product pricing is unchanged. | answered |
| Q-06 | The source says local by default, Google Cloud when needed. The recorded direction says browser-only hosted, and ADR 0032 runs the hosted copy on Cloud Run. Which is the default for this capability, and what makes Google Cloud "needed"? Recommended: keep both as they are today (`pnpm start` locally and the Cloud Run copy) and treat FR-29 as met by them. | REQ-029, REQ-028, REQ-033 | Developer sign-off, 2026-10-30: keep local `pnpm start` and the Cloud Run copy as today; FR-29 is met by them. | answered |
| Q-07 | Does a product-owned key held on the server for the first hosted check-up (recorded direction) count as "shipped" under FR-11? Recommended: no; "no keys shipped" means no key in the repository, container image or wizard bundle, and a server-held key from Secret Manager is allowed. | REQ-011, REQ-041 | Developer sign-off, 2026-10-30: "no keys shipped" means no key in the repository, container image or wizard bundle; a server-held key from Secret Manager is allowed. | answered |
| Q-08 | For FR-30: is the rewrite new copy in exported documents, or edits made on a live site through the browser? Whose approval counts, and how is "no reuse of original wording" measured? Recommended: new copy in exports only, never on a live site; the tool user approves each section; measure reuse with a word-overlap limit the developer sets. | REQ-030 | Developer, 2026-10-30: agents browse the audited site read-only and write new copy into the Audit Documents only, never on a live site (ADR 0030 unchanged); the tool user approves each section; a word-overlap check flags phrases copied from the original. | answered |
| Q-09 | For the pitch glimpse: how many top issues, who writes the opt-out wording in each language, and what is the MVP file format, given that PDF is Phase 2? Recommended: top 3 issues by the REQ-017 ranking, opt-out text the tool user edits per language, Markdown sized to print on one A4 page. | REQ-019 | Developer, 2026-10-30: top 3 issues by the REQ-017 ranking; sent printed (one A4 page) or as a shared link the tool hosts; the tool ships default opt-out text in English and Tamil that the tool user edits. | answered |
| Q-10 | What identifies a payment area, and how is it listed? Recommended: a card-number field, a payment-provider frame or a checkout path; list it as a Skipped Page with a new reason `payment`. | REQ-036 | Developer sign-off, 2026-10-30: a card-number field, a payment-provider frame or a checkout path; listed as a Skipped Page with new reason `payment`; the crawl does not follow links past it. | answered |
| Q-11 | What are the defaults for max pages and depth, how is depth counted, and what syntax do include and exclude paths use? Recommended: the current Check-up page default; depth counted in link steps from the start URL; path-prefix patterns, with the start page always allowed. | REQ-002 | Developer sign-off, 2026-10-30: current Check-up page default; expose maxDepth (default 8) counted in link steps from the start URL; include and exclude as path prefixes, start page always allowed; new Skipped Page reasons `depth-limit` and `excluded`. | answered |
| Q-12 | What rate limit applies to the audited host, and is robots.txt Crawl-delay honoured? Recommended: one request at a time per host and honour Crawl-delay, recorded by accepting ADR 0015. | REQ-035 | Developer sign-off, 2026-10-30: accept ADR 0015 with one request at a time per host and robots.txt Crawl-delay honoured. | answered |
| Q-13 | For Tamil: are documents written in a language the tool user picks per export, whatever the page language? Are there Tamil-specific audit rules, and does the UI need Tamil? Recommended: the tool user picks the document language per export, there are no Tamil-specific rules in MVP, and the UI stays English. | REQ-013, REQ-044, REQ-019, REQ-025 | Developer sign-off, 2026-10-30: the tool user picks the document language per export (English or Tamil); no Tamil-specific audit rules in MVP; UI stays English; embed a Noto Sans Tamil font. | answered |
| Q-14 | What scales do impact and effort use, how is the list ordered, and what decides redesign versus repair? Recommended: high, medium or low for both, ordered by impact and then by lower effort; the AI proposes redesign or repair with reasons, editable in review. | REQ-017, REQ-045, REQ-026 | Developer sign-off, 2026-10-30: high, medium or low for both impact and effort; ordered by impact, then lower effort; AI proposes redesign or repair with reasons, editable in review. | answered |
| Q-15 | What can a helper do in an assigned App (view, edit, export, re-run, use AI keys, see pricing)? Recommended: view, edit and export only, with no access to keys or pricing. | REQ-033 | Developer, 2026-10-30: helpers can view, edit and export the audits they are given; they cannot see or use the owner's AI keys, delete audits, or add helpers. | answered |
| Q-16 | What is the homepage preview technically (generated HTML, an image, a hosted page), and where does it live? Recommended: a self-contained HTML file in the export, opened locally and not hosted by the tool. | REQ-024 | Developer, 2026-10-30: a self-contained HTML page in the export folder, optionally published through the shared-link storage (DEC-005: noindex, 30-day expiry, revocable). | answered |
| Q-17 | What does "cleaned-up" remove from the owner version, and who triggers "on request"? Recommended: it removes pitch or skip marks, notes, outcome and effort figures; the tool user generates it when the owner asks. | REQ-025 | Developer, 2026-10-30: removes pitch/skip marks, notes, outcome, effort and price; adds a plain-language summary on top (ADR 0010); English or Tamil per export. | answered |
| Q-18 | "Plan" already means the list of everything a run does (CONTEXT.md). What should FR-26's "Enhancement plan" be called? Recommended: "Improvement roadmap", added to CONTEXT.md. | REQ-026 | Developer sign-off, 2026-10-30: "Improvement Roadmap", added to CONTEXT.md with "Website Audit" and "Audit Document". | answered |
| Q-19 | What format is the proposal template, and what does "website-only" exclude? Recommended: a Markdown template with placeholders filled from the audit; website-only means no hosting, marketing or app work. | REQ-027 | Developer, 2026-10-30: contains findings summary and scope, price and payment terms (INR, filled in by the tool user), timeline from the Improvement Roadmap, and the tool user's company details and terms; Markdown, one of the five Audit Documents. Default scope is website design, build and content fixes; hosting or domain, digital marketing or ads, and mobile apps are listed as not included; editable per proposal. | answered |
| Q-20 | Which "other Indian languages" are in Phase 3? Recommended: name them before Phase 3 planning. | REQ-032 | Developer, 2026-10-30: Hindi, Telugu, Kannada, Malayalam, Marathi, Gujarati, Bengali, Odia, Punjabi and Urdu (Urdu is right-to-left). | answered |
| Q-21 | Is the priority mapping MVP = high, Phase 2 = medium, Phase 3 = low correct? Recommended: yes. | All | Developer sign-off, 2026-10-30: confirmed. MVP = high, Phase 2 = medium, Phase 3 = low (REQ-026 and REQ-027 moved to MVP, so high). | answered |
| Q-22 | What do "public" and "reachable" mean for FR-1? Recommended: public means the host resolves to a public IP address (private and local addresses refused only in this audit mode); reachable means the final response after redirects is below 400 within the existing page timeout. | REQ-001 | Developer sign-off, 2026-10-30: public means the host resolves to a public IP address (private and local addresses refused only for a Website Audit); reachable means the final response after redirects is below 400 within the existing page timeout. | answered |
| Q-23 | How is the page hierarchy built, and how are sections found? Recommended: hierarchy from menu nesting, then breadcrumbs, then URL path; sections from landmark elements and top-level headings. | REQ-007, REQ-008 | Developer sign-off, 2026-10-30: hierarchy from menu nesting, then breadcrumbs, then URL path; sections from landmark elements and top-level headings. | answered |
| Q-24 | What does "laid out for Claude Code" mean for the export? Recommended: one folder per App with one Markdown file per document, one JSON file, and an index file that describes them. | REQ-021 | Developer sign-off, 2026-10-30: one folder per Website Audit with the five Markdown Audit Documents, `site.json` (pages and sections) and a README index. | answered |
| Q-25 | Do review edits keep the original text, and does each re-run or export create a version in the history? Recommended: keep both the original and the edited text; each re-run is a new version. | REQ-020, REQ-028 | Developer sign-off, 2026-10-30: keep both the original and the edited text; each re-run is a new version. | answered |
| Q-26 | What counts as duplicate content and as a heading problem? Recommended: duplicate content is an exact match of main text after whitespace normalisation; heading problems are no H1, more than one H1, or skipped heading levels. | REQ-014 | Developer sign-off, 2026-10-30: duplicate content is an exact match of main text after whitespace normalisation; heading problems are no H1, more than one H1, or skipped heading levels. Duplicate checks run site-wide on the content extracted from every page. | answered |
| Q-27 | What counts as a trust signal, and as a local signal beyond NAP and map? Recommended: trust signals are reviews or ratings, testimonials and certifications; local signals are NAP, a map embed and LocalBusiness schema. | REQ-015 | Developer sign-off, 2026-10-30: trust signals are reviews or ratings, testimonials and certifications; local signals are NAP, a map embed and LocalBusiness schema. | answered |
| Q-28 | For FR-10, what is recorded for mobile layout and for accessibility and SEO basics, and which CMSs and frameworks must be recognised? Recommended: a phone-width screenshot plus the existing overflow and tap-target findings; the existing axe and SEO checker results; a CMS list the developer supplies. | REQ-010, REQ-037, REQ-038 | Developer sign-off, 2026-10-30: phone-width screenshot plus the existing overflow and tap-target findings; the existing axe and SEO checker results. CMS and framework list (developer, 2026-10-30): WordPress, Wix, Shopify, Squarespace, Webflow, Joomla, Drupal; Zoho Sites, Google Sites, Blogger, Dukaan, GoDaddy Website Builder; React, Next.js, Vue/Nuxt, Angular, Gatsby; Hugo, Jekyll, Astro, Eleventy. | answered |
| Q-29 | Which AI tasks get their own model setting? Recommended: one setting per AI feature: assessment, documents and pitch, preview, rewrite. | REQ-039 | Developer sign-off, 2026-10-30: one model setting per AI feature: assessment, documents and pitch, preview, rewrite. | answered |
| Q-30 | How long are third-party content, screenshots, notes and outcomes kept, and how are they deleted? Recommended: kept until the tool user deletes the saved App; deleting it removes all of its data. | Security section, REQ-023, REQ-028 | Developer sign-off, 2026-10-30: kept until the tool user deletes the Website Audit; deleting removes all its data; shared pitch links expire after 30 days and can be revoked. | answered |
| Q-31 | Is the FR-23 outcome free text or a fixed list? Recommended: a fixed list (no reply, interested, won, lost, opted out) plus a free note. | REQ-023 | Developer, 2026-10-30: a fixed list (No reply, Interested, Meeting set, Won, Lost, Opted out) plus a free-text note. | answered |
| Q-32 | Does "free tiers first" mean MVP uses only free-tier APIs, or that free quota is used before paid quota at run time? Recommended: MVP uses only APIs with a free tier; paid tiers come later, on the tool user's own key. | REQ-043 | Developer sign-off, 2026-10-30: MVP uses only APIs with a free tier; paid tiers come later, on the tool user's own key. | answered |
| Q-33 | How are CTAs identified? Recommended: buttons and button-styled links, listed with their text and target. | REQ-009, REQ-015 | Developer sign-off, 2026-10-30: buttons and button-styled links, listed with their text and target. | answered |
| Q-34 | Which market is the Website audit entry point for? | REQ-013, REQ-019, REQ-025, REQ-032, REQ-044; RISK-005, RISK-008, RISK-012 | 2026-10-30 | Developer, 2026-10-30: India-wide. English and Tamil in MVP; Hindi and other Indian languages next (REQ-032). Indian outreach and privacy rules (DPDP Act) apply first. The Check-up's recorded market (global, USD) is unchanged. | answered |
| Q-35 | (REPO-001) Do per-page audit rows cover every crawled page or only Sample Pages (3 per Layout Group)? | REQ-008, REQ-009, REQ-013, REQ-014, REQ-015, REQ-016, REQ-037, REQ-038; RISK-010 | 2026-10-30 | Developer sign-off, 2026-10-30: deterministic content extraction on every crawled page; browser checkers and AI notes stay on Sample Pages. | answered |
| Q-36 | (ARCHAN-001) Is the ADR 0031 implementation gap a blocking task before the Website Audit? | REQ-003, REQ-004, REQ-014; RISK-001; F-001 | 2026-10-30 | Developer sign-off, 2026-10-30: yes, the first task (T-43 as ADR 0031 states, with the outbound source-grep test). | answered |
| Q-37 | (REPO-001) Do depth and path filters add Skipped Page reasons to CONTEXT.md? | REQ-002, REQ-036 | 2026-10-30 | Developer sign-off, 2026-10-30: yes: `depth-limit`, `excluded`, `payment`. | answered |
| Q-38 | How do helpers sign in to the hosted copy (no user accounts today; one shared access key, ADR 0032)? | REQ-033; RISK-018 | 2026-10-30 | Developer, 2026-10-30: Google sign-in through Firebase Authentication (free tier); new ADR; new dependency (P2). | answered |
| Q-39 | Where do saved audits live on the hosted copy? | REQ-028, REQ-023; RISK-002 | 2026-10-30 | Developer, 2026-10-30: the Cloud Storage always-free bucket of DEC-005, one folder per audit and version; local runs keep plain files. | answered |
| Q-40 | The full suite fails locally (54 tests, 29 files, mostly timeouts) while CI passes. What should the plan do? | REQ-046; CHK-NODE-UNIT | 2026-10-31 | Developer, 2026-10-31: add a fix task that resolves the individual failing tests before the next step; keep the repository in its current folder (OneDrive is not to be changed). | answered |
| Q-41 | How should the work land, given a push to main deploys? | all | 2026-10-31 | Developer, 2026-10-31: one branch `feat/website-audit`, a PR per verified milestone. | answered |
| Q-42 | Release the MVP before Phase 2/3? | all | 2026-10-31 | Developer, 2026-10-31: release everything together (one REL-001 at the end). | answered |
| Q-43 | How many agents in parallel? | all | 2026-10-31 | Developer, 2026-10-31: 5. | answered |
| Q-44 | Does a Firebase project exist for the Cloud Run project? | REQ-033; BE-031 | 2026-10-31 | Developer, 2026-10-31: no; add Firebase to the same Google Cloud project; the developer runs the documented commands. | answered |
| Q-45 | Who reviews machine-translated fixed text before release? | REQ-032, REQ-044 | 2026-10-31 | Developer, 2026-10-31: the developer reviews Tamil; Hindi and the other languages ship labelled beta until reviewed. | answered |
