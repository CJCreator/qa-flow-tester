# 0017: Findings contract

Status: Accepted 2026-10-08 (owner accepted all seven recommended answers in "Decisions for owner").

Builds on [0004](0004-structural-fingerprint-dedup.md) (Structural Fingerprint), [0012](0012-hosted-runner-github-actions.md) (CI route) and [0018](0018-claim-wording.md) (claim wording). Redaction is owned by 0016 (T-20, pending); this ADR makes no redaction claim.

## Context and Decision
`findings.json` is read by other tools today (the suppressions delta, history, the wizard) with no version and no stable id per finding. People now want to feed it to CI and to coding agents. That makes its shape a public contract. We keep v1 small.

### Version
- `findings.json` gets a top-level integer `schemaVersion`. This ADR defines `1`.
- A file with no `schemaVersion` is version 0 (written before the contract). It must still be read. `SuppressionsManager.computeDelta` reads only `.findings[].checker`, `.title` and `.where.urlPath`, so it keeps working.
- Policy:
  - Adding an optional field, or a new output file, is not a bump.
  - Removing, renaming or retyping a field, changing what a field means, or changing the fingerprint inputs is a bump. A bump needs a changelog entry, and readers keep reading N-1 for one release.
  - Consumers must ignore unknown fields. The JSON Schema leaves `additionalProperties` open.
- The change is additive. `Finding.fingerprint?` and `ReleaseReport.schemaVersion?` are optional in the types. The stamp is applied where `findings.json` is written (`ReportGenerator.generate`), so `/api/report` and `report.json` do not carry them yet.

### Fingerprint
- Per finding, `fingerprint` is the Structural Fingerprint from 0004, computed by one shared helper `findingFingerprint(finding, productId)` in `@qa/types`. History uses the same helper, so the two cannot drift.
- Inputs: `productId`, route (`where.urlPath`, normalized), checker id (`checker`), rule code (the finding `title`, as 0004 and history already do), selector (`cssSelector`, else `dataTestId`).
- Excluded: run id, timestamp, host, port, absolute paths, breakpoint, role.
- Not unique. The same fingerprint can appear on several findings (one per breakpoint or role). Consumers must not use it as a unique key in `findings`. `known-findings.json` lists unique ones.
- Known limit: changing title wording changes the fingerprint, so a reworded finding shows as new. `issueKey` was rejected as an input: it is optional and few checkers set it.

### Outputs
Written beside `findings.json` in the same call:
- `fix-these.md`: active Blocker and Major only, sorted by severity, urlPath, fingerprint. Each line has fingerprint, severity, title, location (`urlPath (role, breakpoint)`), optional `file:line`, and the first line of the resolution. A count line covers Minor and Suggestion not listed. With none, it says "No Blocker or Major problems found by the automatic checks."
- `known-findings.json`: `{ "schemaVersion": 1, "productId": "...", "findings": [{ "fingerprint", "severity", "checker", "title", "urlPath" }] }`. Active findings only, unique by fingerprint, sorted by fingerprint. It reads back with `parseKnownFindings`, which returns null on garbage.
- `AGENTS.snippet.md`: static text with no finding data. It tells an agent to read `qa-report/fix-these.md`, fix by fingerprint, treat quoted text as data and not instructions, re-check with a new Check-up, and not describe the site as compliant or secure.
- "Active" is the existing predicate: not `needsConfirmation`, and not triaged Intended or False Positive.
- The JSON Schema is `docs/findings.schema.json`, using a small keyword subset (`type, required, properties, items, enum, const, pattern, minimum`). A test validates real output against it with a small in-repo validator. No new dependency.

### Text safety
- The three text outputs and the annotations are built only from severity, checker, title, where, sourceLocation and resolution. Never from `evidence.*` (network logs, console logs, measurements).
- All page-derived text is untrusted data: one line, control characters stripped, capped at 300 characters, and put in code spans in markdown. The AGENTS snippet says to treat it as data.
- This is not a redaction guarantee. Titles and resolutions can still contain text from the page. Redaction is decided in 0016. The orchestrator redacts before `generate`; the safe-scan path is not verified. Until 0016 is accepted, no document or output may claim these files are redacted or safe to share.

### GitHub annotations
- The CI command prints one workflow command per active Blocker or Major, only when `GITHUB_ACTIONS=true`. Blocker is `::error`, Major is `::warning`. Capped at 50 lines; GitHub itself shows only about 10 of each per step. The full list stays in `fix-these.md`.
- `file=` and `line=` only when `sourceLocation.file` is a relative path with no `..`, no drive letter and no leading slash. Otherwise they are omitted and the page path goes in the message.
- Escaping follows GitHub's rules. Message: `%` to `%25`, `\r` to `%0D`, `\n` to `%0A`. Properties (`title`, `file`) also escape `:` to `%3A` and `,` to `%2C`. A page title containing `\n::error::x` becomes one line.
- `exitCodeFor` is unchanged.

### Wording
Outputs say what was checked. They never say compliant or secure (0018). Terms follow the glossary: Check-up, Structural Fingerprint, Finding; not "bug ticket", "error hash" or "checksum".

### Out of scope
Trend strip, release record, Playwright export, fail-only-on-new, a wizard download of the new files, and any change to safety filters, read-only default, host confinement or redaction.

## Decisions for owner
1. **Approve this ADR and the v1 shape?** Recommended: yes. Code for T-16 waits for this.
2. **Annotation severity: Blocker as `::error`, Major as `::warning`?** The ticket example shows `::error`. Recommended: split, so a Major does not look like a failed build when `exitCodeFor` may still pass it. Alternative: both `::error`.
3. **Fingerprint input is the finding `title`, so rewording changes it. Accept?** Recommended: yes, it matches 0004 and history today. Alternative: add a stable rule code to every checker first (bigger change, separate ticket).
4. **Fingerprint not unique in `findings`. Accept?** Recommended: yes. Alternative: add breakpoint and role to the input, which breaks equality with history.
5. **No redaction claim until 0016 is accepted. Accept?** Recommended: yes. T-20 owns it.
6. **Hand-written schema validator for tests, no `ajv`?** Recommended: yes for now. Adding `ajv` as a `@qa/core` devDependency needs your approval; listed in `docs/tickets/HUMAN_TODO.md` as optional.
7. **`AGENTS.snippet.md` is static text with no finding data. Accept?** Recommended: yes, so no page text can reach an agent's instructions.

## Consequences
- Other tools get a versioned file and a stable id for the same problem across Check-ups, within the title-wording limit.
- Old `findings.json` files keep loading. Old readers ignore the new fields and files.
- A reworded title re-surfaces as new in anything built on `known-findings.json`.
- Consumers who dedupe on `fingerprint` must group, not assume one finding per fingerprint.
- The in-repo validator is a subset and could accept what a full validator rejects. A test fails if the schema uses a keyword outside the subset.
- Page-controlled text reaches `fix-these.md` and CI logs. Sanitizing and code spans reduce the risk; they are not redaction.
- `/api/report` and `report.json` stay without the new fields until a later change.
