# T-220: README corrections (beta privacy line, stale troubleshooting item, broken contents links)

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | docs | built |

**Files you may edit (no others):**
- `README.md`

**Do not build in parallel with:** none. T-231 depends on this ticket (it removes the `pnpm dev` script that
step 5 stops using).

## Problem
Five wrong or stale things in `README.md`:

1. **Line 228 says beta testers share reports.** "Everyone with the link sees the same reports". `docs/API.md`
   (beta copy) says each visitor sees only their own check-up, and `PRIVACY.md` says a report can be opened
   only from the session that started it.
2. **Troubleshooting item 1 is not about this project.** It tells the reader to blank a hooks file of a Google
   Cloud telemetry plugin under `$HOME\.gemini\...`. Nothing in this repository creates or reads that file.
3. **The Table of Contents links do not work on GitHub.** Ten `##` headings start with an emoji. GitHub builds
   the anchor from the heading text, so `## ⚡ Quick Start` gets the anchor `-quick-start`, and the link
   `(#quick-start)` goes nowhere.
4. **Line 169 uses `pnpm dev`.** `CLAUDE.md` and the scripts document `pnpm dev:wizard`; `dev` is a duplicate
   that T-231 removes.
5. **Two lines use words the glossary avoids for the App** ("Staging / Dev", "staging or dev App", "scan").
   `CONTEXT.md` says "test copy" and "check".

## Current code
All in `README.md` (branch `worktree-audit-cleanup`).

Headings (line numbers):
```
9:## 📑 Table of Contents
29:## 🏗️ Overview & Architecture
70:## 📦 Monorepo Structure
82:## 📋 Prerequisites
92:## ⚡ Quick Start
154:## 🖥️ Running the Applications
235:## 🧪 End-to-End (E2E) Testing Guide
281:## 🧪 Testing & Quality Checks
301:## 🔍 Troubleshooting & FAQ
344:## 📄 License
```
Line 47:
```
        App["Target Web Application\n(Staging / Dev / Public Site)"]
```
Lines 168-170:
````
```bash
pnpm dev   # http://localhost:3002, API calls passed on to the QA Tool on 3001
```
````
Line 228:
```
- One check-up runs at a time. Everyone with the link sees the same reports, and deleting check-ups, schedules and comparisons are closed.
```
Line 241:
```
Use your own staging or dev App, or a public site you are allowed to scan. The repository has no built-in test site; real sites are the test target.
```
Lines 301-312:
````
## 🔍 Troubleshooting & FAQ

### 1. `Cannot find module '...telemetry_hook_bundle.js'`

This occurs if the local Google Cloud telemetry plugin on Windows has invalid path quoting.

- **Fix**: Blank out the hooks file in PowerShell:
  ```powershell
  Set-Content -Path "$HOME\.gemini\config\plugins\googlecloudtools.datacloud_telemetry\hooks.json" -Value "{}"
  ```

### 2. `TimeoutError: waiting for selector ... failed: timeout 30000ms exceeded`
````
The later items are headed `### 3. ...` (line 318), `### 4. ...` (line 329), `### 5. ...` (line 335).

## Change
1. Remove the emoji and the space after it from the ten `##` headings listed above. Results:
   `## Table of Contents`, `## Overview & Architecture`, `## Monorepo Structure`, `## Prerequisites`,
   `## Quick Start`, `## Running the Applications`, `## End-to-End (E2E) Testing Guide`,
   `## Testing & Quality Checks`, `## Troubleshooting & FAQ`, `## License`.
   Do not change line 1 (the `#` title) or any `###` heading text. Do not change the Table of Contents links.
2. Line 47: replace `(Staging / Dev / Public Site)` with `(Your test copy or a public site)`.
3. Line 169: replace `pnpm dev   #` with `pnpm dev:wizard   #`.
4. Line 228: replace the line with:
   ```
   - One check-up runs at a time. Each tester sees only their own check-ups and reports. Deleting check-ups, schedules and comparisons is closed.
   ```
5. Line 241: replace `Use your own staging or dev App, or a public site you are allowed to scan.` with
   `Use a test copy of your own App, or a public site you are allowed to check.` Keep the second sentence.
6. Delete troubleshooting item 1: the heading `### 1. ...telemetry_hook_bundle.js...`, its paragraph, the
   `- **Fix**` bullet with its PowerShell block, and one blank line, so `## Troubleshooting & FAQ` is followed
   by one blank line and then the old item 2.
7. Renumber the remaining four items: `### 2.` becomes `### 1.`, `### 3.` becomes `### 2.`, `### 4.` becomes
   `### 3.`, `### 5.` becomes `### 4.`. Change the number only.

## Tests
```
pnpm exec prettier --write README.md
pnpm format:check
pnpm exec vitest run packages/runner/tests/config-docs.test.ts
```
These greps must print nothing:
```
grep -n "telemetry_hook_bundle\|\.gemini\|sees the same reports\|Staging / Dev\|allowed to scan" README.md
grep -n "^## .*[^ -~]" README.md
grep -n "pnpm dev  " README.md
```
(The second grep finds any `##` heading that still has a non-ASCII character.)

## Done when
- [x] The ten `##` headings have no emoji, and every Table of Contents link matches a heading's anchor.
- [x] Troubleshooting has four items, numbered 1 to 4.
- [x] The beta bullet says each tester sees only their own check-ups.
- [x] `config-docs.test.ts` passes (it checks every `pnpm` command and link in the README).

## Notes
- GitHub anchors: lowercase the heading, drop punctuation, turn each space into `-`. `Overview & Architecture`
  becomes `overview--architecture` (two hyphens, because `&` is dropped between two spaces). The existing
  links already use these forms.
- `pnpm dev:wizard` exists in `package.json` (`"dev:wizard": "pnpm --filter @qa/wizard dev"`).
- Do not rewrite the introduction or any other section. Only the lines named above.
