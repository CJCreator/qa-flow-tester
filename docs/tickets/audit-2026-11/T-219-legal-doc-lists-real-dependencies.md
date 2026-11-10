# T-219: Licence doc lists the dependencies the project really has

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | docs | built |

**Files you may edit (no others):**
- `docs/LEGAL_AND_LICENSES.md`

**Do not build in parallel with:** none.

## Problem
`docs/LEGAL_AND_LICENSES.md` says "Status: Clean — Fully Compliant" on the strength of a table that does not
match the code:

- It lists `express` / `body-parser` / `cors` and `docx` / `pdf-lib`. None is a dependency of any package.
- It lists `axe-core ^4.10.2`. The dependency is `@axe-core/playwright ^4.10.1` (which brings `axe-core`).
- It omits every other runtime dependency, including `mammoth` (BSD-2-Clause), `firebase` (Apache-2.0) and the
  two fonts (OFL-1.1).
- Section 3 item 2 says third-party notices "are preserved". There is no NOTICE file in the repository.

## Current code
`docs/LEGAL_AND_LICENSES.md:3-6` and `:20-34` (branch `worktree-audit-cleanup`)
```markdown
**Document Reference:** G32  
**Governing License:** Functional Source License, Version 1.1, MIT Conversion (FSL-1.1-MIT)  
**Date of Audit:** 2026-11-06  
**Status:** Clean — Fully Compliant
```
```markdown
## 2. Key Runtime Dependencies Audit

| Package                            | Version   | License              | Compatibility Analysis  ...
| `axe-core`                         | `^4.10.2` | **MPL-2.0**          | **Compliant (File-Level Copyleft):** ...
| `playwright`                       | `1.63.0`  | **Apache-2.0**       | **Compliant (Permissive):** ...
| `express` / `body-parser` / `cors` | Various   | **MIT**              | **Compliant (Permissive):** ...
| `docx` / `pdf-lib`                 | Various   | **MIT / Apache-2.0** | **Compliant (Permissive):** ...
| `vitest` / `typescript` / `vite`   | Various   | **MIT / Apache-2.0** | **Compliant (Dev Dependencies):** ...

---

## 3. Strict Prohibitions Enforced

1. **No GPL / AGPL Runtime Dependencies:** The codebase strictly excludes GPL-v2/v3 and AGPL-v3 libraries in runtime paths to ensure no viral copyleft obligations affect users or deployments.
2. **Attribution & Notice File:** Third-party license notices and copyright headers are preserved in accordance with Apache 2.0 and MIT terms.
3. **Patent Grant & Trademark:** No trademarks of Playwright, Microsoft, Google, or axe/Deque Systems are claimed as proprietary.
```
(The table rows are shown cut at `...`; in the file each is one long line.)

## Change
1. Replace the four header lines (3-6) with:
   ```markdown
   **Governing License:** Functional Source License, Version 1.1, MIT Conversion (FSL-1.1-MIT)  
   **Checked:** 2026-11-10, against the `dependencies` of every `packages/*/package.json` and the `license` field of each installed package  
   **Status:** No GPL or AGPL runtime dependency found. This is an engineering check, not legal advice.
   ```
   Keep the two trailing spaces at the end of the first two lines (they are Markdown line breaks).
2. Replace the whole section 2 (the heading, the table and everything up to the `---` before section 3) with:
   ```markdown
   ## 2. Runtime Dependencies

   Direct `dependencies` of the five packages. `types` and `runner` have none outside the workspace.

   | Package                                                         | Used by           | Declared version | License      | Note                                                                                                              |
   | --------------------------------------------------------------- | ----------------- | ---------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
   | `@axe-core/playwright` (brings `axe-core`)                      | checkers          | `^4.10.1`        | MPL-2.0      | File-level copyleft. Used unmodified through `import`; MPL-2.0 section 3.3 lets a larger work keep its own terms. |
   | `playwright`                                                    | checkers, core    | `1.63.0`         | Apache-2.0   | Permissive. Keep its licence text when redistributing.                                                           |
   | `pixelmatch`                                                    | checkers          | `^7.2.0`         | ISC          | Permissive.                                                                                                       |
   | `pngjs`                                                         | checkers, core    | `^7.0.0`         | MIT          | Permissive.                                                                                                       |
   | `yaml`                                                          | checkers          | `^2.9.1`         | ISC          | Permissive.                                                                                                       |
   | `mammoth`                                                       | core              | `1.12.3`         | BSD-2-Clause | Permissive. Reads uploaded `.docx` files (ADR 0023).                                                             |
   | `@napi-rs/keyring`                                              | core              | `^2.1.0`         | MIT          | Permissive. OS keychain access.                                                                                   |
   | `react`, `react-dom`                                            | wizard            | `^18.3.1`        | MIT          | Permissive.                                                                                                       |
   | `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`      | wizard            | `^6.3.1`, `^10.0.0`, `^3.2.2` | MIT | Permissive.                                                                                                |
   | `firebase`                                                      | wizard            | `13.1.0`         | Apache-2.0   | Permissive. Helper sign-in only.                                                                                  |
   | `@fontsource-variable/anek-latin`, `@fontsource-variable/anek-tamil` | wizard       | `5.3.0`          | OFL-1.1      | Font licence. The fonts ship in the wizard bundle; OFL allows bundling, not selling the fonts on their own.       |

   Build and test tooling (`typescript`, `vite`, `vitest`, `eslint`, `prettier`) is MIT or Apache-2.0 and is not shipped in the wizard bundle.

   Transitive dependencies are not listed here. `pnpm licenses list --prod` prints them.
   ```
3. In section 3, replace item 2 with:
   ```markdown
   2. **Attribution:** No NOTICE file is kept in this repository. Each dependency's licence text ships inside its package under `node_modules`. A redistributed bundle or image must keep those texts (Apache-2.0, MIT, BSD, ISC, MPL-2.0, OFL-1.1).
   ```
4. Leave section 1 and the other items of section 3 as they are.

## Tests
```
pnpm exec prettier --write docs/LEGAL_AND_LICENSES.md
pnpm format:check
```
This grep must print nothing:
```
grep -n "express\|body-parser\|pdf-lib\|docx\` /\|Fully Compliant\|1\.48\.0" docs/LEGAL_AND_LICENSES.md
```
Cross-check the versions against the manifests (they must match the table):
```
grep -n "\"@axe-core/playwright\"\|\"pixelmatch\"\|\"pngjs\"\|\"yaml\"\|\"mammoth\"\|\"@napi-rs/keyring\"\|\"firebase\"\|\"react\"\|\"@fontsource" packages/*/package.json
```

## Done when
- [x] The table lists only packages that appear in a `packages/*/package.json` `dependencies` block.
- [x] No "Fully Compliant" claim and no claim that a notice file exists.
- [x] `pnpm format:check` passes.

## Notes
- Licences above were read from the `license` field of the installed packages on 2026-11-10
  (`@axe-core/playwright` 4.13.0 and `axe-core` 4.13.0: MPL-2.0; `playwright` 1.63.0: Apache-2.0;
  `mammoth` 1.12.3: BSD-2-Clause; `firebase` 13.1.0: Apache-2.0; both fonts 5.3.0: OFL-1.1). Do not change a
  licence from memory.
- If another ticket has already removed `pngjs` from `packages/core/package.json` (T-231), write `checkers` in
  the "Used by" cell of that row.
- Prettier re-aligns the table columns; that is expected.
- `docs/OPEN_ISSUES.md` row G32 cites this doc; that file is deleted by T-217.
