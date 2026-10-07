# Security

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting on the repository
(Security tab, "Report a vulnerability"). Include steps to reproduce and the version or commit. Expect an
acknowledgement within a few days. (Owner: add a contact email here if you want one.)

## What the tool is allowed to do (the safety model)

The tool drives real browsers against real sites, so safety is enforced in code, not by trusting the AI.

- **The AI plans; it never acts.** It writes Plan Items from facts the crawler collected. It does not drive the browser and does not decide pass or fail (ADR 0001, 0009).
- **Deterministic safety filters.** Destructive or side-effecting actions (deletes, payments, outbound notifications) are skipped by keyword and pattern rules and queued as questions for a person (`core/discovery/safety-filter.ts`, ADR 0003).
- **Read-only by default.** Unless an address is marked a test copy (`QA_STAGING=true`, or the staging switch in the UI), it is checked read-only: no sign-in, no form submitted, no mutating request (`core/safe-scan.ts`). Previews and staging are test copies; production is not.
- **Stay on the host.** Runs are confined to the target host and its allow-listed hosts; robots.txt is honored for public sites; page delays are kept polite.
- **Nothing runs that is not in the Plan.** The person approves the full Plan first (ADR 0009).

## The server

- Binds to `localhost` and rejects requests whose `Host` header is not a loopback name (ADR 0008).
- Cross-origin browser requests are refused unless `RUNNER_ALLOWED_ORIGINS` lists them, so a web page you visit cannot start runs.
- Sharing the server over a tunnel or proxy **requires** `RUNNER_ACCESS_TOKEN` (the runner prints a warning without it). A tunnel presents a localhost Host header, so the loopback check alone cannot protect it. `pnpm tunnel` sets a token for you.
- Beta mode (`RUNNER_BETA=1`): only public sites; private and internal addresses are refused; each tester's AI key and sign-ins are held in memory for 24 hours at most (max 50 sessions) and never written to disk; state-changing routes are closed.

## Secrets

- A saved AI key goes to the OS keychain. Only if no keychain exists is it written to `.qa-keys.json` (file mode 600, git-ignored).
- Keys and sign-in values are removed from events, reports and logs by `core/redact.ts` before output. Add a test when you add a new secret-bearing field.
- `.env`, `.qa-keys.json`, `.qa-ai-models.json` and `.qa-plan.json` are git-ignored. Never commit them, never paste keys into commands or chat (Claude Code saves approved commands into its permission rules, which is how a key once ended up in `.claude/settings.json`).
- In CI the key is a repository secret (`QA_AI_API_KEY`), never a workflow input.
- If a key is exposed, rotate it at the provider first, then clean up.

## Rules for contributors

1. A change that loosens a safety filter, the read-only default, the host check, or redaction needs an ADR and a test.
2. New endpoints must work with the access token and be reviewed for beta mode (see `docs/API.md`).
3. Do not log request bodies from the AI settings routes.
4. Keep dependencies lean; review new ones for install scripts (`pnpm-workspace.yaml` controls which packages may run build scripts).

## Not in scope yet

Security probes against third-party sites need verified domain ownership first (referenced as ADR 0014, not yet written).
