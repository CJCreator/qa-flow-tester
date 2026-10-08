# 0016: Redaction of Sign-in Details and Secrets in Everything a Check-up Keeps

Status: Accepted 2026-10-08 (records behaviour already shipped; no code change).

Builds on [0003](0003-deterministic-safety-filters-for-ai-discovery.md) (deterministic filters around AI discovery), [0012](0012-hosted-runner-github-actions.md) (shared online copy, sessions kept in memory) and [0014](0014-verified-domains-and-safe-host-classification.md) (Verified Domains; leaves redaction untouched). Wording follows [0018](0018-claim-wording.md).

## Context and Decision
A Check-up signs in with the role credentials from the Plan Review profile. Those values travel: into prompts sent to the AI, into progress events, into the Report, into evidence files, and into the saved Plan. A sign-in form can also put a password in the address (the test uses a GET form that sends `?email=..&password=..`). Anything written or sent along the way must not hold the value.

We decided that one class, `Redactor` in `packages/core/src/redact.ts`, hides these values, and that every path that writes to disk, streams an event or builds an AI prompt goes through it. This record describes what is built. It is a statement of behaviour, not a guarantee: redaction is text matching and cannot prove that nothing leaked.

### Shipped: what is hidden
All in `packages/core/src/redact.ts`. A hidden value becomes `REDACTED = '***'`.

- `redactUrl(text)`: in any text, the value of a URL parameter whose name is in `SECRET_PARAM_NAMES`. The list is defined in `packages/checkers/src/security.ts` (shared with the security checker): `pass`, `password`, `passwd`, `pwd`, `pin`, `otp`, `token`, `access_token`, `refresh_token`, `id_token`, `auth`, `secret`, `client_secret`, `api_key`, `apikey`, `key`, `session`, `sessionid`, `sid`, `ssn`, `cvv`, `card`. The match is case-insensitive, on the exact name, right after `?` or `&`. The value ends at `&`, `#`, whitespace, a quote, `<`, `>` or `)`. It needs no known credentials.
- `new Redactor(credentials)`: hides each password and token of 3 or more characters, and each username that contains `@`. For each value it also hides the `encodeURIComponent` form and the form with `+` for spaces. Duplicates are dropped and the longest value goes first, so a secret that contains another is hidden whole.
- `text(input)`: `redactUrl`, then the known values.
- `deep(value)`: a copy with every string at any depth passed through `text`. Numbers and booleans are untouched.
- `files(dir)`: walks a folder and rewrites in place every file ending `.html .htm .ts .js .json .md .txt .log`, only when the content changed. A missing folder is ignored.

### Shipped: where it is applied
| File | Lines | What goes through it |
| --- | --- | --- |
| `packages/core/src/orchestrator.ts` | 314-316 | Every event, via `deep`, before it is emitted. Built from the profile roles. |
| `packages/core/src/orchestrator.ts` | 1166-1167 | `files(evidenceDir)` over the evidence folder; the Report via `deep` before it is returned. |
| `packages/core/src/safe-scan.ts` | 39-40, 118, 141 | `new Redactor()` with no credentials, so URL parameters only: events, the Report, and `evidence/` files. |
| `packages/core/src/discovery/discovery-agent.ts` | 200, 262 | Redactor built from the profile roles; the landing address in log lines goes through `text`. |
| `packages/core/src/discovery/discovery-agent.ts` | 400, 437 | A `redact` callback handed to page planning and journey planning, which apply it to AI prompts (`packages/core/src/plan/ai-planner.ts:573`, `packages/core/src/plan/journeys.ts:125`). |
| `packages/core/src/discovery/discovery-agent.ts` | 495-496 | Credentials in steps become placeholders (`replaceCredentialsWithPlaceholders`), then `deep` runs over the draft before `discovery-draft.json` is written and returned. |
| `packages/core/src/discovery/deterministic-spider.ts` | 102, 211 | `redactUrl` on off-site link targets and on page paths with a query. |
| `packages/runner/src/server.ts` | 3389-3405 | `planForDisk`: the saved Plan goes through `deep`; usernames are blanked, passwords and tokens are not kept, only the AI provider and model are kept, and the roles whose sign-in was not saved are listed in `signInNotSaved`. |
| `packages/runner/src/server.ts` | 3618-3625 | `replanOptions`: a `redact` callback for AI re-planning (`packages/core/src/plan/replan.ts`). |

