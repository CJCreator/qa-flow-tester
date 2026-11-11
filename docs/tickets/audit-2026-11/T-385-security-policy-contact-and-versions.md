# T-385: SECURITY.md names a contact and the supported versions

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | docs | gap | todo |

**Files you may edit (no others):**

- `SECURITY.md`

**Do not build in parallel with:** T-308 (edits `SECURITY.md`).

## Problem

`SECURITY.md:5-7` tells a reporter to use GitHub's private vulnerability reporting, then ends with a note meant for the owner: "(Owner: add a contact email here if you want one.)". That note is public text in a policy file, and it reads as unfinished. The file also never says which versions get security fixes, so a reporter who finds a problem in an old copy does not know whether it counts.

## Owner decision (open)

Which contact does the policy give?

- **A. GitHub private vulnerability reporting only; remove the note (recommended default).** No address to run or monitor. The reporting form already exists on the repository (Security tab). Right when the owner has no address they want to publish.
- **B. Add an address the owner gives.** Some reporters will not use GitHub; an address helps them. The owner must supply the address and must read it. The ticket cannot invent one.

This ticket builds A unless the owner picks another option. For B, the owner gives the address and the builder adds it as a second sentence in the same paragraph.

## Current code

Branch from `main`. `grep -n "Owner:" SECURITY.md`.

`SECURITY.md:3-7`:

```markdown
## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting on the repository
(Security tab, "Report a vulnerability"). Include steps to reproduce and the version or commit. Expect an
acknowledgement within a few days. (Owner: add a contact email here if you want one.)
```

## Change

1. Delete the sentence `(Owner: add a contact email here if you want one.)` and the space before it, so the paragraph ends with "Expect an acknowledgement within a few days." Leave the rest of the paragraph as it is.
2. Under that paragraph add one line:

```markdown
Only the latest `main` and the hosted copy are supported. A fix goes to `main` and to the hosted copy together; older commits and copies are not patched.
```

3. Do not change any other section of the file. Run `pnpm exec prettier --check SECURITY.md`.

## Tests

None. Wording only.

## Done when

- [ ] `grep -n "Owner:" SECURITY.md` prints nothing.
- [ ] `grep -n "Only the latest" SECURITY.md` finds the supported-versions line.
- [ ] Prettier check passes.

## Notes

- Audit finding L2 (audit of 11 Nov 2026 on `d225418`).
- "Hosted copy" is the Google Cloud Run service (ADR 0032). "Latest `main`" is the head of the default branch; there are no release tags yet, so there is no version table to keep.
- `CONTRIBUTING.md` and `README.md` link to this file; their wording needs no change.
