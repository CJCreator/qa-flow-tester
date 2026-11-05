# 0037: Every Runner Route Declares an Access Level and a Beta Policy; Owner, Helper and Public Access

Status: Accepted, 2026-11-03 (DEC-001, REC-06; beta policy from the developer's answers to D-004 / Q-51 on 2026-11-03: closed-default, and D-005 / Q-55 on 2026-11-03: allow-helpers; written in task DOC-105). Builds on [0027](0027-checkup-session-module-and-route-table.md) (route table), [0033](0033-website-audit-entry-point.md) (Website Audit; this is its follow-up record 0037, Helper sign-in) and [0036](0036-hosted-audit-storage-and-shared-links.md) (hosted storage and Shared Links). D-004 is amended by [0042](0042-website-audit-reliability-and-access.md): on a beta copy the signed-in owner (`AUDIT_OWNER_EMAILS`) reaches the audit rows.

Amended by [0039](0039-cloud-scheduler-owner-schedules.md): the schedule routes are owner-only rows served in beta, and the tick row uses a route-only `scheduler` access level (`AuditAccess` is unchanged).

## Context
Runner authorization today is a list of imperative path checks inside `packages/runner/src/server.ts`. A route that is missing from those lists is open to everyone who reaches the runner, including every beta visitor of the hosted copy (`RUNNER_BETA=1`): it fails open (AR-06, AR-07, RISK-002).

The Website Audit ([0033](0033-website-audit-entry-point.md)) adds about 40 routes, listed in `AUDIT_API` in `packages/types/src/website-audit.ts`. Each already names who may call it, as one of six access levels (`AuditAccess`). They mix three kinds of caller: the tool user, Helpers given chosen Website Audits, and anyone holding a Shared Link ([0036](0036-hosted-audit-storage-and-shared-links.md)). Adding them to the path-check lists would repeat the fail-open problem 40 times. DEC-001 (2026-11-03) decided to declare access on each route of the route table of [0027](0027-checkup-session-module-and-route-table.md) instead, and to record the authorization model here.

## Decision
- **Six access levels.** Every route row in the route table (`Route` in `packages/runner/src/routes/route.ts`) declares an `access` field whose values are exactly `AuditAccess` in `AUDIT_API`:
  - `owner`: the tool user only, never a Helper. Settings, AI keys, starting a run (it spends the AI key), deleting a Website Audit, managing Helpers, making or revoking Shared Links.
  - `view`: the tool user, or a Helper given view on that Website Audit.
  - `edit`: the tool user, or a Helper given edit on that Website Audit.
  - `export`: the tool user, or a Helper given export on that Website Audit.
  - `sign-in`: Helper sign-in, sign-out and session status, reachable before any access is held.
  - `public`: Shared Link pages (`/s/:linkId`) only, open without the tool's access key.
- **Who is who.**
  - **Owner** is the tool user: whoever holds the runner's access key (`accessToken`, sent as the access cookie or the `X-QA-Access` header), or a local request when no access key is set. The owner passes every level.
  - **Helper** ([REQ-033](../../engineering/requirements.md)): a person who signed in with a Google account and holds a valid Helper session. A Helper gets `view`, `edit` and `export` per Website Audit, only on the Website Audits given to them, and only the permissions given. A Helper never passes an `owner` row: no AI keys, no deleting a Website Audit, no adding Helpers. Every `view`, `edit` and `export` check reads the Helper grant of the Website Audit named in the request (`:id`), so a Helper given one Website Audit cannot reach another by changing the id.
  - **Public**: anyone. Only `public` rows serve them, and the only `public` rows are Shared Links. A Shared Link page reads only its shared snapshot ([0036](0036-hosted-audit-storage-and-shared-links.md)).
- **Closed by default.** `matchRoute` dispatch enforces the declared access before the handler runs. A route row with no declared `access`, or with a value outside the six, is refused at dispatch, never served. The access level of each audit route row equals its `AUDIT_API` entry's `access`, and a test keeps them equal.
- **Beta policy.** Every route row also declares a beta policy: whether a beta visitor (`RUNNER_BETA=1`) may reach it. It is closed by default: a row that does not explicitly allow beta visitors is refused for them.
  - D-004 (Q-51, 2026-11-03, closed-default): beta visitors reach only `public` Shared Link routes; every other audit route is refused in beta unless this record lists it.
  - D-005 (Q-55, 2026-11-03, allow-helpers): the Helper `sign-in` routes, and the `view`, `edit` and `export` routes of Website Audits given to a Helper, when the request carries a valid Helper session, also pass the beta policy. The hosted copy runs in beta, so without this a Helper could never sign in there.
  - Every other audit route stays closed in beta, including every `owner` row.
- **Where it is enforced.** The access check runs at dispatch through one function (`authorizeRoute`, task BE-102), not inside handlers and not as a path list in `server.ts`. Website Audit routes are added to the route table, never inline in `server.ts`. Handlers still check the Helper grant where they read the Website Audit's data.
- **Helper sign-in lives here.** This is the record [0033](0033-website-audit-entry-point.md) names as follow-up 0037 (Helper sign-in). The Google ID token verification details (audience, issuer, expiry, session cookie) are decided by the REQ-033 task, which extends this record rather than writing another 0037.

## Consequences
- A route added without an access level fails closed instead of open (RISK-002).
- Dispatch, a security-sensitive path, is refactored; it is covered by tests for each level, the closed default and the beta policy (REQ-048 AC-1 to AC-5).
- In beta, the tool user's own audit pages are closed; the hosted copy serves Shared Links to anyone and Website Audits only to signed-in Helpers given them.
- The remaining inline endpoints of `server.ts` move to the route table over time, finishing [0027](0027-checkup-session-module-and-route-table.md); until then they keep their present checks.
- The wizard page, its assets and a reduced `GET /api/runner/status` pass for a verified Helper session without the access key, so a Helper can load the hosted copy (T-68); every other inline endpoint keeps the access-key gate.
- Shared Links publish an audit of someone else's site (RISK-022); keeping `public` to Shared Link rows only limits that to the shared snapshot.

## Alternatives considered
- **Keep the path checks in `server.ts` and add the audit routes to them.** Rejected: it fails open for any route left out (DEC-001).
- **Beta open by default, closing routes one by one.** Rejected by D-004: the same fail-open problem in beta.
- **Beta allows Shared Links only, Helpers wait for a non-beta host.** Rejected by D-005: the hosted copy is the only place Helpers can work.
