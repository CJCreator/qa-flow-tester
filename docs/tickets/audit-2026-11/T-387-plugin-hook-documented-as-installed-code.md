# T-387: The plugin README says its hook is code that runs on every Bash call

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P4 | S | docs | gap | todo |

**Files you may edit (no others):**

- `plugins/repo-orchestrator/README.md`

**Do not build in parallel with:** none.

## Problem

Installing the `repo-orchestrator` plugin adds a hook that Claude Code runs before every Bash tool call: `plugins/repo-orchestrator/hooks/hooks.json` registers `node "${CLAUDE_PLUGIN_ROOT}/hooks/guard-test-runs.mjs"` as a `PreToolUse` command with the matcher `Bash`. That is program code running on the installer's computer, on every shell command a session makes, with the installer's rights. The README presents it only as a convenience ("Phase guard"). A person reading the Install section (`README.md:9-14`) is not told that adding the plugin also adds this running code.

The README already says some of the right things in the Phase guard section: "It is a workflow guard, not a sandbox. It fails open on malformed input so it never breaks a session" (`README.md:~85-87`), and the Limitations section says the guard matches command text only. What is missing is the plain statement that it is code, that it runs on every Bash call, and what it reads. This is a gap, not a wrong statement.

## Current code

Branch from `main`. `grep -n "hook\|Phase guard\|sandbox" plugins/repo-orchestrator/README.md`.

`plugins/repo-orchestrator/hooks/hooks.json`:

```json
"PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/guard-test-runs.mjs\"" }] }]
```

`plugins/repo-orchestrator/hooks/guard-test-runs.mjs` (header): "This is a workflow guard, not a sandbox: it matches common test runners and fails open on malformed input." It reads `<project>/.claude/orchestrator/phase` and the Bash command text, and imports only `node:fs`, `node:path` and `node:url`.

## Change

1. Before pushing on, read `plugins/repo-orchestrator/hooks/guard-test-runs.mjs` to the end and confirm each claim below. If the file does more than the claims say (network, writes, other imports), write what it really does instead and say so in the report.
2. `README.md`: right after the Install section (before "Use"), add a short section:

```markdown
## What installing adds

The plugin registers one hook, `hooks/guard-test-runs.mjs`. It is Node code that Claude Code runs before every Bash call in every session where the plugin is enabled, with your user's rights, not only during an orchestrator run. It reads the command text and the file `.claude/orchestrator/phase` in the project, writes nothing, and uses no network. Read it before you install (it is 77 lines). It is a workflow guard, not a sandbox: it only stops common test commands during the implementation and readiness phases, a determined or unusual command gets through, and it fails open (allows the call) on malformed input or a missing phase file. Do not use it as a security control.
```

   Checked 11 Nov 2026: the file is 77 lines, reads stdin and the phase file, writes nothing and uses no network. Recheck the count with `wc -l`.
3. Leave the Phase guard section as it is; do not duplicate the table.
4. Run `pnpm exec prettier --check plugins/repo-orchestrator/README.md` and `node plugins/repo-orchestrator/scripts/validate.mjs`.

## Tests

None. Wording only. `pnpm exec prettier --check plugins/repo-orchestrator/README.md`; `node plugins/repo-orchestrator/scripts/validate.mjs` still exits 0.

## Done when

- [ ] `grep -n "What installing adds" plugins/repo-orchestrator/README.md` finds the section, placed before "## Use".
- [ ] The section says: code, every Bash call, not a sandbox, fails open.
- [ ] The validator and prettier pass.

## Notes

- Audit finding L4 (audit of 11 Nov 2026 on `d225418`).
- The brief for this ticket asked for "not a sandbox" and "fails open" to be added. Both are already in the Phase guard section; the new section repeats them in one place on purpose, next to the install steps, where a person decides.
- The hook code itself is not changed here. The same plugin's agents (researcher, security reviewer) are read-only by instruction only; the Architecture section already says so.