### Shipped: related, but not redaction
Plans hold `{{username}}` and `{{password}}` placeholders. The real values are filled in only when a step runs (`packages/core/src/credentials.ts`). This keeps values out of the Plan in the first place, so redaction is a second layer.

### Known limits
These are the behaviour today. None is a bug report; each closure is a change to redaction and needs its own ADR note and test.

- A password or token shorter than 3 characters is not hidden.
- A username without `@` is not hidden. This is chosen: a plain `admin` would blank ordinary words in a Report. Covered by the test "keeps plain usernames, which would blank out ordinary words".
- Only the exact names in `SECRET_PARAM_NAMES` are matched. `x-api-key` and `?apiKeyValue=` are not. A value in a `#fragment` (`#access_token=...`) is not, because the pattern needs `?` or `&` before the name.
- Only the literal, URL-encoded and `+` forms are hidden. Base64, HTML entities and other encodings are not.
- `deep` rewrites string values, not object keys.
- `files` skips every other extension. Screenshots and videos (`.png`, `.webm`) are not redacted, so a typed password visible on screen stays in the picture. [0019](0019-visual-diff-stabilising-and-masking.md) masks password fields in newly recorded visual baselines only, and adds old/new/difference images to the Report, which are not redacted.
- Browser sign-in state is written to `<outputDir>/auth/<role>.json` (`packages/core/src/preflight.ts`, around line 161). It is outside `evidence/`, is never passed through `files`, and holds live cookies. Treat the whole output folder as sensitive until this is closed.
- `Redactor` does not handle AI keys. They are kept off disk by other means: `planForDisk` keeps only provider and model, and the shared online copy keeps sessions in memory (see 0012).
- These limits are not covered by a test, nor are `safe-scan.ts`, `planForDisk` or the spider calls. Existing coverage is `packages/core/tests/redaction.test.ts`: "hides passwords, tokens and email usernames, as typed and as they appear in addresses", "hides secret-looking URL parameters even when the secret is unknown", "redacts every string inside nested data", "keeps sign-in details out of plans and fills them in only when a step runs", and "flags the GET sign-in form, and no output file or event contains the password".

### Planned, not shipped
Platform plan item 1.3 (gap G14) adds API traffic capture. Its intended rules: keep the shape of API responses instead of raw bodies, strip the `Cookie`, `Set-Cookie`, `Authorization` and `Proxy-Authorization` headers, detect JWT and API-key patterns, and never store a raw HAR. None of this exists in code: the evidence capture has no response capture. The plan says redaction ships in the same commit as the capture, so that work must extend or supersede this record and add tests first. This paragraph is intent, not a decision.

### Other ADR numbers
0014 is written (Accepted 2026-10-07, with T-12, built in wave 1). 0013 (opt-in AI explorer, selector fixes) and 0015 (live-site GraphQL and GET/HEAD replay rules) are not written; they come with G22 (self-healing, item 3.1) and G14 (API traffic, item 1.3). 0017 (findings contract) comes with T-16 and is not written. The numbers 0013, 0015 and 0017 stay reserved.

## Consequences
- A new field that can hold a sign-in value needs a test in `packages/core/tests/redaction.test.ts` (SECURITY.md).
- Anything new written to disk or sent to the AI goes through `Redactor` (`text`, `deep` or `files`), or it is a gap.
- Loosening redaction needs an ADR and a test (SECURITY.md).
- The 3-character floor and the `@`-only usernames are accepted trade-offs, so ordinary words are not blanked.
- The limits above are known and listed so a later change can close them one by one.
- The output folder, especially `auth/` and the screenshots, is not fit to share as it is. Wording about this follows 0018: say what was hidden and what was not checked, never that the output is clean.
