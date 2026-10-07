# Agent workflow and token budget

How to turn a rough idea into tested code with the project's agents, as a loop, without burning tokens.

## The pipeline

| Stage | Agent                 | Model / effort | Output (`.claude/work/<slug>/`)                           |
| ----- | --------------------- | -------------- | --------------------------------------------------------- |
| 1     | `prompt-enhancer`     | sonnet, low    | `01-brief.md`                                             |
| 2     | `planner`             | sonnet, high   | `02-plan.md`                                              |
| gate  | you                   |                | approve / change / cancel                                 |
| 3     | `developer`           | sonnet, medium | `03-dev-notes.md`                                         |
| 4     | `tester`              | sonnet, medium | `04-test-report.md` (PASS/FAIL, failure ids F1...)        |
| loop  | developer then tester |                | at most 3 rounds, stops early if the same failures repeat |

Each agent has a `maxTurns` cap. For an architecture-level change, re-run the planner on Opus (`model: opus` in `.claude/agents/planner.md`, or ask for it per call).

## Two ways to run it

**Interactive (one item, you watching):** `/ship <request>`. It plans, waits for your approval, then builds and tests.

**Batch loop (several items, fresh context each time, cheapest):**

1. Plan as many items as you like: `/ship plan <request>`. Each lands in `.claude/work/backlog.md` as `planned` (local, git-ignored; see Tickets).
2. Read the plans, then approve: `/ship approve <slug>` (or change `planned` to `approved` in the file).
3. Build them all: `node scripts/ship-loop.mjs --budget 3 --total-budget 15 --max-iterations 5`.
   Each item runs in its own headless session (`claude -p`), so context never piles up, and spend is capped per item and in total.
   Items end as `done` or `blocked` with the reason. Nothing is committed.
4. Review: `git diff`, then `/pr-ready`.

`/build-next [slug]` does one item in your current session.

Why not the built-in `/loop`? `/loop` re-runs a prompt inside one session, and every iteration carries the whole conversation. Good for polling CI;
wasteful for building. The script starts clean each time. (The script puts the procedure on stdin, uses `acceptEdits` with prompts turned off, so anything not
in the allow rules is denied rather than hanging.)

## Tickets

Ticket files live in `docs/tickets/T-nn-*.md`; `docs/tickets/INDEX.md` is the tracker and the committed record. Update its status column when a ticket changes state. `.claude/work/backlog.md` is local scratch, git-ignored (`.claude/work/` in `.gitignore`); if the two disagree, INDEX wins. In code, new TODOs are `TODO(T-nn)` (see `CONTRIBUTING.md`).

Status: todo -> planned (`/ship plan`) -> approved (approve) -> built (build) -> done (`/verify-all`, which also closes gap rows; see Deferred verification). Or blocked.

## Deferred verification (tests only at the very end)

For a large program of tickets you can hold all test runs until every ticket is built. While `.claude/work/DEFER_TESTS` exists (first line `phase: build`):

- A `PreToolUse` hook (`.claude/hooks/defer-tests.mjs`, registered in `.claude/settings.json`) blocks any Bash command that runs tests: vitest, jest, `pnpm test`, `test:url-first`, `smoke`, `benchmark`, Playwright tests. Builds, type-checks and git commands still work. It applies to the main session, every subagent and the headless loop.
- Developers write the tests the plan names but do not run them. The tester does a static review (reads the diff and the tests; verdict `REVIEWED` or `FAIL`, never `PASS`).
- Tickets end as `built`, not `done`. `/pr-ready` and `/check` cannot run their test steps.
- `/verify-all` is the one test run: it refuses unless every ticket is built (or blocked, human, later), unlocks tests (`phase: verify`), runs build and the full suite once, fixes failures per ticket (max 3 rounds), then marks tickets `done` and closes gap rows. `node scripts/ship-loop.mjs --verify-at-end` can run it for you when the queue is empty.
- Turn it off by deleting the file.

Trade-off, so you choose knowingly: every bug waits until the end, failures from many tickets arrive together and are harder to attribute (the dev notes list each ticket's files to help), and a type error in an early ticket can sit unnoticed unless you keep building. The build step is still allowed on purpose. If you want even builds held, add `build` to the hook's pattern list.

## Where the tokens go, and what is done about it

| Lever                     | What is in place                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fewer big contexts        | Agents start fresh; hand-off is by files and paths, never pasted text. Batch loop starts a fresh session per item                                                                                     |
| Cheaper models and effort | Sonnet everywhere; low effort for the enhancer, medium for build and test, high only for planning                                                                                                     |
| Bounded work              | `maxTurns` per agent; `--budget` and `--total-budget` in the loop                                                                                                                                     |
| Less reading              | Agents Grep first and Read ranges. `.claude/settings.json` denies reading `node_modules`, `dist`, `pnpm-lock.yaml`, `.qa-*` output, `public/` and `.claude/worktrees/`                                |
| Less log noise            | Builds and tests write to log files; agents `grep`/`tail` for failures; vitest runs with `--reporter=dot`                                                                                             |
| Less output               | `.claude/terse-rules.txt` (appended to every subagent in the loop) and a "Style" block in each agent: terse, fragments, exact code and errors, full sentences only for safety and destructive actions |
| Stop wasted rounds        | Failure ids per round; identical failures twice means stop and hand to a human                                                                                                                        |
| Small always-on context   | `CLAUDE.md` stays short; workflows live in commands and docs, loaded only when used                                                                                                                   |

### Caveman (optional, for your own chat)

[Caveman](https://github.com/JuliusBrussee/caveman) is a third-party skill that makes Claude's replies terse. Per its README: install with `npx skills add JuliusBrussee/caveman`,
toggle with `/caveman lite|full|ultra|off`; code, paths and errors stay intact. Know the limits before relying on it:

- It shortens **output** only. Input and reasoning tokens are unchanged; its own rules add roughly 1 to 1.5k input tokens a turn, so whole-session savings are less than the headline figure. Your claim check: `/usage` before and after.
- It does nothing for the agents' file reads or logs, which is where most tokens go. The levers above matter more.
- Review a third-party skill's files before installing it; it runs inside your sessions. It was not installed or audited here.
- Use `lite` or `full` while building; switch it `off` when you need careful explanations, security reasoning, or a plan you must understand.

The project already carries the same idea (the Style blocks and `terse-rules.txt`) without an extra skill, so you may not need it.

### Habits that save the most

- `/clear` between unrelated tasks; `/compact` with a focus when a session runs long. Check with `/usage` and `/context`.
- Disable MCP servers you are not using (`/mcp`). Prefer CLI tools (`gh`) over MCP.
- Specific requests: name the file or behavior. Use plan mode before big changes.
- Keep the planner's output short; the brief and plan are re-read by two later agents.

## Limits to know

- The built-in agents' rules (no source edits by the tester, no commits by the developer) are written instructions, not hard locks. For a hard lock, add hooks.
- A dirty working tree is normal here; `baseline.txt` records what was modified before each item, and dev notes list the files touched. Two items touching the same file can still collide, so approve related items together or one after another.
- Windows: the script quotes arguments for `claude.cmd`. If `claude` is not on PATH for Node, run it from a terminal where `claude --version` works.
- Headless runs cannot ask you anything. Anything needing a decision becomes `blocked` with the question recorded.
- Costs are estimates (`--max-budget-usd` uses Claude Code's own estimate); check your real usage page.
