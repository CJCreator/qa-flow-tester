# T-384: Say source-available, not open source, and give every package an SPDX licence

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | docs | inconsistency | todo |

**Files you may edit (no others):**

- `CLAUDE.md`
- `docs/PRODUCT_GUIDE.md`
- `packages/types/package.json`
- `packages/checkers/package.json`
- `packages/core/package.json`
- `packages/runner/package.json`
- `packages/wizard/package.json`

**Do not build in parallel with:** T-386 (edits `CLAUDE.md`); T-351 (edits `package.json`); T-383 (edits `package.json`); T-271, T-383 (all edit `package.json`); T-278, T-383 (all edit `package.json`); T-268 (edits `package.json`); and any ticket that runs `pnpm install` or edits a `package.json`.

## Problem

The licence is the Functional Source License 1.1 with an MIT future licence (`LICENSE`, abbreviation `FSL-1.1-MIT`). That is "source-available", not "open source": the licence limits competing commercial use for two years. `README.md:337` and `CONTRIBUTING.md:50-52` say so. Two other places still say open source:

- `CLAUDE.md:3`: "Open-source, self-hosted tool that scans a web app...". This is the file every coding session reads first.
- `docs/PRODUCT_GUIDE.md:7`: "Open source and self-hosted; a hosted copy runs on Google Cloud Run." This is user-facing text.

Calling it open source is wrong in a way that matters to a company deciding whether it may use the tool. Also, none of the five `packages/*/package.json` files has a `license` field. The root says `"license": "SEE LICENSE IN LICENSE"` (`package.json:7`). All five are `private: true`, so nothing is published, but tools that read the manifests (licence scanners, SBOM generators) report "no licence" for every package.

## Current code

Branch from `main`. `grep -rn "[Oo]pen[- ]source" CLAUDE.md docs/PRODUCT_GUIDE.md` and `grep -L '"license"' packages/*/package.json`.

`CLAUDE.md:3`:

```
Open-source, self-hosted tool that scans a web app, writes a reviewable Plan, runs it with Playwright and
```

Each `packages/<name>/package.json` begins:

```json
{
  "name": "@qa/types",
  "version": "0.1.0",
  "private": true,
  "type": "module",
```

## Change

1. `CLAUDE.md:3`: change "Open-source, self-hosted tool" to "Source-available (FSL-1.1-MIT), self-hosted tool". Change nothing else in the file (T-386 edits another line of it).
2. `docs/PRODUCT_GUIDE.md:7`: change "Open source and self-hosted;" to "Source-available (Functional Source License, MIT after two years) and self-hosted;".
3. In each of the five `packages/*/package.json`, add `"license": "FSL-1.1-MIT",` directly after the `"private": true,` line. `FSL-1.1-MIT` is the SPDX identifier on the first lines of `LICENSE`. Do not change the root `package.json` (its "SEE LICENSE IN LICENSE" is valid and points at the text). No `pnpm install` is needed: `license` does not change the lockfile. Check with `git diff --stat` that `pnpm-lock.yaml` is untouched.
4. Run `pnpm exec prettier --check` on the seven files.

## Tests

None needed: wording and one manifest field. Run `pnpm exec prettier --check CLAUDE.md docs/PRODUCT_GUIDE.md packages/*/package.json` and `pnpm build` (the manifests are read by it).

## Done when

- [ ] `grep -rn "[Oo]pen[- ]source" CLAUDE.md docs/PRODUCT_GUIDE.md` prints nothing.
- [ ] `grep -L '"license": "FSL-1.1-MIT"' packages/*/package.json` prints nothing.
- [ ] `git diff --stat pnpm-lock.yaml` is empty; prettier and `pnpm build` pass.

## Notes

- Audit finding L1 (audit of 11 Nov 2026 on `d225418`).
- `docs/GTM_AND_PRICING.md:28` also says "open source", but in a comparison table about other tools; it is left alone. If the owner wants it checked, that is a separate wording pass.
- T-351 (the `@qa/types` exports map) leaves the licence field to this ticket. T-386 also edits `CLAUDE.md`: they change different lines, but do not build them at the same moment.
