# T-388: Open hosted Website Audits to the owner

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | deploy, docs | access | todo |

**Files you may edit (no others):** `docs/tickets/WEBSITE-AUDIT-RELIABILITY-PLAN.md`, `docs/DEPLOYMENT.md`.

## Problem

On the hosted copy, every audit screen shows "This shared copy has no Website Audits of its own" (`packages/wizard/src/screens/audit/BetaAuditNotice.tsx:37-40`). Only a Google sign-in whose email is in `AUDIT_OWNER_EMAILS` counts as an audit owner (`packages/runner/src/server.ts:901-906`). That GitHub variable is not set: `gh variable list` on 2026-11-19 has no `AUDIT_OWNER_EMAILS`, although `deploy.yml:190` passes it.

## Current code

The T-86 plan (line 33) says the access-key holder is also an owner. T-297 changed that on purpose: on a beta copy the shared key alone is not an owner (`packages/runner/tests/beta-key-not-audit-owner.test.ts`). The plan text is stale.

## Change

- Correct the T-86 scope text to match T-297.
- In `DEPLOYMENT.md`, under the hosted set-up steps, add: "Set `AUDIT_OWNER_EMAILS`, or nobody can run Website Audits on the hosted copy."

## Human step

Set the repository variable `AUDIT_OWNER_EMAILS` to the owner's Google email(s), then redeploy. The ticket stays `human` until then. Mark T-86 `done` afterwards.

## Done when

The owner signs in with Google on the hosted copy, reaches `/audits/new`, and finishes an audit of techgramam.com.
