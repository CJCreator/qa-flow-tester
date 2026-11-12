# repo-orchestrator

A Claude Code plugin that runs an engineering task in the order a careful senior engineer would:
research the repository, understand the request, plan only the work that is needed, implement in
parallel with file ownership, check readiness without running tests, run tests once at the end, and
fix failures by root cause.

## Install

From the repository's marketplace (this repo ships `.claude-plugin/marketplace.json`):

```
/plugin marketplace add CJCreator/qa-flow-tester
/plugin install repo-orchestrator --marketplace CJCreator/qa-flow-tester
```

For local development, load the folder straight from a checkout:

```
claude --plugin-dir ./plugins/repo-orchestrator
```

## What installing adds

The plugin registers one hook, `hooks/guard-test-runs.mjs`. It is Node code that Claude Code runs before every Bash call in every session where the plugin is enabled, with your user's rights, not only during an orchestrator run. It reads the command text and the file `.claude/orchestrator/phase` in the project, writes nothing, and uses no network. Read it before you install (it is 77 lines). It is a workflow guard, not a sandbox: it only stops common test commands during the implementation and readiness phases, a determined or unusual command gets through, and it fails open (allows the call) on malformed input or a missing phase file. Do not use it as a security control.

## Use

Invoke the orchestrator explicitly. It is not auto-triggered, because a full run dispatches several agents:

```
/repo-orchestrator:orchestrate Add CSV export to the Check-up report page
/repo-orchestrator:orchestrate PROJ-142
/repo-orchestrator:orchestrate https://tracker.example.com/browse/PROJ-142
/repo-orchestrator:orchestrate Review the auth middleware for permission bypasses (review only)
/repo-orchestrator:orchestrate Make a plan for moving sessions to Redis, do not edit anything (plan only)
/repo-orchestrator:orchestrate Run the verification for the current changes (test only)
```

Ticket IDs and URLs are used only if a ticket integration is connected to the session. Otherwise the
orchestrator uses the text you give it and says that it did.

## What a run does

| Stage        | What happens                                                                            | Tests allowed       |
| ------------ | --------------------------------------------------------------------------------------- | ------------------- |
| 0 Preflight  | git status, branch, project instructions, verification commands recorded                | no                  |
| 1 Classify   | picks quick, standard, full, plan-only, review-only, or test-only                       | no                  |
| 2 Research   | up to three read-only `repo-researcher` agents, one area each                           | no                  |
| 3 Understand | spec with explicit and inferred items, acceptance criteria                              | no                  |
| 4 Plan       | task graph, shared contracts first, one owner per file                                  | no                  |
| 5 Implement  | `implementer` agents on disjoint files; they never run tests                            | **blocked by hook** |
| 6 Readiness  | static review of the diff; `security-reviewer` when auth, input, secrets or data change | **blocked by hook** |
| 7 Verify     | scoped test run, once, at the end                                                       | yes                 |
| 8 Remediate  | `failure-remediator` per root-cause group; reruns only affected tests                   | yes                 |
| 9 Report     | status: Verified, Partially verified, Incomplete, or Blocked                            | —                   |

## Components

```
plugins/repo-orchestrator/
├── .claude-plugin/plugin.json       manifest
├── skills/orchestrate/
│   ├── SKILL.md                     entry point and stage order
│   └── references/
│       ├── research-and-planning.md repo map, task spec, classes, ownership, tickets
│       └── delivery-gates.md        readiness gate, testing policy, remediation, report template
├── agents/
│   ├── repo-researcher.md           read-only, haiku, one area
│   ├── implementer.md               edits owned files, no tests
│   ├── security-reviewer.md         read-only security and data-integrity review
│   └── failure-remediator.md        fixes one root-cause group, targeted reruns
├── hooks/
│   ├── hooks.json                   PreToolUse on Bash
│   └── guard-test-runs.mjs          blocks test runners in implementation and readiness phases
├── scripts/validate.mjs             structure checks for the plugin and marketplace
└── test/guard-test-runs.test.mjs    hook tests
```

## Phase guard

The orchestrator writes its current stage to `.claude/orchestrator/phase` in the project. The
`guard-test-runs` hook reads it before each Bash call:

| Phase file content              | Test runners                       |
| ------------------------------- | ---------------------------------- |
| file missing                    | allowed (no run active)            |
| `implementation` or `readiness` | blocked, exit code 2 with a reason |
| `verification`                  | allowed                            |

The hook matches common runners: `pnpm|npm|yarn|bun test`, `vitest`, `jest`, `playwright test`,
`cypress run`, `pytest`, `go test`, `cargo test`, `node --test`. It is a workflow guard, not a sandbox.
It fails open on malformed input so it never breaks a session.

To stop a run without finishing it, delete `.claude/orchestrator/phase`.

Keep `.claude/` out of commits. The qa-flow-tester `.gitignore` already covers it.

## Validation

```
pnpm test:plugin                               # structure checks + hook tests
claude plugin validate plugins/repo-orchestrator
claude plugin validate .                       # marketplace manifest
```

## Architecture

- **One entry point.** The skill holds the stage order and hard rules. Detail that does not change
  per run lives in two reference files, so the skill stays short.
- **Specialists are narrow.** Each agent has the fewest tools its job needs. Researchers and the security
  reviewer are read-only by instruction, not by enforcement: their `Bash` access is not restricted, so
  they are trusted not to write. Only implementers and remediators are meant to edit.
- **Ownership before parallelism.** The plan assigns one owner per file. Overlapping files serialize.
  Shared contracts go first.
- **End-only testing is enforced, not just requested.** The instruction says so, and the hook blocks
  test runners until the verification phase.
- **Failures are grouped.** Remediation works on root causes. A rerun covers only what the fix can affect.
- **Checkpoints are local.** `.claude/orchestrator/checkpoint.md` holds requirements, decisions, the
  task graph, status, and next actions. It contains no secrets.

## Limitations

- Ticket access depends on a connected integration. The plugin does not assume one exists.
- Model choice is set per agent in its frontmatter (`haiku` for the researcher, inherited otherwise).
  The plugin cannot control the session's model or report token usage.
- Subagents cannot spawn subagents. The main session dispatches all agents.
- Parallelism means several Agent calls in one message. Fan-out is bounded by what the platform allows.
- The guard matches command text. A test runner invoked through an unrecognized wrapper is not caught.
  The instruction and the phase checks still apply.

## Troubleshooting

- **A test command is blocked during implementation.** That is the guard working. Finish the stage, or
  remove `.claude/orchestrator/phase` to stop the run.
- **The skill does not appear.** Run `/plugin` and check that `repo-orchestrator` is enabled. Confirm with
  `claude plugin validate plugins/repo-orchestrator`.
- **`pnpm test:plugin` fails on the validator.** The message names the file and the rule. Fix that file.
- **A run stopped at verification with no output.** Check that the scoped test command exists in the
  repo's `package.json`. The orchestrator records the command it used in the report.
