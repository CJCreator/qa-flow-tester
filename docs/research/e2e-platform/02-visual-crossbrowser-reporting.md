# Cluster 02: Visual testing, browsers and devices, reporting

Checked 2026-10-05. Follows [00-brief.md](00-brief.md). Vendor marketing is marked *(vendor claim)*. Anything I couldn't confirm is marked *(unverified)*. A competitor's statement about another vendor is marked *(competitor claim)*.

## 1. Scope

This file covers six things:

1. Visual regression testing: baselines, approval, diffing, masking.
2. Browsers and devices: Playwright's Chromium, Firefox and WebKit against real Safari and real devices, and the grids that rent them.
3. Reporting and analytics: shareable reports, history, trends.
4. Defect tracking without a tracker: a stable JSON schema and Markdown for AI coding tools.
5. Test management and governance.
6. Release gates and CI.

The comparison is a founder or developer who would otherwise use their own Playwright `toHaveScreenshot()` tests, GitHub Actions and a spreadsheet.

## 2. Market map

| Tool | Category | What's relevant | Free tier / price | Source |
|---|---|---|---|---|
| Playwright `toHaveScreenshot` | Built-in visual test | Baselines saved per browser and OS. Options to allow a number of differing pixels, mask regions, and inject CSS. Uses pixelmatch. | Free | [docs](https://playwright.dev/docs/test-snapshots) |
| pixelmatch | Diff library | Colour-distance test with anti-alias detection. `threshold` defaults to 0.1. ISC licence. The QA Tool already uses it. | Free | [repo](https://github.com/mapbox/pixelmatch) |
| Argos | Visual review platform | Open source (MIT) and self-hostable. Captures happen in your own test browser and it diffs any file, not just images. Has an agent-ready CLI and API *(vendor claim)*. | Hobby free (5,000 screenshots a month). Pro $100 a month (35,000). Extra $0.004 each. | [pricing](https://argos-ci.com/pricing), [repo](https://github.com/argos-ci/argos), [comparison](https://argos-ci.com/blog/visual-testing-pricing) |
| Chromatic | Visual review, Storybook-first | Free plan is Chrome only. Safari, Firefox and Edge start on the paid plan. | Free: 5,000 snapshots a month. Starter $179 (35,000). Pro $399 (85,000). Extra $0.008 each. | [pricing](https://www.chromatic.com/pricing) |
| Percy (BrowserStack) | Visual review | Free plan has 5,000 screenshots a month, unlimited users and projects. Percy has an MCP server for AI assistants, which needs a licence. | Free. Paid prices not on the pages I could open; a competitor lists the cheapest tier at $599 a month *(competitor claim)*. | [docs](https://www.browserstack.com/docs/percy/overview/plans-and-billing), [MCP](https://www.browserstack.com/docs/browserstack-mcp-server/tools/percy), [competitor page](https://argos-ci.com/blog/visual-testing-pricing) |
| Applitools Eyes | Visual AI | Starter is $667 a month billed yearly. Higher plans are "contact sales". Only a free trial. | Trial only | [pricing](https://applitools.com/platform-pricing/) |
| Lost Pixel | Open-source visual testing | Archived 22 April 2026. The team is "joining Figma" and sunsetting the product. No shutdown date for the hosted platform. | n/a (MIT code remains) | [repo](https://github.com/lost-pixel/lost-pixel), [announcement](https://www.lost-pixel.com/blog/lost-pixel-team-is-joining-figma) |
| BackstopJS | Open-source visual testing | MIT. Runs Playwright (Chromium, Firefox, WebKit) or Puppeteer. The README says it "needs a new maintainer". | Free | [repo](https://github.com/garris/BackstopJS) |
| BrowserStack | Browser and device grid | Live (manual) from $29 a month billed yearly. Automate from $59. Free trial only. | See left | [pricing](https://www.browserstack.com/pricing) |
| TestMu AI (was LambdaTest) | Browser and device grid | Rebranded 12 Jan 2026. Free plans exist: SmartUI 2,000 screenshots (lifetime), Automation 100 minutes (lifetime), Test Manager free. Live testing $15 to $39 a month. | Free plans plus paid | [rebrand](https://www.testmuai.com/blog/lambdatest-rebrands-to-testmu-ai/), [pricing](https://www.testmuai.com/pricing/) |
| Sauce Labs | Browser and device grid | Live $39, Virtual Device Cloud $149, Real Device Cloud $199 a month (annual). 14-day-style trials, no free plan. Sauce Visual includes 500 snapshots a month. | Trial only | [pricing](https://saucelabs.com/pricing) |
| Allure Report 3 | Report generator | Apache-2.0, TypeScript rewrite, plugin system. Runs locally and in CI. Repo active as of 30 Sept 2026 *(per search summary; not opened)*. | Free | [site](https://allurereport.org/), [repo](https://github.com/allure-framework/allure3) |
| ReportPortal | Self-hosted reporting server | Apache-2.0. Minimum setup is Docker Compose on one machine. Production needs RabbitMQ, MinIO and Traefik. | Free (self-hosted) | [repo](https://github.com/reportportal/reportportal) |
| Currents | Playwright dashboard | Flaky-test detection, analytics, orchestration. Scale $49 a month for 10,000 results. No free plan on the page. | Scale $49, Business $99 | [pricing](https://currents.dev/pricing) |
| Playwright reporters | Built-in reports | `html`, `json`, `junit`, `github` and `blob`. `merge-reports` joins shards into one HTML report. | Free | [docs](https://playwright.dev/docs/test-sharding) |
| Qase | Test management | Free: 4 users, 2 active runs, 500 MB, 30-day history, 5,000 API results a month. Teams $35 per user a month (annual, minimum 5 users). SSO on Teams. Audit logs and SCIM on Enterprise only. | Free plus paid | [pricing](https://qase.io/pricing) |
| TestRail | Test management | Essentials $22 (max 5 users), Professional $38, Enterprise $78 per user a month (annual). SSO, audit logs on Enterprise. 30-day trial. | Trial only | [pricing](https://www.testrail.com/pricing/) |
| Xray, Zephyr Scale | Test management inside Jira | Priced by the size of your Jira instance. Needs Jira. Entry prices came from review sites only. | *(unverified)* | [overview](https://aqua-cloud.io/xray-review-2026-features-pricing/) |
| AGENTS.md | Format for AI coding tools | Plain Markdown, no required fields. Stewarded by the Agentic AI Foundation under the Linux Foundation. Used by over 60,000 open-source projects *(vendor claim)*. | Free | [agents.md](https://agents.md/) |

## 3. Capabilities

### 3.1 Visual regression: baselines and approval

- **What leading tools do:**
  - Playwright saves a reference screenshot the first time a test runs. "Took a bunch of screenshots until two consecutive screenshots matched" before saving, and `--update-snapshots` regenerates baselines ([docs](https://playwright.dev/docs/test-snapshots)).
  - Argos, Chromatic and Percy add a review page and a pull-request status check. A person approves a change and the baseline moves ([Argos](https://argos-ci.com/pricing), [Chromatic](https://www.chromatic.com/pricing), [Percy](https://www.browserstack.com/docs/percy/overview/plans-and-billing)). Percy's MCP server can approve or reject baselines from an AI assistant ([docs](https://www.browserstack.com/docs/browserstack-mcp-server/tools/percy)).
- **QA Tool today:**
  - [`design-standards.ts`](../../../packages/checkers/src/design-standards.ts) compares the final screen with a stored baseline using pixelmatch (default threshold 0.1) and raises "Visual regression against baseline". The fix text says to run `qa-test run ... --update-baselines`.
  - A different size from the baseline counts as a layout shift.
  - Baselines live on the user's disk. There's no review page and no approval record.
- **Gap:** Approval is a CLI flag, not a step in the Plan Review. Nobody can see old, new and diff side by side and approve in the browser. The first check-up has nothing to compare against.
- **Applies to:**
  - **Website:** directly.
  - **Phone app:** later, as screenshots from the driver or device farm. Fonts and status bars differ by device, so baselines are per device.
  - **Desktop app:** Electron screenshots work the same way; native apps need a driver.
  - **API:** not applicable.
- **Verdict: Build now.** Show old, new and diff in the report, with an "Approve as new baseline" button that writes the baseline file. Every comparison needs it, the file format already exists, and the browser report already hosts buttons.

### 3.2 Diffing method and noise

- **What leading tools do:**
  - Pixel tools such as pixelmatch use a colour-distance test and skip anti-aliased pixels ([repo](https://github.com/mapbox/pixelmatch)). Playwright takes the same library and adds `maxDiffPixels` ([docs](https://playwright.dev/docs/test-snapshots)).
  - Playwright warns that rendering varies "based on the host OS, version, settings, hardware, power source, headless mode" ([docs](https://playwright.dev/docs/test-snapshots)). Its fix is separate baselines per browser and platform.
  - Applitools and Percy sell "Visual AI" that ignores changes a person wouldn't notice *(vendor claim)* ([Applitools](https://applitools.com/platform-pricing/), [Percy](https://percy.io/blog/ai-visual-testing-tools)).
  - Argos and Percy differ in where capture happens. Argos diffs screenshots from your own browser. Percy re-renders your page's HTML in BrowserStack's cloud *(competitor claim)* ([Argos](https://argos-ci.com/blog/visual-testing-pricing)).
- **QA Tool today:**
  - Pixelmatch plus an AI visual review, in the same file. The code comment calls the metric YIQ; the pixelmatch README now describes OKLab *(version difference not checked)*.
  - Name in [CONTEXT.md](../../../CONTEXT.md): "Perceptual Visual Diff".
- **Gap:**
  - There's no masking of changing content (dates, ads, carousels, cookie banners) and no page stabilising (waiting for fonts and images, freezing animations). Without both, shared cloud machines will give false alarms. Playwright already offers `mask`, `animations` and `stylePath` for this.
  - Baselines must be tied to one machine type (see 3.4).
- **Applies to:** Website first. Phone apps need per-device baselines.
- **Verdict: Build now** for stabilising and masking (auto-mask elements that look like timestamps, ads and embeds, and let the person add more in the Plan Review). **Skip** a proprietary "Visual AI" engine. The AI visual review already exists, and a person approves anyway, which fits "deterministic tests".

### 3.3 Visual testing on a live site vs a Test Copy

- Visual checks only look at the page, so they are safe on any site. They are noisy on live sites with ads and A/B tests.
- **Verdict: Build now** as the default for Sample Pages of each Layout Group. Only compare against a baseline the same tool made, never against Figma pixels (the Figma token sync already handles design intent).

### 3.4 Browsers: Playwright builds against real Safari

- **What Playwright says:**
  - Its WebKit "is derived from the latest WebKit main branch sources, often before these updates are incorporated into Apple Safari" ([docs](https://playwright.dev/docs/browsers)).
  - Playwright "doesn't work with branded Safari" because of custom patches ([docs](https://playwright.dev/docs/browsers)).
  - For "the closest-to-Safari experience", it recommends WebKit on macOS rather than Linux, because media codecs differ ([docs](https://playwright.dev/docs/browsers)).
  - Android: Playwright can drive Chrome for Android over ADB, but the feature is "experimental" ([docs](https://playwright.dev/docs/api/class-android)).
- **What a WebKit build misses for iPhone users:**
  - It's a newer engine than the Safari people have installed.
  - It has no Safari interface: toolbar behaviour, safe areas, the on-screen keyboard and iOS-only form controls aren't there.
  - On Linux, video and audio codecs differ.
  - Real touch, real fonts and real GPU rendering aren't covered.
  - Chrome and Firefox on iPhone were required to use WebKit until iOS 17.4, which let EU users install other engines ([AppleInsider](https://appleinsider.com/articles/24/01/25/browsers-like-chrome-and-firefox-can-abandon-webkit-in-eu-with-ios-174)). I did not confirm the rule's current wording outside the EU *(unverified)*.
  - So WebKit finds layout and JavaScript problems that Safari would also show. It doesn't prove "works on an iPhone".
- **QA Tool today:** [`browser.ts`](../../../packages/core/src/browser.ts) launches Chromium only.
- **Gap:** No Firefox or WebKit runs, and no mobile device emulation presets (viewports exist, devices don't).
- **Applies to:**
  - **Website:** directly.
  - **Phone app:** mobile web only. Store apps need a driver (cluster 07).
  - **Desktop app:** not applicable.
  - **API:** not applicable.
- **Verdict: Build now** for a WebKit and Firefox pass over the Sample Pages (the brief's step 2 for mobile web). Label the result "WebKit (Playwright build)", never "Safari". Screenshot baselines are kept per browser, and the report says what the build can't tell you. This matches the brief's order of work.

### 3.5 Real devices and browser grids

- **Prices today:**
  - BrowserStack Live $29 to $39 a month and Automate $59 to $225 a month, all billed yearly, with a free trial ([pricing](https://www.browserstack.com/pricing)).
  - TestMu AI has free plans (SmartUI 2,000 screenshots lifetime, Automation 100 minutes lifetime) and Live from $15 a month ([pricing](https://www.testmuai.com/pricing/)).
  - Sauce Labs starts at $39 for Live testing and has no free plan ([pricing](https://saucelabs.com/pricing)).
- **Rebrand check:** LambdaTest became TestMu AI on 12 January 2026 and the old name now redirects to the new brand ([TestMu](https://www.testmuai.com/blog/lambdatest-rebrands-to-testmu-ai/)).
- **QA Tool today:** none.
- **Verdict: Connect.** Users who need real Safari rent it on their own account (this matches the brief: heavy use on the user's own accounts). Don't resell a grid. Cluster 07 covers per-grid API details.
- **Applies to:** Website (mobile web), Phone app, Desktop app (limited).

### 3.6 Shareable reports, history and trends

- **What leading tools do:**
  - Playwright's HTML report is a single folder. `blob` reports from shards merge into one HTML report with `merge-reports` ([docs](https://playwright.dev/docs/test-sharding)).
  - Allure 3 builds a report from results files, locally or in CI, with plugins ([site](https://allurereport.org/)).
  - ReportPortal keeps history in a server with a database, a queue and object storage ([repo](https://github.com/reportportal/reportportal)). That's a hosting job.
  - Currents keeps trends and flaky-test data for Playwright from $49 a month ([pricing](https://currents.dev/pricing)).
- **QA Tool today:**
  - [`reporter.ts`](../../../packages/core/src/reporter.ts) writes `findings.json` and `report.md`. The Markdown opens with a plain verdict (using GitHub alert blocks), then a coverage table, delta since last release, a traceability table and findings by severity.
  - [`html-report.ts`](../../../packages/core/src/html-report.ts) writes the HTML version.
  - Report Hub (optional) merges findings, tracks Finding Lifecycle State and marks Flaky Passed (code since removed).
- **Gap:**
  - A shareable link without the Hub. A single self-contained HTML file can be mailed or attached but can't be linked to without hosting.
  - Trend across check-ups for one App on a free tier (the Hub needs Postgres and S3).
  - Past check-ups are kept in site history, but no trend chart in the report.
- **Applies to:** every App, since the report doesn't depend on the platform.
- **Verdict:**
  - **Build now:** a trend strip in the report (score per area over the last N check-ups) from existing site history, and a "share" export as one self-contained HTML file. Neither needs hosting.
  - **Connect:** Allure and Currents for teams who already use them. Emit JUnit XML (3.8).
  - **Skip:** ReportPortal. It is a server a founder has to run.

### 3.7 Defect tracking without a tracker

The brief says target teams track work in docs or nowhere, so there is no Jira or Linear. A report has to work as the backlog.

**What real tools do**
- Playwright's `json` reporter and Allure keep one record per test with stable ids so history can be joined ([docs](https://playwright.dev/docs/test-sharding), [Allure](https://allurereport.org/)).
- AGENTS.md is "a README for agents": plain Markdown, no schema, with build and test commands and boundaries. A nested file takes precedence for the folder it sits in ([agents.md](https://agents.md/)).
- Percy's MCP server fetches "AI summaries of visual differences" and manages approvals from inside an AI assistant ([docs](https://www.browserstack.com/docs/browserstack-mcp-server/tools/percy)).
- GitHub's SARIF code-scanning format takes up to 25,000 results a run and shows the top 5,000, in files up to 10 MB gzipped ([docs](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)). I did not check whether private repos need a paid plan *(unverified)*.

**What the QA Tool has today**
- The `Finding` type in [`packages/types/src/index.ts`](../../../packages/types/src/index.ts) already has an id, severity, checker, where (path, role, screen size, selector), expected and actual, steps, a repro script, evidence paths, a fix suggestion, a `verifyCommand`, a triage status, and a source location where known.
- That is most of an AI-ready bug report. Two gaps: the Structural Fingerprint lives in the Hub types, not in `findings.json`, and the JSON has no declared schema version.

**Proposals**

| Idea | What it is | Why |
|---|---|---|
| Schema version and a published JSON Schema | Add `schemaVersion` to `findings.json` and ship `findings.schema.json` in the repo. Never rename a field without bumping the version. | Scripts, AI tools and CI steps can rely on it. |
| Fingerprint in every finding | Write the Structural Fingerprint into each finding in `findings.json`, not only in the Hub. | It lets two reports be compared with no server. It is the join key for "new, fixed, came back". |
| One brief per finding | `findings/F-007.md`: title, severity, the page and role, expected and actual, steps, the repro command, the likely file (`sourceLocation`), the `verifyCommand`, and a "done when" line. About 300 words each. | Paste it into Claude Code, Cursor or Copilot as the task. |
| A `fix-these.md` | All Blockers and Majors in one Markdown file, ordered, with a short instruction at the top ("fix one at a time, run its verify command, don't change unrelated files"). | One paste gives an AI tool a work list. |
| An AGENTS.md snippet | A copy-paste block users add to their repo's AGENTS.md: where the reports live, how to read `findings.json`, and the rule "re-run `qa-test verify <id>` before saying a finding is fixed". | AGENTS.md is the format AI tools already read ([agents.md](https://agents.md/)). |
| A state file the user commits | `known-findings.json` holding Not-a-problem and It's-intended decisions, with reasons. | The decisions travel with the code and need no tracker. |
| Optional SARIF export | Map each finding to a SARIF result so findings show in GitHub's Security tab. | Free for public repos; private-repo terms unchecked. Build later. |

- **Applies to:** every App. For a phone app, the file path comes from stack traces or the driver's view tree; for an API App, from a route name.
- **Verdict: Build now** for schema version, fingerprint, per-finding briefs and the `fix-these.md`. These are small changes to code that already writes the data. **Build later** for SARIF.

### 3.8 Release gates and CI

- **What the platform gives for free:**
  - Job summaries: any Markdown appended to `GITHUB_STEP_SUMMARY` shows on the run page, up to 1 MiB per step ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)).
  - Annotations: `::error file=...,line=...::message` marks lines in the log and on pull requests ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)).
  - Check runs with inline annotations can be made through the API, 50 per request, but only a GitHub App can create them ([docs](https://docs.github.com/en/rest/checks/runs)). That means asking users to install an app, which is a heavier connection.
  - Preview URLs: the `deployment_status` event starts a workflow when a host reports a finished deployment, and it doesn't run for `inactive` states ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
  - Pull requests from forks get no secrets other than a read-only `GITHUB_TOKEN` ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). An AI key in a fork's check-up won't be available.
- **What the vendors do:** Argos, Chromatic and Percy publish a pull-request status check that stays "pending" until a person approves the visual changes ([Argos](https://argos-ci.com/pricing), [Chromatic](https://www.chromatic.com/pricing)).
- **QA Tool today:**
  - The CLI prints "BLOCKERS FOUND! Release is NOT recommended" or "Release ready!" ([`cli/src/index.ts`](../../../packages/cli/src/index.ts) lines 170 to 175). I did not find a non-zero exit code tied to that verdict in the lines I read *(unverified)*.
  - The brief mentions an example GitHub Actions workflow. I did not find one in this worktree *(unverified)*.
  - Every run emits `report.md`.
- **Gap:** an explicit `--fail-on blocker|major` exit code, a step-summary writer, a preview-URL workflow template, and a pull-request comment that shows only what changed since the base branch.
- **Applies to:** Website and API now. Phone apps once the driver runs in CI.
- **Verdict: Build now** for the exit code, step summary, annotations and a workflow template that waits for a preview URL. **Connect** for pull-request comments through the user's own `GITHUB_TOKEN` in the workflow (a few lines of script). **Skip** a GitHub App for check runs until users ask.

### 3.9 Test management and governance

- **What it is:** TestRail, Qase, Xray and Zephyr keep test cases, runs, and who ran what.
- **Prices:**
  - Qase Free: 4 users, 2 projects reported, 500 MB, 30-day history ([pricing](https://qase.io/pricing)). Teams is $35 per user a month, and a 5-user minimum makes that about $175 a month.
  - TestRail Essentials $22 per user a month for up to 5 users ([pricing](https://www.testrail.com/pricing/)).
  - Xray and Zephyr need Jira and are priced by instance size *(entry prices unverified)*.
  - Audit logs and SCIM are Enterprise only on Qase. On TestRail, SSO, MFA and audit logs are Enterprise ([Qase](https://qase.io/pricing), [TestRail](https://www.testrail.com/pricing/)).
- **QA Tool today:** a Plan is the test list. The Markdown report already includes a requirement traceability table (requirement, flow, test case, status, evidence). The Hub keeps per-finding status.
- **Cheapest credible version for small teams:**
  1. The Plan plus the traceability table is the test case list. Commit the approved Plan and the reports in the repo.
  2. A "release record" page at the top of each report: Release Target, who approved the Plan, date, verdict, known findings with reasons. That is the audit trail a small team needs.
  3. For a QA tester who wants a real tool, export JUnit XML or JSON that Qase's free plan can ingest through its reporter API (the free cap is 5,000 results a month, which is a few full check-ups).
- **Applies to:** every App.
- **Verdict:** **Skip** building test management, roles, SSO and audit logs. **Build now** the release record, as it costs a few lines of Markdown. **Connect** to Qase for QA testers. The decided direction says QA testers are a second type of user.

## 4. Trends and openings (2025 to 2026)

1. **Visual testing is consolidating.**
   - Lost Pixel was archived on 22 April 2026 as its team joined Figma ([announcement](https://www.lost-pixel.com/blog/lost-pixel-team-is-joining-figma)).
   - BackstopJS is looking for a maintainer ([repo](https://github.com/garris/BackstopJS)).
   - Percy sits inside BrowserStack, and Applitools shows no public price above $667 a month ([pricing](https://applitools.com/platform-pricing/)).
   - What's left for a small team: Argos (open source, $100 a month) and Chromatic (Storybook-first, $179 a month), plus the free tiers. The opening is a visual check that needs no test code and no extra bill.
2. **Visual review is coming into AI assistants.** Percy's MCP server fetches AI summaries and approves baselines inside a coding assistant ([docs](https://www.browserstack.com/docs/browserstack-mcp-server/tools/percy)). Argos pitches an agent-ready CLI and API *(vendor claim)* ([comparison](https://argos-ci.com/blog/visual-testing-pricing)). Reports that tell an AI tool what to fix are a normal expectation now.
3. **AGENTS.md has become the shared convention.** It moved under the Linux Foundation's Agentic AI Foundation and works in Codex, Cursor, Copilot, Aider and others ([agents.md](https://agents.md/)). A plain-Markdown handoff works with all of them.
4. **Grid vendors rebrand around agents.** LambdaTest is now TestMu AI, which describes itself as an "agentic AI quality engineering platform" *(vendor claim)* ([TestMu](https://www.testmuai.com/blog/lambdatest-rebrands-to-testmu-ai/)). Free tiers exist but are small (SmartUI 2,000 screenshots lifetime).
5. **Test-management prices cluster at $35 to $40 per user a month** (Qase Teams $35, TestRail Professional $38), with SSO and audit logs reserved for the top plan. Free plans cap at 4 to 5 users.
6. **No-tracker is open ground.** None of the visual or reporting tools I read produce a per-finding brief for an AI coding tool. The pieces exist (see 3.7), but no one ships them as a report format *(unverified: based on the docs I read, not an exhaustive survey)*.

## 5. Fit with the limits

- **$0 hosting:**
  - Diffing is cheap, but storage isn't: a 1440 px full-page screenshot per Sample Page, at three screen sizes and several browsers, adds up. Argos's free tier counts 5,000 screenshots a month, which is a useful sizing guide.
  - Keep baselines on the user's disk or in their repo. Don't store them centrally while hosting is free.
  - Chromium, Firefox and WebKit on a small shared Linux machine cost memory and time. Run Chromium for everything and WebKit and Firefox on Sample Pages only.
- **Browser-only:** the approval button and trend strip live in the report page. A real-Safari check is a link out to the user's own grid account.
- **Teams without QA staff:** hide the pixel diff. Say "The pricing page looks different from last week: the header moved down 40 px", with the picture under it.
- **Risks and conflicts:**
  - Baselines from a shared cloud machine and the user's laptop won't match (Playwright's own warning). A baseline must remember which machine type made it.
  - False alarms from ads and dates will teach people to ignore the report. Masking comes first.
  - "WebKit passed" must never be shown as "Safari passed".
  - Writing per-finding briefs means text from the site (error messages, page content) reaches a prompt in someone's AI tool. Treat it as untrusted: quote it in code blocks and say so at the top of the brief *(my recommendation, not sourced)*.

## 6. Open questions

1. Do early users already have screenshots tests, or is "nothing changed visually since last release" new to them?
2. Where should baselines live: next to the report on the user's disk, in their repo, or on our storage once hosting exists?
3. Would early users paste a per-finding brief into an AI coding tool, or would they want one file for everything?
4. Do users want a failing exit code on Major findings, or only on Blockers?
5. How many early users test on an iPhone today, and would they accept "WebKit build, not Safari" or only real devices?
6. Do QA testers in the second user group already hold a Qase or TestRail account, and which file format would they import?
7. Does the existing workflow file for GitHub Actions still exist? The brief says so and I didn't find one in this worktree.

## 7. Sources

- Repo code: [design-standards.ts](../../../packages/checkers/src/design-standards.ts), [reporter.ts](../../../packages/core/src/reporter.ts), [html-report.ts](../../../packages/core/src/html-report.ts), [browser.ts](../../../packages/core/src/browser.ts), [types](../../../packages/types/src/index.ts), [CONTEXT.md](../../../CONTEXT.md)
- Playwright: https://playwright.dev/docs/test-snapshots · https://playwright.dev/docs/browsers · https://playwright.dev/docs/api/class-android · https://playwright.dev/docs/test-sharding
- Visual tools: https://github.com/mapbox/pixelmatch · https://argos-ci.com/pricing · https://github.com/argos-ci/argos · https://argos-ci.com/blog/visual-testing-pricing · https://www.chromatic.com/pricing · https://www.browserstack.com/docs/percy/overview/plans-and-billing · https://www.browserstack.com/docs/browserstack-mcp-server/tools/percy · https://percy.io/blog/ai-visual-testing-tools · https://applitools.com/platform-pricing/ · https://github.com/lost-pixel/lost-pixel · https://www.lost-pixel.com/blog/lost-pixel-team-is-joining-figma · https://github.com/garris/BackstopJS
- Grids: https://www.browserstack.com/pricing · https://www.testmuai.com/pricing/ · https://www.testmuai.com/blog/lambdatest-rebrands-to-testmu-ai/ · https://saucelabs.com/pricing · https://appleinsider.com/articles/24/01/25/browsers-like-chrome-and-firefox-can-abandon-webkit-in-eu-with-ios-174
- Reporting: https://allurereport.org/ · https://github.com/allure-framework/allure3 · https://github.com/reportportal/reportportal · https://currents.dev/pricing
- Test management: https://qase.io/pricing · https://www.testrail.com/pricing/ · https://aqua-cloud.io/xray-review-2026-features-pricing/
- AI-tool formats and CI: https://agents.md/ · https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning · https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands · https://docs.github.com/en/rest/checks/runs · https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
