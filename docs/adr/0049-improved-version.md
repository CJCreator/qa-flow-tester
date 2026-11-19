# 0049: The Improved Version: Design Variants, Alternatives and Automatic Competitors

Status: Proposed, 2026-11-19 (owner's answers in a grilling session, 2026-11-19; technical sign-off items 13 to 17). Extends REQ-024 (improved-homepage preview, `packages/core/src/audit/preview/`) and REQ-030 (Section rewrite, `audit/ai/rewrite.ts`).

## Context
- The owner wants a website audit to give "alternatives and an enhanced version".
- The code has an AI improved homepage. It covers the homepage only and sits under the **Share** tab, which the Documents and Download screens hide.
- The code also has a Section rewrite, approved one Section at a time.
- Nothing gives design alternatives, fix options, competitor examples, or before/after views.

## Decision
- **Improved version** is a new term (CONTEXT.md). It means the AI-written improvements of one audit version. It never touches the live site and never sends a form. It has its own tab on every audit screen, and Share goes back to sharing only.
- **Scope:** the homepage plus one Sample Page per Layout Group.
- **Design variants:**
  - The user picks 1 to 5 per page, and sees an AI cost estimate first.
  - Each variant is one sanitized HTML page made by the preview pipeline. It keeps every menu link and the site's logo and colours.
- **Alternatives**, in this build order:
  1. design variants;
  2. fix options per finding (2 or 3 each, with effort; rule-based options when there is no AI key);
  3. competitor examples;
  4. copy variants (batched drafts that still need approval, with the overlap check kept).
- **Competitors:**
  - The AI names 3 similar public sites from the audit, using the user's key; no search API is used.
  - Each site is read at its homepage plus up to 10 key pages, GET only, with the same pacing and safety rules as the audit.
  - On the hosted copy, competitor pages count toward the 200-page cap.
- **Evidence:**
  - Every AI statement cites a finding id or Section id.
  - Claim words are stripped (`ai/claim-words.ts`).
  - No score is given, and nothing is said about the whole site (ADR 0018).
  - Output is in the language chosen at start.
- **Quality gate:** automatic checks only.
  - The sanitizer passes.
  - Every menu link is present and on-site.
  - No claim words remain.
  - An axe scan of the variant finds no Blocker.
  - Every change marker resolves to a finding or Section id.
  - A variant that fails is not shown, and the user is told why.
- **Outputs:**
  - a live page;
  - a before/after view (stored 1440 px and phone screenshots beside the variant);
  - an HTML download;
  - inclusion in the md, html, pdf, docx and bundle exports;
  - the best variant's thumbnail in the Pitch Glimpse (the user picks it; the first variant that passes is the default).
- **AI cost:** always the user's own key (BYOK). Hosting stays $0.

## Consequences
- AI spend grows with Layout Groups × variants. The estimate and the AI Request Budget (T-398) bound it.
- Competitor crawling adds outbound requests to sites the user did not name. They are read-only and paced, and robots.txt is honoured.
- A variant is a suggestion. The before/after view and the documents label it so.
