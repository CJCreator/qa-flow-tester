# QA Flow Tester (Release check-up)

Open-source, self-hosted tool that scans a web app, writes a reviewable Plan, runs it with Playwright and
deterministic checkers, and produces a pre-release report. pnpm monorepo, TypeScript, Node 22, vitest.

## Read first

- `CONTEXT.md` is the domain glossary. Use its terms exactly (Check-up, Plan, Plan Item, Plan Review,
  Navigation Check, Layout Group...). Respect each term's "_Avoid_" list, especially in UI text.
- `docs/adr/` holds architecture decisions. Read the relevant ADR before changing behavior, and add a
  new one for a significant decision.
- Active plans: `docs/E2E_PLATFORM_IMPLEMENTATION_PLAN.md`, `URL_FIRST_IMPLEMENTATION_PLAN.md`,
  `UX_IMPLEMENTATION_PLAN.md`.

## Layout

`packages/`: `types` (shared types, verdict, plan types), `checkers` (axe, security, SEO/AEO/GEO, performance,
design, marketing, bug detection...), `core` (orchestrator, discovery, planning, AI providers, scoring,
reports), `runner` (HTTP + SSE server, serves the wizard, port 3001; also `checkup.ts` for CI), `wizard`
(Vite + React UI). `fixtures/test-app` is the built-in app to test against.

## Commands

- `pnpm bootstrap`: install, Playwright Chromium, build everything (first run)
- `pnpm start`: the whole app on http://localhost:3001; `pnpm dev:wizard`: wizard with hot reload
- `pnpm fixture`: start the fixture test app
- `pnpm build`: build all packages. Build order matters: types, then checkers/core, then runner
- `pnpm test`: all vitest tests. Slow browser test `wizard-e2e.test.ts` needs Chromium: run it before a release
- `pnpm test:url-first`: the focused URL-first suite; `pnpm smoke`: smoke run
- Run a single test: `pnpm exec vitest run path/to/file.test.ts`

## More docs

`docs/README.md` indexes everything. Start with `docs/ARCHITECTURE.md`; also `docs/TESTING.md`,
`docs/CONFIGURATION.md`, `docs/API.md`, `docs/DEPLOYMENT.md`, `SECURITY.md`, `CONTRIBUTING.md`.
Slash commands in `.claude/commands/`: `/check`, `/adr`, `/pr-ready`.

## Agents and /ship

`.claude/agents/` holds four subagents: `prompt-enhancer` (rough request to codebase-grounded brief), `planner`
(brief to plan), `developer` (plan to code), `tester` (independent verification, never edits source).
`/ship <request>` runs them in order and hands work over through `.claude/work/<slug>/` files. The plan needs
my approval before any code is written. Use `/ship resume <slug>` to continue. Subagents cannot spawn subagents, so
the main session orchestrates. Batch mode: `/ship plan`, `/ship approve <slug>`, then `node scripts/ship-loop.mjs`
(see `docs/AGENT_WORKFLOW.md`).

## Deferred tests

While `.claude/work/DEFER_TESTS` exists, do not run any tests (a hook blocks them). Write the tests, review by reading, builds are fine.
Tickets end `built`. Only `/verify-all`, after every ticket is built, runs tests. Delete the file to turn this off.

## Output style

Terse. Fragments fine. No filler or recaps. Exact code, paths, commands, errors. Full sentences for safety warnings,
destructive actions and questions to me. Never dump whole logs: grep or tail the failing part.

## Working rules

- Run the relevant tests after every change; run `pnpm build` after touching types or exported APIs
  (the type-check happens in the build).
- Keep Node-only code out of the wizard bundle: the wizard imports single modules from `@qa/types/src/...`.
- Never read, print, or commit `.env`, `.qa-keys.json`, `.qa-ai-models.json` or API keys. Use `.env.example`
  for names of variables. Do not paste keys into commands (they get saved into permission rules).
- `.qa-*`, `.tmp-*`, `.benchmark/`, `/public` are generated output: do not edit or commit them
  (approved `.qa-baselines/` are committed on purpose).
- Deploys: pushing to `main` runs `.github/workflows/deploy.yml` (tests, then Vercel and Render). Work on
  a branch and open a PR; do not push to `main` directly.
- Use a git worktree (`.claude/worktrees/`) for parallel work.
