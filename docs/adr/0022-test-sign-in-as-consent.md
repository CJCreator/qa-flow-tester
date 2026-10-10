# 0022: Test Sign-In Details Count as Consent to Full Testing (Local Only)

Status: Accepted by plan approval, 2026-10-10 (the owner chose "credentials = consent" for the URL + test credentials Check-up).

Amends [0014](0014-verified-domains-and-safe-host-classification.md) (safe host classification). Builds on [0003](0003-deterministic-safety-filters.md) (Safety Filter), [0016](0016-evidence-redaction.md) (redaction) and [0021](0021-saved-sessions-memory-only-and-confined-docs-fetch.md) (secrets in memory).

## Context
A person who gives only an App address and test sign-in details expects the tool to crawl and test everything. Today an App that is not a Test Copy is only looked at, so the extra step of marking it blocks that path.

## Decision
- A run gets full testing on an App that is not a Test Copy when all of these hold: the owner's say-so is given explicitly (`owner: true` in the request; an omitted owner is never consent), the request carries `signInConsent: true`, at least one role has a username and password, and the runner is on the person's own computer or in GitHub Actions (not the shared online copy, `RUNNER_BETA`).
- The Check-up shows a plain notice before it starts: it will fill in and send forms on this App with these sign-in details. The person must accept it; the wizard offers "Only look at it instead".
- Consent lasts for that one run. It is never written to site memory, so a later run without sign-in details is only looked at again.
- Sign-in must succeed first. A failed sign-in stops the Check-up before the crawl and gives one of the existing reasons, and a role that cannot sign in fails the run before testing (it is not just listed as "not tested"). The consent is kept with the saved Plan: approving it again needs a role with both username and password, otherwise the approval is refused and nothing is sent.
- Flows that need no sign-in (sign-up, contact) do run signed out, but only after the given sign-in has succeeded. A run whose sign-in fails never runs any flow, signed in or out.
- Consent does not change what is remembered for the site: it never writes the owner say-so or a Test Copy mark to site memory.
- A headless Check-up (CI) keeps its signed-in session in a temporary folder outside the report folder and deletes it when the run ends.
- Unchanged: the Safety Filter still skips Sensitive Actions; Security Probes still need a Test Copy; same-site confinement, robots policy and redaction apply.
- `isTestHost` and `resolveTestHost` stay pure address rules. The consent rule is applied where read-only is decided, in the runner.
- On the shared online copy consent is ignored. ADR 0014 still applies: only an address under a Verified Domain can be marked a Test Copy.

## Consequences
- Sign-in details do not prove the person owns the App. The notice and local-only scope are the protection; ADR 0014's risk of writes to a production App applies to a person who points this at an App that isn't theirs.
- With consent the "block all changes" request filter is off, so form posts are sent. A delete reached by a plain link, or a GraphQL mutation sent as a POST, is caught only by the Safety Filter's word check.
- Tests: live host plus consent sends form posts but never a Sensitive Action; no consent stays read-only; beta ignores consent; wrong password stops before the crawl; consent is absent from site memory; the password is absent from files, logs and events.
- Loosening any of these needs a new ADR.
