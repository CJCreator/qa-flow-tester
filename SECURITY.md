# Security

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting on the repository
(Security tab, "Report a vulnerability"). Include steps to reproduce and the version or commit. Expect an
acknowledgement within a few days. (Owner: add a contact email here if you want one.)

## What the tool is allowed to do (the safety model)

The tool drives real browsers against real sites, so safety is enforced in code, not by trusting the AI.

- **The AI plans; it never acts.** It writes Plan Items from facts the crawler collected. It does not drive the browser and does not decide pass or fail (ADR 0001, 0009).
- **Deterministic safety filters.** Destructive or side-effecting actions (deletes, payments, outbound notifications) are skipped by keyword and pattern rules and queued as questions for a person (`core/discovery/safety-filter.ts`, ADR 0003).
- **Read-only by default.** Unless an address is marked a test copy (`QA_STAGING=true`, or the staging switch in the UI), it is checked read-only: no sign-in, no form submitted, no mutating request (`core/safe-scan.ts`). Previews and staging are test copies; production is not. On a shared machine (beta mode) a test copy also needs a Verified Domain (below).
- **Stay on the host.** Runs are confined to the target host and its allow-listed hosts; robots.txt is honored for public sites; page delays are kept polite.
- **Nothing runs that is not in the Plan.** The person approves the full Plan first (ADR 0009).

## The server

- Binds to `localhost` and rejects requests whose `Host` header is not a loopback name (ADR 0008).
- Cross-origin browser requests are refused unless `RUNNER_ALLOWED_ORIGINS` lists them, so a web page you visit cannot start runs.
- Sharing the server over a tunnel or proxy **requires** `RUNNER_ACCESS_TOKEN` (the runner prints a warning without it). A tunnel presents a localhost Host header, so the loopback check alone cannot protect it. `pnpm tunnel` sets a token for you.
- Beta mode (`RUNNER_BETA=1`): only public sites; private and internal addresses are refused, including a name that resolves to one, a redirect to one, and a name that changes its answer between two lookups (every address is classified, the connection goes to the checked address, every redirect hop is checked again, and a DNS failure counts as refused); in the browser every request is checked the same way; each tester's AI key and sign-ins are held in memory for 24 hours at most (max 50 sessions) and never written to disk; state-changing routes are closed; check-ups and comparisons are limited per visitor session and per UTC day (in memory).

## Secrets

- A saved AI key goes to the OS keychain. Only if no keychain exists is it written to `.qa-keys.json` (file mode 600, git-ignored).
- Role sign-in values (not AI keys) are removed from events, reports and logs by `core/redact.ts` before output. Add a test when you add a new secret-bearing field. See ADR 0016 for what is covered and what is not.
- `.env`, `.qa-keys.json`, `.qa-ai-models.json` and `.qa-plan.json` are git-ignored. Never commit them, never paste keys into commands or chat (Claude Code saves approved commands into its permission rules, which is how a key once ended up in `.claude/settings.json`).
- In CI the key is a repository secret (`QA_AI_API_KEY`), never a workflow input.
- If a key is exposed, rotate it at the provider first, then clean up.
- No AI key is stored in the repo, in `.claude/settings.json` or in any tracked file (checked 2026-10-09; the `sk-...` strings in `packages/*/tests` are fake test values). The owner enters an AI key in the wizard at test time; it is not kept in files or commands.
- Hosting credentials (Render and Vercel deploy details) live only in GitHub repository secrets, used by `.github/workflows/deploy.yml`. They are never in the repo, a workflow input, or a command. Rotate them in the provider console and update the GitHub secret; do not paste the value anywhere else.

## Saved sessions and docs URLs (ADR 0021)

- A saved session (cookies, local storage) sent with a run is held in the runner's memory only. It is never written to the plan file, logs, events, API responses or reports, and is dropped when the run ends or is aborted. It is limited to 256 KB and every cookie must belong to the target host. After a restart the person must send it again.
- A docs URL is read with the same host checks as the target (same site, robots.txt, public addresses only on a shared machine, redirects re-checked): at most 20 pages of text or Markdown, 1 MB each. A failure becomes a note, never an abort.
- `issues.html` is one self-contained file: no script, no external address, screenshots embedded from the report folder only, page text escaped.

## Headless sign-in (CI)

`QA_USERNAME` and `QA_PASSWORD` (optional `QA_LOGIN_PATH`) are read from the environment only: there is no command-line flag, so the password does not land in shell history or process lists. Setting both is the consent to sign in and test fully (ADR 0022). Use a test account on a test copy, and keep both in repository secrets. The check-up never prints them, never writes them to the job summary or report, and does not save the session.

## Verified Domains (shared machines)

On a shared machine (`RUNNER_BETA=1`) the tool only fills in and sends forms on a Test Copy that is marked by the owner, resolves only to public addresses, and passes a Verified Domain proof: the file `https://<exact address>/.well-known/qa-verify.txt` holds one line, `qa-verify=<token>`. The token is random per session and address, kept in memory, and the file is fetched again at the start of every run and when a waiting plan is approved. The proof needs https, follows no redirect, is capped at 4 KB, and the route never returns the fetched file (ADR 0014). A proof shows control of one address at one moment, not that the site is fine. Dev tunnel names, `localhost`, private ranges and the `x-test-copy` header do not make a Test Copy there. Residual: the browser resolves third-party hosts itself, so a name with a TTL of 0 that turns private on a host other than the target can slip through a short gap; those runs only send GET to non-test sites. Own computer and GitHub Actions use are unchanged.

## Rules for contributors

1. A change that loosens a safety filter, the read-only default, the host check, or redaction needs an ADR and a test.
2. New endpoints must work with the access token and be reviewed for beta mode (see `docs/API.md`).
3. Do not log request bodies from the AI settings routes.
4. Keep dependencies lean; review new ones for install scripts (`pnpm-workspace.yaml` controls which packages may run build scripts).

## Not in scope yet

Security probes against third-party sites inherit the Verified Domain rule (ADR 0014) but still need a legal review first. Hardening redirects in the robots.txt fetch (a blind GET whose answer is only parsed) is a logged follow-up.
