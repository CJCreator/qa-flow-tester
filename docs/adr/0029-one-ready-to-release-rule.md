# 0029: One Ready-to-Release Rule, Honest Grades

Status: Accepted, 2026-10-17 (demo-readiness plan, decision 1; ticket T-30). Builds on [0009](0009-ai-plans-every-plan-item.md) and [0018](0018-claim-wording.md).

## Context
Four places defined "ready to release" differently: the verdict, the CLI exit code, the report stamp and the settings text. A Major could fail the stamp but pass the exit code. An area nothing checked showed 100 and an A, the overall grade could read better than the worst area, a 404 on `/items/500` could read as a crash, and completion always read 100%.

## Decision
- The rule is defined once, in `packages/types/src/verdict.ts`. Standard: 0 Blockers and every checked area at C or better. Majors do not block on their own but lower the area grade. Strict: 0 Blockers, 0 Majors, every area at A. Lenient: 0 Blockers.
- `releaseVerdict` in `packages/types/src/verdict.ts` is the only place the rule is defined. With no gate given it uses Standard. The CLI exit code (`standard`), the stamp, the Actions summary and the report all call it.
- An area with no checks run has grade `null` (never 100, never an A) and is left out of the overall score. The overall grade is capped at the worst area grade and is `null` when no area was checked.
- The first-party crash grade reads the structured `is5xx` on the finding, not the title text.
- Completion is passed over total test points.
- Every report has a "What this did not check" section (skipped or blocked tests, areas not checked). The verdict text counts them.
- AI-written findings are advisory and never change the verdict or grade caps.

## Consequences
- A site with only Majors can now read "Ready to release" under Standard. The reason text still lists the smaller problems worth fixing.
- Consumers of `AspectScore.grade` and `overallGrade` must handle `null`.
