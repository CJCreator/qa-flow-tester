# 0024: Intent on Plan Items, and the Refusal Rule for Rejects

Status: Accepted, 2026-10-12 (agreed in a grilling session on `QA testcases plan.md`). Implemented in four tickets: Intent migration, Rejects and the refusal rule, Plan Review and Test cap, Spider deep exploration. Implemented 2026-10-12. See [0025](0025-spider-guarded-delete-probe.md) for the Delete probe.

Builds on [0003](0003-deterministic-safety-filters-for-ai-discovery.md) (Safety Filter), [0014](0014-verified-domains-and-safe-host-classification.md) (Test Copy), [0020](0020-sources-role-binding-and-pipelined-planning.md) (Sources) and [0022](0022-test-sign-in-as-consent.md) (sign-in consent).

## Context
The plan wants positive and negative coverage: valid input, validation errors, boundary values and permission denials. Today a Plan Item has only `kind: 'denial'` for blocked actions. The plan's own wording ("negative test", "test matrix", "happy path") is on the glossary's _Avoid_ lists.

## Decision
- **Intent** is a new glossary term on journey and form Plan Items: **Works**, **Rejects**, **Limits**, **Denied**. Denied is the existing Denial Plan Item and replaces `kind: 'denial'`. Page visits and Navigation Checks have no Intent. UI text does not say "positive", "negative" or "happy path".
- **Who plans what:** fixed rules plan Rejects from form attributes (required, type, pattern), with or without an AI key. Limits needs the AI Planner or a Source. Without a key, Limits are not planned.
- **Refusal rule:** a Rejects item passes when the page did not move on (no success redirect, no new record) and something signalled refusal: the browser `:invalid` state, `aria-invalid`, `role="alert"`, or new visible error text. It fails if the app accepted the input. The exact message is compared only when the Source states it. No AI judges it.
- **Export:** the Playwright export ships a generated `expectRefused` helper that implements the same rule, so the app run and the export agree and the person can tighten it.
- **Test Copy:** Rejects and Limits submit forms, so they follow the existing rules. On an App that is not a Test Copy and has no sign-in consent (ADR 0022), they stay in the Plan, switched off, with the reason "needs a Test Copy". They are not a failure.
- **Fan-out:** Rejects and Limits run for every role and screen size. A per-check-up Test cap bounds them. Items over the cap are planned but switched off, with the reason "over the Test cap", and the approval summary states how many.
- **Plan Review:** every Intent is on by default, with a filter chip and one switch-off per Intent (a Scope Exclusion). The approval summary states the counts per Intent.
- **Ambiguity Questions:** a Rejects or Limits item asks only when the form's submit matches the Safety Filter (payment, delete, email, admin change). The options are run, switch off, or probe only up to client-side validation.
- **Verdict:** failures count as Run Findings. A failure backed by a Source weighs more. A failure found only by the generic rule is lower severity. A Limits item that merely accepted an extreme value, with no Source, goes under Needs your judgement. A crash or error page counts as a failure.
- **Interactive States:** a form inside a modal, drawer or tab is reached through opening steps the Spider recorded. They are stored on the Plan Item, shown in Plan Review, and replayed by the export. If the opener is missing at run time the result is "could not reach", not a form failure.
- **Spider contract:** deep exploration (tabs, accordions, drawers, modals) runs under Safe Interaction Mode. CRUD lifecycles are inferred from structure only (list, Add form, edit form from a row, Delete behind a confirm dialog) and reported as facts. Nothing is submitted during the scan. Delete is probed up to its confirm dialog and cancelled. The AI Planner plans the actual create and edit journeys, which run only where full testing is allowed.

## Consequences
- The generic refusal rule can miss an app that shows an error in an unusual way (a toast with no `role`). Such a case fails as "accepted" until the person tightens the helper or adds a Source with the message.
- Full fan-out can make Plans large. The Test cap is the only bound on Rejects, because they cost no AI requests; the AI Request Budget bounds Limits only.
- Recorded opening steps can go stale between the scan and the run, which is why "could not reach" is a separate result.
- `kind: 'denial'` in the types, wizard and issue-type mapping must migrate to Intent. That touches `packages/types`, `core/plan`, the wizard and the exporter, so it needs a build and a test pass across packages.
- "New record" is a heuristic: the count of visible table rows, `[role=row]`, `li` and `[role=listitem]` on the page before the submit is compared with the count after. A page with a live list can misfire.
- The Test cap trims only Rejects and Limits, last planned first. Works, Denied, page visits and Navigation Checks are never dropped. Tests are counted as test cases times screen sizes, the same as the approval summary.
- GET forms (search) get no Rejects or Limits, since nothing is sent. A number input gets a Rejects item only when it has a `min` or `max`.
- Loosening the refusal rule or the Test Copy gating needs a new ADR.

## Amendment: alerts count only after the submit (2026-10-21, T-48)
- A `role="alert"` is a refusal signal only when its text is new since the baseline taken right before the submit click. An alert that was already on the page (a permanent banner) is not a signal, so a form that accepts the value is not "refused".
- A probe-only Rejects item (the person chose "probe only") sends nothing. Its baseline is the page as the steps left it, taken before the probe is read. A failed step is reported as the step failure, not as a refusal.
- The Source's sentence is compared with the alert text the page shows first, then new error text, then the browser's native `validationMessage`. A `novalidate` form that shows the Source's sentence in an alert is therefore not a "different wording" finding.
- `:invalid` and `aria-invalid` stay state signals and are not diffed against the baseline. The baseline is taken after the fills, so a value the test typed that the browser marks invalid is already in it. Diffing would turn every native refusal into "accepted".
- Known gap: a success message with `role="alert"` that appears after the submit and where the page does not move on still counts as a refusal. Tightening this needs a new ADR.
