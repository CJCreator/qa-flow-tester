# AGENTS.md

Shared by every coding agent (Claude Code, Codex, Cursor). Source of truth.
Every line must change what you do. Lines that don't get deleted.

## 0. Project context (fill once, keep current)

- Product: Self-hosted pre-release check-up tool that scans a web app, writes a reviewable plan, runs Playwright and deterministic checkers, and produces an actionable readiness report.
- Stack: TypeScript strict, Node 22, pnpm monorepo, Vite + React 18 (`packages/wizard`), Tailwind CSS, Express/SSE server (`packages/runner`), Playwright, Vitest; Firebase Auth for Helper sign-in. (Supabase / Next.js / TanStack conventions apply if introduced).
- Market: India. Currency INR (store paise as integers, format with `en-IN`). Dates in IST for display, UTC in DB. Local vendors/gateways first (Razorpay, Cashfree, MSG91 etc.) unless told otherwise.
- Commands: `pnpm start` (or `pnpm dev:wizard`) · `pnpm test` (or `pnpm test:browser` / `pnpm test:all`) · `pnpm lint` · `pnpm typecheck` · `pnpm build`
- Map:
  - `packages/wizard/`: UI (Vite + React, Tailwind CSS, report viewer)
  - `packages/runner/`: Server & CLI (Express HTTP + SSE on port 3001, Firebase auth helper)
  - `packages/core/`: Orchestrator, crawler, AI discovery agent, scoring, report generation
  - `packages/checkers/`: Audit checkers (Axe WCAG, security, SEO, design tokens, visual diff)
  - `packages/types/`: Shared TypeScript types & verdict definitions
  - `docs/`: `docs/adr/` (ADRs), `docs/tickets/INDEX.md` (tickets tracker), `docs/ARCHITECTURE.md`

## 1. Work loop

1. **Read first.** Open the actual code, tests and config. Don't work from search snippets, memory or guesses.
2. **Ambiguous?** State one assumption and proceed. Ask at most one question, and only if the answer changes the approach.
3. **Non-trivial task:** write a 4-line plan before editing:
   - Outcome (exact behavior)
   - Non-goals
   - Files expected to change
   - Proof (the check that shows it works)
4. **Multi-step work** goes in `PLAN.md`, each step with its proof. Two failed attempts on one step: stop, record what failed, re-plan. Never a third blind retry.
5. **Pausing mid-task:** leave `HANDOFF.md` (progress, decisions, files touched, checks run, next steps) so a fresh session can resume cold.
6. **Unfamiliar feature?** Look for an existing open-source approach or library before writing from scratch. Compare 2-3, then pick one.

## 2. Scope: smallest change that works

- Minimum sufficient change. Stay inside the task. Behavior outside it must not change.
- Reuse existing helpers, patterns and test setup before adding anything.
- New abstraction, adapter or config layer only with a second real caller in this task or an explicit requirement.
- No speculative or "future" code. No edge-case handling for risks nobody named: if you think one matters, state the risk and the odds, then wait for a yes.
- No new dependency, rename, refactor or reformat nobody asked for.
- Replace, don't layer. Delete the code you replace. If the product has no users yet, skip backward-compat shims, migrations of old formats and deprecation paths.
- Validate data once, where it enters (API boundary, form, edge function). Inside, trust the types. No null-check confetti at every layer.
- Plan growing mid-task (new layers, workaround stacks, unrelated cleanup)? Stop, rewrite a smaller plan, confirm.

## 3. Doors: when to ask vs. just do

**Two-way doors** (undoable: edits in a branch, new files, local config, new tests): do them, then show what you did.

**One-way doors** (stop and get an explicit yes first):

- Deleting/overwriting user data, dropping tables or columns, rewriting git history, discarding uncommitted work
- Schema, public API, storage format or wire-format changes
- New dependency, framework, paid service or infra
- Anything touching auth, RLS, payments, secrets, or production config
- Sending anything to real users (email, SMS, WhatsApp, push)
- Spending money or burning large quota (many-agent fan-outs, long loops)

Back up before deleting or overwriting. Prefer archive/soft-delete over hard delete.

## 4. Bugs

- Reproduce first, using my steps. Can't? Say exactly what you need.
- Fix the root cause, then rerun the same repro. Never silence an error, swallow an exception or loosen a test to get green.
- Fix-and-review loops: stop after two failed fixes. Reviewers judge only this round's diff, not the whole repo again.
- Bug found while doing something else: note it, don't fix it, unless it blocks the task.
- Perf complaints: profile first, fix the measured top offender. A cache is not a diagnosis.

## 5. Verify before "done"

- Run the narrowest existing tests that cover the change. Read the output yourself.
- Extend the closest existing test before creating a new file. New tests protect a stated acceptance criterion or a regression, not coverage vanity.
- UI: open it and try to break it. Empty, loading, error, long text, double submit, refresh, slow network, 360px phone width.
- A check you didn't run is not a pass. Say "not run" plainly.
- Done means: behavior works, checks pass with commands and results quoted, every touched file is necessary, no debug code, scratch files, dead paths or stray backups remain.

