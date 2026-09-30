# QA Flow Tester / Pre-Release Readiness Checker 🧪

> **Automated Web Application Discovery, Interactive Flow Testing, and Deterministic Pre-Release Quality Evaluation.**

`qa-flow-tester` is a comprehensive quality assurance platform that automates user flow discovery using AI, validates design token and accessibility conformance, monitors runtime console/network health, captures visual diffs, and aggregates findings into actionable release reports.

---

## 📑 Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Monorepo Structure](#monorepo-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [1. Clone and Set Up](#1-clone-and-set-up)
  - [2. Start the QA Tool](#2-start-the-qa-tool)
  - [3. Environment Configuration (Optional)](#3-environment-configuration-optional)
- [Running the Applications](#running-the-applications)
  - [Option A: One Command (`pnpm start`)](#option-a-one-command-pnpm-start)
  - [Option B: Full Docker Stack (QA Tool, Hub, MinIO, Postgres)](#option-b-full-docker-stack)
  - [Working on the UIs (Hot Reload)](#working-on-the-uis-hot-reload)
- [End-to-End (E2E) Testing Guide](#end-to-end-e2e-testing-guide)
  - [Step 1: Start the Built-in Test Application](#step-1-start-the-built-in-test-application)
  - [Step 2: Run Automated Checks with CLI](#step-2-run-automated-checks-with-cli)
  - [Step 3: Run AI Discovery & Test Planning](#step-3-run-ai-discovery--test-planning)
  - [Step 4: Use Release check-up](#step-4-use-release-check-up)
  - [Step 5: Inspect Reports and Verify Fixes](#step-5-inspect-reports-and-verify-fixes)
- [CLI Command Reference (`qa-test`)](#cli-command-reference-qa-test)
- [Competitive Benchmarking (`qa-test compare`)](#competitive-benchmarking-qa-test-compare)
- [Centralized Report Hub (`qa-test hub`)](#centralized-report-hub-qa-test-hub)
- [Figma Token & Baseline Synchronization](#figma-token--baseline-synchronization)
- [Testing & Quality Checks](#testing--quality-checks)
- [Troubleshooting & FAQ](#troubleshooting--faq)

---

## 🏗️ Overview & Architecture

The platform operates across four primary operational layers:

```mermaid
flowchart TD
    subgraph UI ["User Interfaces (served by the QA Tool on port 3001)"]
        Wizard["Release check-up (@qa/wizard)\n/ · for everyone, with Details for developers"]
        LocalDash["Review Dashboard (@qa/dashboard)\nPort 3000 / CLI runs only"]
    end

    subgraph CoreEngine ["Execution & Discovery Core"]
        CLI["CLI: qa-test (@qa/cli)"]
        Runner["QA Tool server (@qa/runner)\nPort 3001: API (HTTP + SSE) and the Wizard"]
        Orchestrator["Flow Test Orchestrator (@qa/core)"]
        AI["AI Discovery Agent\n(Claude / OpenAI / Gemini / OpenRouter / Mock)"]
        Checkers["Audit Checkers (@qa/checkers)\n(Axe WCAG, Design Tokens, Visual Diff, Console/Network)"]
    end

    subgraph HubLayer ["Central Aggregation & Storage"]
        Hub["Report Hub Server (@qa/hub)\nPort 4000"]
        Postgres[(PostgreSQL 16\nPort 5432)]
        MinIO[(MinIO Object Store\nPorts 9000 / 9001)]
    end

    subgraph Target ["Target Under Test"]
        App["Target Web Application\n(Staging / Dev / Fixture App)"]
    end

    Wizard -->|POST /api/runner/run| Runner
    Runner -.->|/hub and /api/v1/*, when HUB_API_URL is set| Hub
    Runner --> Orchestrator
    CLI --> Orchestrator
    Orchestrator --> AI
    Orchestrator --> Checkers
    Checkers -->|Playwright Automation| App
    Orchestrator -->|Push Run| Hub
    Hub --> Postgres
    Hub --> MinIO
    LocalDash -.->|Reads Local Output| Orchestrator
```

### Core Capabilities

1. **AI Discovery Agent**: Crawls the whole site (up to 200 pages), records which page links to which, and has the AI plan every page, link and journey from what it found (see [ADR 0009](docs/adr/0009-ai-plans-every-plan-item.md)).
2. **Complete plan review**: The plan lists everything a run will do and what won't run, and is exactly what runs. Review it, change it and approve it before anything is tested.
3. **Deterministic Checkers**:
   - **Accessibility**: WCAG 2.1 AA audits via `axe-core`.
   - **Design Token Conformance**: Validates live `getComputedStyle()` against committed `design-tokens.json` (colors, radii, typography).
   - **Visual Baselines**: Perceptual visual diffing across multiple breakpoints (`375px`, `768px`, `1440px`).
   - **Runtime Health**: Intercepts unhandled console errors and failed HTTP network calls.
4. **Targeted Bug Verification**: Re-executes the exact flow and step of an individual finding (`qa-test verify <id>`) to confirm fixes.
5. **Competitive Benchmarking**: Crawls a public competitor or reference flow in Safe Interaction Mode and generates UX friction scorecards and AI recommendations.
6. **Central Report Hub**: Aggregates runs across developer machines with structural fingerprint deduplication, two-phase artifact ingestion (screenshots/traces/videos), and product release tracking.

---

## 📦 Monorepo Structure

| Package / Directory | Purpose |
| :--- | :--- |
| [`packages/core`](packages/core) | Core test orchestration, AI discovery agent, test planner, crawler, benchmarking engine, and AI providers |
| [`packages/checkers`](packages/checkers) | Automated checkers (A11y/WCAG, design tokens, visual diffs, console errors, network failures) |
| [`packages/cli`](packages/cli) | Command line interface providing the `qa-test` executable |
| [`packages/runner`](packages/runner) | The QA Tool server: runs check-ups over HTTP with Server-Sent Events (SSE) streaming, keeps past check-ups, and serves the Wizard on the same port |
| [`packages/hub`](packages/hub) | Central report aggregation service, PostgreSQL database driver, and S3 evidence store |
| [`packages/dashboard`](packages/dashboard) | Local review server for confirmation of AI discovery drafts and reports |
| [`packages/wizard`](packages/wizard) | Release check-up, the one app: plain language on top, Details for developers under each finding ([ADR 0010](docs/adr/0010-one-app-with-details-on-demand.md)) |
| [`packages/types`](packages/types) | Shared TypeScript type definitions, schemas, and interfaces |
| [`fixtures/test-app`](fixtures/test-app) | Built-in target test application (Invoicing app with simulated errors) |
| [`scripts/benchmark.ts`](scripts/benchmark.ts) | Automated benchmark harness measuring check accuracy and planted defect detection |

---

## 📋 Prerequisites

Before starting, ensure you have:

- **Node.js**: `v20.x` or `v22.x` (`node -v`)
- **Package Manager**: `pnpm` v9+ (`npm install -g pnpm` or `corepack enable`)
- **Browsers**: Playwright browser binaries
- **Docker & Docker Compose** *(Optional, for running full containerized stack)*

---

## ⚡ Quick Start

### 1. Clone and Set Up

```bash
git clone https://github.com/CJCreator/qa-flow-tester.git
cd "qa-flow-tester"

# Installs dependencies and Playwright's Chromium, then builds every package
pnpm bootstrap
```

Run `pnpm bootstrap` again after every `git pull`. (It isn't called `pnpm setup` because that is a built-in pnpm command.)

### 2. Start the QA Tool

```bash
pnpm start
```

This builds anything that's missing and opens **Release check-up** at **`http://localhost:3001/`** in your browser. It's the one app, for everyone: engineers find screenshots, steps to reproduce, selectors, console errors and a Playwright test under **Details for developers** on each finding. QA Flow Studio's old address, `/studio/`, now leads to Past check-ups.

Leave the terminal open while you use it. `pnpm start --no-open` starts without opening a browser. To use another port, set `RUNNER_PORT` first (PowerShell: `$env:RUNNER_PORT=3055; pnpm start`). The QA Tool only answers on this computer (`localhost`).

### 3. Environment Configuration (Optional)

Copy the example environment configuration:

```bash
cp .env.example .env
```

Key environment variables in `.env`:

```env
# AI Providers (At least one key or use mock mode)
OPENROUTER_API_KEY=sk-or-v1-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=AIza...

# Report Hub & Persistence (Optional for local CLI runs)
HUB_PORT=4000
DATABASE_URL=postgresql://qahub:qahub_secret@localhost:5432/qa_hub?schema=public
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=qa-evidence
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin

# The QA Tool (pnpm start)
RUNNER_PORT=3001
# Optional: a Report Hub, passed on at /hub (its dashboard) and /api/v1/*
HUB_API_URL=http://localhost:4000
```

---

## 🖥️ Running the Applications

### Option A: One Command (`pnpm start`)

`pnpm start` runs the whole tool as one process on one port: the API that runs check-ups and the Wizard at `/`. `qa-test runner` starts the same server from the CLI:

```bash
node packages/cli/dist/index.js runner -p 3001 [--hub http://localhost:4000]
```

The Report Hub (below) stays a separate, optional service. With `HUB_API_URL` set, the top bar links to its dashboard at `/hub`, where findings are accepted across runs.

Site data (each site's approved plan and answers, its grade history, the AI model setup and a plan waiting for review) lives in `.qa-data/`, which git ignores; set `RUNNER_DATA_DIR` to put it elsewhere. Each check-up's report and evidence get their own folder, `.qa-runner-report/runs/<runId>/`, and the last 10 per site are kept. A `sites/` folder left in the working folder by an older version is moved into `.qa-data/` on the first start.

---

### Option B: Full Docker Stack

To launch the complete production-parity stack (PostgreSQL, MinIO S3, Report Hub and the QA Tool):

```bash
# Start all containers in the background
docker compose up -d
```

Service endpoints:
- **Release check-up** (the Wizard and the API): `http://localhost:3001`
- **Report Hub API**: `http://localhost:4000`
- **MinIO Console**: `http://localhost:9001` (User: `minioadmin` / Pass: `minioadmin`)
- **Postgres Database**: `localhost:5432` (User: `qahub` / Pass: `qahub_secret`)

To stop the containers:
```bash
docker compose down
```

---

### Working on the UIs (Hot Reload)

Only needed when you change the Wizard's code. Keep the QA Tool running (`pnpm start`), then:

```bash
pnpm dev   # http://localhost:3002, API calls passed on to the QA Tool on 3001
```

---

## 🧪 End-to-End (E2E) Testing Guide

Follow this walkthrough to run and verify a complete test flow end-to-end against the built-in test application.

### Step 1: Start the Built-in Test Application

The repository includes a fixture application (`@qa/fixture-test-app`) with simulated invoices, authentication, and planted defects:

```bash
# In a new terminal window:
cd fixtures/test-app
node server.js
```
The test app will start at: **`http://localhost:3050`**

---

### Step 2: Run Automated Checks with CLI

Execute a test run using the provided spec and product profile:

```bash
node packages/cli/dist/index.js run \
  --url http://localhost:3050 \
  --product product-alpha \
  --config fixtures/config.yaml \
  --spec fixtures/spec.json \
  --all-breakpoints \
  --dashboard
```

**What happens during this run:**
1. Connects to `http://localhost:3050`.
2. Authenticates as user `manager@example.com` (from `fixtures/config.yaml`).
3. Executes test cases in `fixtures/spec.json` (Create Invoice, Health Telemetry).
4. Runs automated checkers:
   - Validates WCAG 2.1 AA accessibility via `axe-core`.
   - Runs checks at `375px`, `768px`, and `1440px` viewports.
   - Detects the simulated 500 API call and runtime errors.
5. Saves detailed output to `.qa-report/`:
   - `report.md`: Human-readable markdown summary.
   - `findings.json`: Machine-readable findings with structural fingerprints.
   - Screenshots and traces of failed steps.
6. Automatically opens the **Local Review Dashboard** at `http://localhost:3000`.

---

### Step 3: Run AI Discovery & Test Planning

Let the AI Discovery Agent explore the target site and synthesize test plans:

```bash
# Run discovery using Mock AI (or pass --ai-provider openrouter --api-key <key>)
node packages/cli/dist/index.js discover \
  --url http://localhost:3050 \
  --product product-alpha \
  --config fixtures/config.yaml \
  --ai-provider mock
```

1. The agent traverses links, identifies forms, buttons, and state transitions.
2. Identifies user flows and flags ambiguity questions (e.g. destructive actions).
3. Saves discovery draft to `.qa-report/discovery-draft.json`.
4. Opens the **Confirmation Dashboard** at `http://localhost:3000/confirm`.

To compile the draft into an executable test spec:
```bash
node packages/cli/dist/index.js plan --draft .qa-report/discovery-draft.json --output my-plan.spec.json
```

---

### Step 4: Use Release check-up

1. Start the QA Tool, if it isn't running:
   ```bash
   pnpm start
   ```
2. Use Release check-up at `http://localhost:3001/`. Every screen has its own address, so Back, Forward, refresh and bookmarks work. The top bar leads to **New check-up**, **Past check-ups** and **Settings** (and **Team Hub** when a Report Hub is connected).
3. The first time, paste an OpenRouter key where the screen asks for it (the free tier works). It's checked as you paste it and kept on this computer; change it later in **Settings**.
4. Type the site's address. A bare address on this computer or a private network gets `http://`, anything else `https://`; the address actually used shows under the box, with what the check-up will do:
   - **Test copy**: forms can be filled in and sent. Needs **I own this site**, and an address on this computer, a private network or a tunnel, or one you mark as **This is a test copy**.
   - **Live site**: only looked at, nothing is sent or changed.

   Both choices are remembered for the site. Optionally add **Specs**, **Design notes** and **Journeys to test**, or change **Explore up to N pages** (default 200).
5. Click **Scan the site**. The scan shows pages found, layouts, AI requests used and left today, and about how long is left. **Stop scanning** asks first, and returns to the address with everything still filled in.
6. Review the plan, change it if you like, and approve it. Nothing is tested before you approve (see [The plan review](#the-plan-review) below). Leaving the plan keeps it waiting: the new check-up screen offers to resume it.
7. Watch the testing: the page under test, "Test 37 of 412 · about 6 minutes left", the latest screen, and problems as they're found. **Stop testing** keeps the plan, so it can be changed and approved again.
8. Read the report. The stamp (**Ready to release** or **Not ready yet**) is the verdict, with its reason; the six areas are graded under it, and an area nothing checked says **Not checked**. Problems are grouped **Must fix before release**, **Should fix** and **Suggestions**, with **Details for developers** under each. **Download the report** saves it as one HTML file.
9. **Test again** scans the site again and, when nothing changed, tests with the plan you approved without a new review. **Go deeper** scans again signed in. Every report stays in **Past check-ups**.

#### The plan review

The AI writes the whole plan from what the crawler found. The **Full plan** tab lists every part of it:

- **Summary**: how many tests will run, on how many pages, at which screen sizes, and every default applied. This covers questions answered with the safe answer, items planned by fixed rules, and what won't run. You can also choose the screen sizes here, and see the AI requests used and how many are left today.
- **Pages**: every page found, with its click path from the start page, who reaches it, and the tests the AI planned on it. Pages built from one layout at addresses that only differ by the item they show (such as `/products/…`) are tested through three Sample Pages; **Test this page too** tests any other one on its own. **Add page** adds a page no link reaches.
- **Navigation**: every link, checked once. Shared header, menu and footer links are checked once for the whole site, and each page's own links on that page. A check clicks the link like a person would, and passes when the right page opens and works. Where phones or tablets fold the menu behind a button, the check opens the menu first. Links to other sites are only checked for being broken, with one request each. **Explore this site too** crawls and plans another host the site links to.
- **Journeys**: multi-step things a person does across pages. You can also add a test by describing it.
- **Checks on every tested page**, **Won't run** (with reasons), and **Specs and design notes**.

Every item can be switched on or off, or re-planned with the AI (optionally saying what should change). **Download the plan** saves the whole plan as Markdown for sign-off. The **Map** tab draws the pages and the links between them.

The plan needs an AI key: add one on the new check-up screen or in **Settings** (OpenRouter's free tier works). Free models allow 20 requests a minute, and 50 a day until the account has bought 10 credits (then 1,000). The plan asks for about one request per three pages, plus one for the shared menus and one for the journeys. Anything past the day's budget is planned by fixed rules, labelled as such, and can be re-planned later. Free models may occasionally produce malformed JSON or hit output token limits; trailing commas are tolerated, while comments, single quotes or unquoted keys safely trigger the Fixed-Rule Fallback. Any fallback item can be re-planned with one click via **Re-plan**. The next run of the same site reuses the approved plan and only asks the AI about pages and links that changed.

---

### Step 5: Inspect Reports and Verify Fixes

#### View Local Dashboard
To view an existing report at any time:
```bash
node packages/cli/dist/index.js dashboard --dir .qa-report --port 3000
```

#### Perform Targeted Finding Verification
When a developer fixes a reported defect, verify it specifically without running the entire suite:

```bash
# Replace with the finding ID from findings.json (e.g. FIND-001)
node packages/cli/dist/index.js verify FIND-001 --output .qa-report
```

If fixed:
- The finding status updates to `Resolved` in `.qa-report/findings.json`.
- `report.md` is updated automatically.
- Exits with returncode `0`.

---

## 📖 CLI Command Reference (`qa-test`)

Run the CLI using `node packages/cli/dist/index.js` or `pnpm qa-test`:

### `qa-test run`
Executes test cases against a target URL.
```bash
qa-test run -u <url> [options]
```
| Flag | Description | Default |
| :--- | :--- | :--- |
| `-u, --url <url>` | **Required.** Target URL (e.g. `http://localhost:3050`) | — |
| `-p, --product <id>` | Product identifier | `default-product` |
| `-s, --spec <path>` | Path to test spec JSON or YAML file | Default sanity test |
| `-c, --config <path>`| Path to product profile YAML | — |
| `--ai` | Run AI discovery before execution | `false` |
| `--context <path>` | Path to PRD/spec context markdown | — |
| `--ai-provider <p>` | `anthropic`, `openai`, `gemini`, `openrouter`, `mock` | `mock` |
| `--api-key <key>` | API key for AI provider | Env var |
| `--all-breakpoints` | Test across `375px`, `768px`, and `1440px` | `1440px` only |
| `--no-headless` | Run in headed mode (visible browser window) | Headless |
| `-o, --output <dir>` | Directory for reports & evidence | `.qa-report` |
| `--dashboard` | Open local review dashboard upon completion | `false` |
| `--hub <url>` | Report Hub server URL to sync results | — |
| `--hub-token <t>` | Ingest authentication token for Hub | — |
| `--update-baselines`| Update visual snapshot references | `false` |

### `qa-test discover`
Autonomous crawler identifying routes, flows, and state transitions.
```bash
qa-test discover -u <url> -c <config> [--ai-provider mock]
```

### `qa-test plan`
Transforms a discovery draft into an executable `qa.spec.json`.
```bash
qa-test plan -d .qa-report/discovery-draft.json -o qa.spec.json
```

### `qa-test verify <findingId>`
Re-runs the exact interaction point of an identified bug to confirm resolution.
```bash
qa-test verify <findingId> -o .qa-report
```

### `qa-test runner`
Starts the QA Tool server: the API (HTTP + SSE) plus the Wizard at `/`, on one port. `--hub` (or `HUB_API_URL`) passes `/hub` and `/api/v1/*` on to a Report Hub.
```bash
qa-test runner -p 3001 [--hub http://localhost:4000]
```

---

## ⚡ Competitive Benchmarking (`qa-test compare`)

Benchmark an internal staging flow against an external public reference or competitor:

```bash
node packages/cli/dist/index.js compare \
  --target http://localhost:3050/invoices/new \
  --reference https://example.com/checkout \
  --flow onboarding \
  --output .qa-compare
```

**Output Artifacts (`.qa-compare/`):**
- **Friction Scorecard**: Compares total steps, input fields count, required fields count, and click depth.
- **Pattern Parity**: Audits features like single-click submit, instant validation, social auth, and guest mode.
- **AI UX Gap Recommendations**: Prioritized impact vs. effort UX improvements.

---

## ☁️ Centralized Report Hub (`qa-test hub`)

The Report Hub aggregates quality runs across teams and pipelines.

### 1. Start Hub Server
```bash
node packages/cli/dist/index.js hub start --port 4000 --db "postgresql://qahub:qahub_secret@localhost:5432/qa_hub"
```
*(If `--db` is omitted, the hub runs with an in-memory database).*

### 2. Generate Ingest Token
```bash
node packages/cli/dist/index.js hub create-token --product product-alpha --db "postgresql://..."
```

### 3. Push Runs to Hub
Add `--hub http://localhost:4000 --hub-token <token>` to any `qa-test run` command. If the hub is temporarily unreachable, runs are automatically queued in a local outbox and synced later:
```bash
node packages/cli/dist/index.js hub sync --hub http://localhost:4000 --token <token>
```

---

## 🎨 Figma Token & Baseline Synchronization

Extract design tokens and visual baseline frames directly from Figma for zero-runtime-dependency auditing:

```bash
node packages/cli/dist/index.js figma sync \
  --file <FIGMA_FILE_KEY> \
  --token <FIGMA_PAT> \
  --out design-tokens.json \
  --frame "12:34=TC-001-1440px" \
  --baseline-dir .qa-baselines
```

Add `figmaTokensFile: design-tokens.json` to your product config YAML to automatically enforce CSS token conformance during test runs.

---

## 🧪 Testing & Quality Checks

Run the automated test suites:

```bash
# Run unit & integration tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run code linter
pnpm lint

# Format code
pnpm format

# Run planted-defect benchmark
pnpm benchmark
```

---

## 🔍 Troubleshooting & FAQ

### 1. `Cannot find module '...telemetry_hook_bundle.js'`
This occurs if the local Google Cloud telemetry plugin on Windows has invalid path quoting.
- **Fix**: Blank out the hooks file in PowerShell:
  ```powershell
  Set-Content -Path "$HOME\.gemini\config\plugins\googlecloudtools.datacloud_telemetry\hooks.json" -Value "{}"
  ```

### 2. `TimeoutError: waiting for selector ... failed: timeout 30000ms exceeded`
- Check that the target web application is actually running at the specified URL.
- If testing locally via Docker, use `host.docker.internal` instead of `localhost`.
- Check if elements are housed inside an `iframe`.

### 3. `Port 3001 is used by another program`
`pnpm start` says so when something other than the QA Tool holds the port (if the QA Tool is already running, it just opens it).
- Identify and stop the occupying process:
  ```powershell
  # Windows PowerShell:
  Get-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess | Stop-Process
  ```
- Or use another port: `$env:RUNNER_PORT=3055; pnpm start` (or `qa-test runner -p 3055`).

### 4. The page says "Start Release check-up first"
The page is served by the QA Tool, so this only shows when the QA Tool stopped, or the page was opened from somewhere else. Run `pnpm start` again and leave its terminal open; the page carries on by itself.

### 5. Playwright Browser Launch Errors
- `pnpm start` stops with a message when the browser is missing. `pnpm bootstrap` installs it. On Linux, system libraries may also be needed:
  ```bash
  pnpm --filter @qa/core exec playwright install chromium --with-deps
  ```

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
