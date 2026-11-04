# Review report

> Maintained by AI-EOS (`/ai-eos:review`: code-reviewer, security-engineer, architecture-analyst).
> Every finding cites the inspected code (`path:line`). No change is approved without reading its diff.

## Scope

| Field | Value |
|---|---|
| Base | |
| Head | |
| Tasks covered | |
| Reviewers | |

## Findings

<!-- ai-eos:begin findings -->
| ID | Severity | Status | Title | Location | Requirements | Source | Resolution |
|---|---|---|---|---|---|---|---|
| F-001 | major | open | ADR 0031 (Accepted) outbound-request rules are not implemented: page-derived requests bypass safeGet | packages/core/src/discovery/deterministic-spider.ts:428 | — | architecture-analyst:ARCHAN-001 | — |
| F-002 | minor | open | CLAUDE.md wizard import rule differs from code and guard test | packages/wizard/src/screens/ReportScreen.tsx:2 | — | architecture-analyst:ARCHAN-001 | — |
| F-003 | minor | open | safe-public scan path is API-only and runs a narrower checker set than the Check-up | packages/runner/src/session/checkup-run.ts:603 | — | architecture-analyst:ARCHAN-001 | — |
<!-- ai-eos:end findings -->

Severity: `blocker` (must fix before completion; blocks the gate), `major` (fix or explicitly accept),
`minor`, `info`.

## Integration check

<!-- ai-eos:begin integration -->
_Run `aieos integrate check` to populate._
<!-- ai-eos:end integration -->

## Review notes

### Correctness

### Architecture and interfaces

### Maintainability and conventions

### Error handling and performance

### Security

## Verdict

_`changes required` while any blocker is open; otherwise `acceptable` with listed follow-ups._
