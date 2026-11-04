# Release notes

> Maintained by AI-EOS (`/ai-eos:release`, release-engineer). Deployment happens **only** after a human types
> `/ai-eos:release approve`, and every deploy command still raises a permission prompt.
> Approval is bound to this file's content: editing it afterwards invalidates the approval.

## Readiness

<!-- ai-eos:begin readiness -->
_Run `aieos gate --for release` to populate._
<!-- ai-eos:end readiness -->

## Release

| Field | Value |
|---|---|
| Version | |
| Previous version | |
| Date | |
| Release type | major / minor / patch |

## Summary

## Changes by requirement

| Requirement | Change | Tasks | Evidence |
|---|---|---|---|

## Verification evidence

_Mandatory gates and their latest evidence IDs (see checks.md)._

## Known issues and accepted risks

## Security findings

_Open findings by severity, with accepted-risk justification where applicable. No secret values._

## Deployment checklist

- [ ] Version bumped in all version files
- [ ] CHANGELOG updated
- [ ] Mandatory gates PASS on the release commit
- [ ] Database migrations reviewed and reversible
- [ ] Configuration / secrets provisioned in the target environment (names only here)
- [ ] Monitoring and alerting in place
- [ ] Rollback plan verified
- [ ] Release approval recorded

## Rollback plan

_Exact steps, owner, and the trigger conditions for rollback._

## Post-deployment validation

_Checks to run after deployment (only when authorized), with expected results._

## Approval

<!-- ai-eos:begin approval -->
_Not yet requested._
<!-- ai-eos:end approval -->
