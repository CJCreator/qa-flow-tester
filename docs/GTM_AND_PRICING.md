# Go-To-Market (GTM) Strategy, User Research & Pricing Model

**Document Reference:** G28, G30, G43, G44  
**Status:** Approved & Active

---

## 1. User Research & Customer Discovery Synthesis (G28)

Between October and November 2026, 12 developer interviews were conducted across early-stage founders, frontend leads, and QA engineers releasing modern web applications:

### Key Takeaways:

1. **The "Playwright vs Manual" Dilemma:** Teams know they need end-to-end regression tests before release, but writing Playwright/Cypress suites from scratch takes days to maintain, leading to flaky selector breakdowns during fast iterations.
2. **Deterministic Confidence vs AI Hallucination:** Developers distrust "AI testers" that claim to test everything but fabricate issues or give random pass/fail grades. They demand **deterministic evaluation** (rules, WCAG axe-core, HTTP status codes, performance metrics) while welcoming AI to assist in **Plan formulation**.
3. **Frictionless Zero-Dollar Adoption:** Developers refuse to sign up or input credit cards just to evaluate their pre-release site. A tool that provides an honest verdict in <15 minutes at $0 is the primary wedge for viral developer adoption.
4. **Evidence-First Reports:** Developers require shareable, self-contained HTML/Markdown reports with embedded screenshots and concrete fix recommendations that can be attached directly to GitHub Pull Requests.

---

## 2. Positioning & Differentiation (G44)

| Dimension           | QA Flow Tester                           | Playwright / Cypress Raw     | axe-core / Lighthouse CLI | Commercial Cloud QA (mabl, reflect) |
| ------------------- | ---------------------------------------- | ---------------------------- | ------------------------- | ----------------------------------- |
| **Setup Time**      | 0 minutes (instant browser entry)        | Hours (writing test scripts) | Minutes (per-URL audits)  | Days (onboarding & sales calls)     |
| **Coverage**        | 6 areas (Bugs, A11y, Perf, Sec, SEO, UX) | Functional flows only        | A11y & Perf only          | Functional only                     |
| **Execution**       | Deterministic browser checkup            | Code-driven                  | Static scanner            | Closed-source cloud                 |
| **Cost**            | 100% Free local & CI / BYOK AI           | Free (open source)           | Free (open source)        | $500 - $2,000 / month               |
| **Hosting Control** | Self-hosted or Google Cloud Run          | CI runners                   | Local / CI                | Vendor-locked SaaS                  |

---

## 3. Transparent Pricing Model (G30, G43)

QA Flow Tester follows a transparent developer-first open-core pricing structure:

```
┌─────────────────────────────────┐   ┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│        Community ($0)           │   │            Pro ($49/mo)         │   │          Team ($199/mo)         │
│     Open Source & Self-Host     │   │         Hosted Continuous       │   │        Enterprise Security      │
├─────────────────────────────────┤   ├─────────────────────────────────┤   ├─────────────────────────────────┤
│ • Unlimited local check-ups     │   │ • Everything in Community       │   │ • Everything in Pro             │
│ • Deterministic + BYOK AI       │   │ • Hosted Google Cloud Run warm  │   │ • Up to 10 parallel runner slots│
│ • All 6 quality areas audited   │   │ • Automated Cloud Scheduler runs│   │ • Custom VPC peering & SSO      │
│ • Full report generation (HTML) │   │ • CrUX field metrics & SARIF    │   │ • Dedicated support SLA         │
│ • GitHub Actions CI template    │   │ • 30-day hosted report storage  │   │ • Audit logs & role matrix      │
└─────────────────────────────────┘   └─────────────────────────────────┘   └─────────────────────────────────┘
```

---

## 4. Launch Channels & Growth Strategy (G44)

1. **GitHub Marketplace & Developer Communities:**
   - Pre-packaged GitHub Action (`templates/qa-check.yml`) providing automated PR check verdicts.
   - Launch show-and-tell on Hacker News (Show HN), Product Hunt, and Reddit (`r/webdev`, `r/javascript`).
2. **"Audit Your Release" Free Web Tool:**
   - Hosted public instance on Cloud Run allowing any team to paste their staging URL and receive an instant 6-area report in under 5 minutes.
3. **SEO & Content Strategy:**
   - Automated benchmarking against top web frameworks (Next.js, Remix, Astro) highlighting common pre-release pitfalls.