## 6. Parallel by default

- Decompose non-trivial work into independent streams. Run them concurrently (parallel tool calls, subagents, branches/worktrees). Go sequential only on true dependencies.
- Roles: **explorer** reads, **builder** edits, **reviewer** reports and never edits. Each gets one job, minimal context, a done-condition, and returns a short report (max ~5 lines).
- Never two agents on the same file. One owner integrates.
- Verify the key claim in a subagent report before building on it.
- Fan-out costs quota. Don't spawn agents for a task you can finish in one pass.

## 7. Code conventions

**General**

- TypeScript strict. No `any` without a one-line reason. Prefer fewer, deeper modules over many shallow ones.
- Server state via TanStack Query. Don't mirror it into local state.
- Every async UI has all five states: default, loading, empty, error, success. No happy-path-only screens.
- Keep Node-only code out of the wizard bundle: the wizard imports single modules from `@qa/types/src/...`.
- Run `pnpm build` after touching types or exported APIs (typecheck happens in build).
- Respect domain glossary in `CONTEXT.md` (Check-up, Plan, Plan Item, Plan Review) and avoid listed anti-terms.

**Supabase**

- RLS on for every table, no exceptions. New table = policies in the same migration. Test policies as an `anon` and as a normal `authenticated` user, not just as service role.
- Service-role key never reaches the client, logs, or a `NEXT_PUBLIC_*` var.
- Schema changes only via migration files. Never edit prod by hand.
- Edge functions: validate input, authenticate the caller, return typed errors, make webhooks idempotent (store the event ID).
- Index every foreign key and every column you filter or sort on.

**Next.js / Tailwind**

- Default to Server Components. `"use client"` only where interactivity needs it.
- Design tokens (color, type, spacing, radius) come from `DESIGN.md` if present. No ad-hoc hex or magic numbers.
- Restrained palette, clear type hierarchy, identical things look identical. Works in light and dark.

**Secrets and data**

- No secrets in code, commits, logs or prompts. `.env.example` lists names only.
- Log events and IDs, not personal data.
- Generated output (`.qa-*`, `.tmp-*`, `.benchmark/`, `/public`) must not be committed or edited by hand (`.qa-baselines/` committed intentionally).

## 8. India-specific guardrails

- Money: integer paise, never floats. Show ₹ with Indian grouping (₹1,23,456.00). Say whether prices include GST.
- Personal data (names, phone, email, Aadhaar-like IDs, health, employee records): collect the minimum, say why, allow deletion. Never store Aadhaar numbers or card data unless explicitly required and designed for it.
- Phone/OTP flows: +91 default, DLT-registered templates for SMS, rate-limit OTP sends and verifies.
- HR features: payroll, PF/ESI, TDS and leave rules are statutory and change. Mark any compliance logic with `// COMPLIANCE:` and link its source. Don't invent rates or thresholds.

## 9. UI copy

- Cut taglines, helper text and secondary labels. If a screen needs them to make sense, fix the layout.
- When trade-offs conflict, weigh UX (users), DX (next developer) and AX (next agent).
- Placeholder data looks real (Indian names, ₹ amounts), never "Lorem ipsum" or "John Doe".

## 10. Writing and reporting

- Prose rules (docs, PRs, commit messages, reports; never code or technical terms): use short words, cut every word you can, active voice, no cliché metaphors, no jargon where plain English survives. Break a rule before writing something awkward.
- Reports lead with what you need from me, numbered, at the very top. Then results.
- Final report: 2-3 lines. What you did, what you gave up, why. Plain words, no victory lap.
- Long unattended runs: end with a decisions list, one screen, those I should confirm marked clearly. A "success" summary alone hides the choices that matter.
- README says what it is and who it's for first. History belongs in `CHANGELOG.md`.

## 11. Repeat mistakes become mechanisms

- When I correct you, add a line under Lessons: "When X, do Y". Same mistake twice means the lesson is unclear: rewrite it.
- If a mistake is mechanical (wrong helper, banned pattern), encode it as a helper plus a lint rule whose error names the right helper. Rules in prose are the last resort.
- Ask before editing anything above Lessons.

## 12. Skills and tools

- Before starting, check installed skills/plugins and use the best fit. Say in one line which and why. Don't wait to be told by name.
- Before installing any third-party skill or plugin: check the source, read its code for network/shell/file access, question every permission. If unsure, don't install.
- Prefer a clickable/visual artifact (HTML page, diagram) over a wall of text when explaining architecture, audits or long-run status.

## Lessons

<!-- Newest on top. Format: "When X, do Y". Delete what no longer applies. Keep this file under ~200 lines total. -->
