# 0044: Expansion Platform Scope and Architecture Roadmap

**Document Reference:** G23, G24, G25, G26  
**Status:** Accepted (Architectural Roadmap), 2026-11-06  
**Context:** G23–G26 in `docs/OPEN_ISSUES.md` identify future platform expansion directions:
- G23: Security Probes on verified test copies
- G24: Phone apps (Maestro integration)
- G25: Public API as an App (programmatic headless execution)
- G26: Desktop client (Electron packaging)

---

## 1. Context & Motivation

The core value proposition of QA Flow Tester is instant, zero-install, deterministic web testing with one release verdict. As the platform matures, users require expansion into native mobile testing, desktop packaging, and deep API automation while maintaining strict host isolation and security.

---

## 2. Decision & Architecture Strategy

### 2.1 G23: Active Security Probes on Verified Test Copies
- **Boundary:** High-risk active penetration probes (SQLi, IDOR, SSRF mutations) are **strictly forbidden** on production domains.
- **Rule:** Active security probes are enabled **only** when the domain proves ownership via `/.well-known/qa-verify.txt` AND the request explicitly carries `x-qa-test-copy: true` (ADR 0014, ADR 0030).
- **Execution:** Probes run non-destructively on dedicated staging copies without altering state.

### 2.2 G24: Mobile Testing via Maestro Integration
- **Engine Selection:** Rather than embedding heavy Appium dependencies, QA Flow Tester interfaces with [Maestro](https://maestro.mobile.dev/) YAML declarative test specifications.
- **Integration Point:** The AI Planner and deterministic plan generator export mobile test journeys in standard Maestro YAML format, runnable via `maestro test`.

### 2.3 G25: Public API as a Service & CLI Library
- **Programmatic SDK:** In addition to the HTTP runner API, `@qa/core` exports a headless class `QAFlowRunner` allowing Node.js and TypeScript developers to embed the full checkup lifecycle in custom scripts:
  ```ts
  import { QAFlowRunner } from '@qa/core';
  const runner = new QAFlowRunner({ url: 'https://staging.myapp.com' });
  const report = await runner.run();
  console.log(report.verdict); // 'Ready to release'
  ```

### 2.4 G26: Desktop Packaging (Electron / Tauri)
- **Engine Choice:** For desktop users requiring local testing of localhost and firewalled intranet applications without browser permission warnings, a lightweight packaging architecture using **Tauri** (Rust + system webview) or **Electron** bundles the runner and wizard into a standalone `.exe` / `.dmg` installer.

---

## 3. Consequences

- Clear scoping prevents architectural creep while establishing concrete interfaces for mobile, desktop, and API expansion.
- Core safety principles (ADR 0003, ADR 0014, ADR 0030) are preserved across all expansion vectors.
