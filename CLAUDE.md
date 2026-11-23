# CLAUDE.md

@AGENTS.md

Everything shared lives in AGENTS.md. This file holds only what is specific to Claude Code. Don't duplicate rules from there.

## Models and effort

- Main session: strongest available model on high effort, for planning and hard judgment only.
- Subagents default to a mid-tier model on medium effort. Reading, file search, doc lookup and running tests go to the smallest model. Never edit with the smallest model.
- Don't hard-code model IDs in prompts, skills or scripts. Refer to roles (planner, builder, finder) and set models in config.
- Builder on low effort, verifier on high effort: every feature goes through both. High effort mostly buys verification, so spend it there.
- Consult the advisor/stronger model at three moments only: before committing to a big plan, when the same error appears a second time, and before calling a long task done.
- Don't add "think carefully", "think step by step" or forced-confirmation lines to prompts. Current models already think. Rules like that waste tokens.

## Subagent roster (`.claude/agents/`)

| Role     | Job                                                                     | Edits files?               |
| -------- | ----------------------------------------------------------------------- | -------------------------- |
| finder   | Locate files, symbols, callers. Run tests. Return paths and 5 lines max | No                         |
| builder  | Implement one scoped change from a brief                                | Yes, only its listed files |
| reviewer | Review the current diff against the plan. Report only                   | No                         |
| verifier | Run the app/tests, try to break it, report evidence                     | No                         |

Brief format for every subagent: goal, inputs (paths), output format, done-criteria. Nothing else, to keep its context small.

## Context and cost hygiene

- Keep this file and AGENTS.md lean. Past ~200 lines, rules get followed less. Prune before adding.
- Don't read whole files when a symbol lookup works. Don't re-read what is already in context.
- Use `/clear` between unrelated tasks. Use `/compact` with a focus note on long ones.
- Long or overnight runs: at most 3 attempts per step, then log the error to `HANDOFF.md` and move to the next independent step. A stuck step must not eat the night.
- Build a status HTML (progress, blockers, open questions) via a side subagent for any task over ~30 minutes.

## Permissions (see `.claude/settings.json`)

- Deny: reading `.env*`, `rm -rf`, force-push, `git reset --hard`, `supabase db reset` against anything non-local, `DROP`/`TRUNCATE` via CLI.
- Ask: `git push`, dependency installs, migrations, anything touching production.
- Allow: read-only git, lint, typecheck, tests, dev server.
- Deny always wins. Never work around a denied command by another route.

## Preview and review

- Run the dev server and give me a link I can open on my phone. If it only works on localhost, say so and offer a tunnel.
- UI changes: screenshot before and after at desktop and 360px, then compare.
- Code reviews: score each finding for how likely it is to occur. Low-score items go to a list as issues, and the code stays untouched. Only fix findings that would realistically happen.

## Pre-launch passes (run only when I say "pre-launch")

Fan out in parallel, then merge into one fix pass:

1. **Page**: consistent design vs DESIGN.md, mobile, all UI states, real user flows
2. **Backend**: keys, auth, RLS, rate limits and billing abuse, payment webhooks, monitoring
3. **Break-it**: try to break the app via security, data integrity, flows and environment; rank by severity
4. **Speed**: images, fonts, bundle, queries, API latency; re-measure after
5. **Legal (India)**: DPDP Act consent and notice, minors, third-party trackers and session replay, marketing messages (TRAI/DLT), refund and renewal terms, DMCA-style takedown path
   Report: what was fixed, what needs me, listed last. Flag legal and compliance items for a real lawyer; you are not one.

## Install check

Do not install skills, plugins or MCP servers without my yes. Before asking, state the source, the permissions it wants, and what it can reach.

## Project specifics (QA Flow Tester)

- Deploys: pushing to `main` runs `.github/workflows/deploy.yml` (tests, then Google Cloud Run: the runner and the static site). Work on a branch and open a PR; never push to `main` directly.
- Deferred tests: while `.claude/work/DEFER_TESTS` exists, do not run any tests. Write them, review by reading, builds are fine. Tickets end `built`. Only the verification phase, after every ticket is built, runs tests. Delete the file to turn this off. Nothing enforces this in a clone; follow it by hand.
- `.claude/` is local only (git-ignored). Agents, settings and work files live there, not in a clone. See `docs/AGENT_WORKFLOW.md`.
