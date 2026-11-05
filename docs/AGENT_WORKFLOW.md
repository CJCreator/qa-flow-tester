# Agent workflow

A local pipeline that turns a request into reviewed code with Claude Code subagents. The `.claude/` folder is local only: git-ignored, not part of a clone. Everything below needs your own `.claude/` (agents, commands, `work/`) and the `claude` CLI on PATH. `scripts/ship-loop.mjs` is the only part that is committed.

## Pipeline

`/ship <request>` runs the subagents in `.claude/agents/` in order and hands work over through `.claude/work/<slug>/`:

| Stage | Agent             | Output                                         |
| ----- | ----------------- | ---------------------------------------------- |
| 1     | `prompt-enhancer` | `01-brief.md`                                  |
| 2     | `planner`         | `02-plan.md`                                   |
| gate  | you               | approve, change or cancel                      |
| 3     | `developer`       | `03-dev-notes.md`                              |
| 4     | `tester`          | `04-test-report.md` (PASS or FAIL)             |
| loop  | developer, tester | at most 3 rounds; stops if failures repeat     |

Subagents cannot spawn subagents, so the main session orchestrates. `/ship resume <slug>` continues a run; `/build-next [slug]` builds one item in the current session.

## Batch loop

1. `/ship plan <request>` for each item. Each lands in `.claude/work/backlog.md` as `planned`.
2. Read the plans, then `/ship approve <slug>` (or set the status to `approved` in the file).
3. `node scripts/ship-loop.mjs --budget 3 --total-budget 15 --max-iterations 5`
4. Review with `git diff`, then `/pr-ready`. The loop never commits or pushes.

Each item runs in a fresh headless session (`claude -p`, `acceptEdits`, prompts off, so anything outside the allow rules is denied). The procedure is `.claude/commands/build-next.md`, sent on stdin; `.claude/terse-rules.txt` is appended to every subagent.

Flags (`scripts/ship-loop.mjs`):

| Flag               | Default | Meaning                                                                         |
| ------------------ | ------- | ------------------------------------------------------------------------------- |
| `--max-iterations` | 5       | Most items to try                                                               |
| `--budget`         | 3       | USD cap per item                                                                |
| `--total-budget`   | 15      | USD cap for the run; counts each item at its cap and stops before exceeding it |
| `--verify-at-end`  | off     | When nothing is left to build, run `.claude/commands/verify-all.md`             |
| `--verify-budget`  | 8       | USD cap for that verification run                                               |
| `--dry-run`        | off     | Print the command, run nothing                                                  |

The loop counts items whose backlog row says `approved`. It stops on `QUEUE_EMPTY`, on a non-zero `claude` exit, or at a cap. Headless runs cannot ask questions: an item needing a decision ends `blocked` with the question recorded.

## Tickets

`docs/tickets/INDEX.md` is the committed tracker; `.claude/work/backlog.md` is local scratch and INDEX wins on disagreement. Status: todo, planned, approved, built, done, or blocked. New code TODOs are `TODO(T-nn)` (see `CONTRIBUTING.md`).

## Deferred tests

`CLAUDE.md` describes a `.claude/work/DEFER_TESTS` mode: tickets end `built` and only `/verify-all` runs tests. Nothing in a clone enforces it, and the hook `CLAUDE.md` refers to (`.claude/hooks/defer-tests.mjs`) is not present in the current `.claude/`, so a test run is not blocked. Do not rely on it until the hook exists.

## Limits

- Agent rules (the tester edits no source, the developer does not commit) are written instructions, not locks.
- A dirty working tree is normal; two items touching one file can collide, so approve related items together or one at a time.
- Windows: the script quotes arguments for `claude.cmd`. Run it from a terminal where `claude --version` works.
- `--max-budget-usd` uses Claude Code's own cost estimate; check your real usage page.
