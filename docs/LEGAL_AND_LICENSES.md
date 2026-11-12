# Legal & Dependency License Compatibility Audit

**Governing License:** Functional Source License, Version 1.1, MIT Conversion (FSL-1.1-MIT)  
**Checked:** 2026-11-10, against the `dependencies` of every `packages/*/package.json` and the `license` field of each installed package  
**Status:** No GPL or AGPL runtime dependency found. This is an engineering check, not legal advice.

---

## 1. Executive Summary

This document verifies the legal compatibility between the QA Flow Tester licensing model (FSL-1.1-MIT) and all direct and transitive third-party dependencies utilized across `@qa/core`, `@qa/runner`, `@qa/checkers`, and `@qa/wizard`.

The repository's core code is licensed under **FSL-1.1-MIT**, which allows free use, modification, and internal hosting, converting to standard MIT after two years. None of the included dependencies impose conflicting copyleft requirements that would jeopardize this license.

---

## 2. Runtime Dependencies

Direct `dependencies` of the five packages. `types` and `runner` have none outside the workspace.

| Package                                                              | Used by        | Declared version              | License      | Note                                                                                                              |
| -------------------------------------------------------------------- | -------------- | ----------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `@axe-core/playwright` (brings `axe-core`)                           | checkers       | `^4.10.1`                     | MPL-2.0      | File-level copyleft. Used unmodified through `import`; MPL-2.0 section 3.3 lets a larger work keep its own terms. |
| `playwright`                                                         | checkers, core | `1.65.0`                      | Apache-2.0   | Permissive. Keep its licence text when redistributing.                                                            |
| `pixelmatch`                                                         | checkers       | `^7.2.0`                      | ISC          | Permissive.                                                                                                       |
| `pngjs`                                                              | checkers, core | `^7.0.0`                      | MIT          | Permissive.                                                                                                       |
| `yaml`                                                               | checkers       | `^2.9.1`                      | ISC          | Permissive.                                                                                                       |
| `mammoth`                                                            | core           | `1.12.3`                      | BSD-2-Clause | Permissive. Reads uploaded `.docx` files (ADR 0023).                                                              |
| `@napi-rs/keyring`                                                   | core           | `^2.1.0`                      | MIT          | Permissive. OS keychain access.                                                                                   |
| `react`, `react-dom`                                                 | wizard         | `^18.3.1`                     | MIT          | Permissive.                                                                                                       |
| `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`           | wizard         | `^6.3.1`, `^10.0.0`, `^3.2.2` | MIT          | Permissive.                                                                                                       |
| `firebase`                                                           | wizard         | `13.1.0`                      | Apache-2.0   | Permissive. Helper sign-in only.                                                                                  |
| `@fontsource-variable/anek-latin`, `@fontsource-variable/anek-tamil` | wizard         | `5.3.0`                       | OFL-1.1      | Font licence. The fonts ship in the wizard bundle; OFL allows bundling, not selling the fonts on their own.       |

Build and test tooling (`typescript`, `vite`, `vitest`, `eslint`, `prettier`) is MIT or Apache-2.0 and is not shipped in the wizard bundle.

Transitive dependencies are not listed here. `pnpm licenses list --prod` prints them.

---

## 3. Strict Prohibitions Enforced

1. **No GPL / AGPL Runtime Dependencies:** The codebase strictly excludes GPL-v2/v3 and AGPL-v3 libraries in runtime paths to ensure no viral copyleft obligations affect users or deployments.
2. **Attribution:** No NOTICE file is kept in this repository. Each dependency's licence text ships inside its package under `node_modules`. A redistributed bundle or image must keep those texts (Apache-2.0, MIT, BSD, ISC, MPL-2.0, OFL-1.1).
3. **Patent Grant & Trademark:** No trademarks of Playwright, Microsoft, Google, or axe/Deque Systems are claimed as proprietary.
