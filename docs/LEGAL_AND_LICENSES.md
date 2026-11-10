# Legal & Dependency License Compatibility Audit

**Document Reference:** G32  
**Governing License:** Functional Source License, Version 1.1, MIT Conversion (FSL-1.1-MIT)  
**Date of Audit:** 2026-11-06  
**Status:** Clean — Fully Compliant

---

## 1. Executive Summary

This document verifies the legal compatibility between the QA Flow Tester licensing model (FSL-1.1-MIT) and all direct and transitive third-party dependencies utilized across `@qa/core`, `@qa/runner`, `@qa/checkers`, and `@qa/wizard`.

The repository's core code is licensed under **FSL-1.1-MIT**, which allows free use, modification, and internal hosting, converting to standard MIT after two years. None of the included dependencies impose conflicting copyleft requirements that would jeopardize this license.

---

## 2. Key Runtime Dependencies Audit

| Package                            | Version   | License              | Compatibility Analysis                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | --------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axe-core`                         | `^4.10.2` | **MPL-2.0**          | **Compliant (File-Level Copyleft):** Mozilla Public License 2.0 applies strictly to modifications of `axe-core`'s own source files. QA Flow Tester consumes `axe-core` via standard `require()` / `import` without modifying `axe-core` source files. Per MPL-2.0 Section 3.3 ("Larger Works"), combining `axe-core` with independently authored software does not require the larger software to be licensed under MPL-2.0. |
| `playwright`                       | `1.63.0`  | **Apache-2.0**       | **Compliant (Permissive):** Apache 2.0 allows commercial and non-commercial redistribution and integration with standard notice preservation. Notices are included.                                                                                                                                                                                                                                                          |
| `express` / `body-parser` / `cors` | Various   | **MIT**              | **Compliant (Permissive):** Standard MIT license is 100% compatible with FSL-1.1-MIT.                                                                                                                                                                                                                                                                                                                                        |
| `docx` / `pdf-lib`                 | Various   | **MIT / Apache-2.0** | **Compliant (Permissive):** Used for document rendering without license conflict.                                                                                                                                                                                                                                                                                                                                            |
| `vitest` / `typescript` / `vite`   | Various   | **MIT / Apache-2.0** | **Compliant (Dev Dependencies):** Build-time tooling only; not distributed with binary/docker outputs.                                                                                                                                                                                                                                                                                                                       |

---

## 3. Strict Prohibitions Enforced

1. **No GPL / AGPL Runtime Dependencies:** The codebase strictly excludes GPL-v2/v3 and AGPL-v3 libraries in runtime paths to ensure no viral copyleft obligations affect users or deployments.
2. **Attribution & Notice File:** Third-party license notices and copyright headers are preserved in accordance with Apache 2.0 and MIT terms.
3. **Patent Grant & Trademark:** No trademarks of Playwright, Microsoft, Google, or axe/Deque Systems are claimed as proprietary.
