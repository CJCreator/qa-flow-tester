# T-343: Findings carry a stable rule code, and fingerprints use it

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | types | bug | todo |

**Files you may edit (no others):**

- `packages/types/src/evidence-finding.ts`
- `packages/types/src/fingerprint.ts`
- `packages/types/src/findings-contract.ts`
- `packages/types/tests/fingerprint.test.ts`
- `packages/types/tests/rule-code.test.ts` (new)
- `packages/checkers/src/seo.ts`
- `packages/checkers/src/spec-conformance.ts`
- `packages/core/tests/findings-contract.test.ts`
- `packages/core/tests/reporter.test.ts`
- `docs/adr/0017-findings-contract.md`
- `CHANGELOG.md`

**Do not build in parallel with:** T-340 (edits `seo.ts`); T-338 (edits `spec-conformance.ts`); T-249, T-251 (all edit `findings-contract.test.ts`); T-373 (edits `CHANGELOG.md`).

## Problem

The Structural Fingerprint of a finding uses its `title` as the rule code (`packages/types/src/fingerprint.ts:109-116`: `ruleCode: f.title`). Many titles carry numbers or quoted values that change from run to run: `Page has multiple <h1> headings (5 found)` (`packages/checkers/src/seo.ts:174`), `... canonical URL tags (2 found)` (`:265`), `Images missing alt text descriptions (7 found)` (`:355`), `Broken link found: /x returned HTTP 404` (`:638`), `Expected text not found: "Sign up"` and `URL did not match expected pattern: "..."` (`spec-conformance.ts:284`, `:324`). When the count goes from 5 to 4, the site history (`core/src/site-history.ts:63`) and `findings.json` show the old problem as fixed and a new problem as found. The trend is wrong, and so is the "new since last run" list.

Separately, `normalizeRoute` (`fingerprint.ts:30-61`) lower-cases the path (`:60`). Paths are case-sensitive, so `/Foo` and `/foo` get one fingerprint.

## Owner decision (open)

How should a finding keep the same identity when its title changes?

- **A. Add an optional `ruleCode` to `Finding`; the fingerprint uses it, and when it is missing it uses the title with numbers and quoted values replaced (recommended default).** A checker sets `ruleCode` where its title carries values; every other finding is covered by the fallback. One-time effect: fingerprints of findings whose titles hold numbers change once, so the next history comparison shows them as new once. The findings file version goes to 2 (ADR 0017 treats a fingerprint-input change as a bump).
- **B. Only strip numbers and quoted values from titles when fingerprinting.** No type change and no checker edits. The rule is implicit, and two different rules with similar titles can merge.
- **C. Leave it.** The history keeps showing false fixed-and-new pairs.

This ticket builds A unless the owner picks another option.

## Current code

Branch from `main`.

`packages/types/src/fingerprint.ts` (`grep -n "ruleCode\|toLowerCase" packages/types/src/fingerprint.ts`):

```ts
    ruleCode: f.title,
...
  return route.toLowerCase();
```

`packages/types/src/findings-contract.ts:4`: `export const FINDINGS_SCHEMA_VERSION = 1;`

## Change

1. `evidence-finding.ts`: add to `Finding` an optional field `ruleCode?: string; // stable id of the rule that found it, for fingerprints. Set it when the title carries counts, paths or quoted values.`
2. `fingerprint.ts`: add and export `stableRuleCode(title: string): string`: lower-case; replace each quoted segment (`"..."` or `'...'`) with `""`; replace every run of digits with `#`; collapse spaces; trim. Quotes and digits only, nothing cleverer.
3. `findingFingerprint` takes `Pick<Finding, 'checker' | 'title' | 'where' | 'ruleCode'>` and uses `ruleCode: f.ruleCode?.trim() || stableRuleCode(f.title)`.
4. `normalizeRoute`: stop lower-casing the path. Keep the rest. (The comment and the test name that say "lowercase" are updated.)
5. `findings-contract.ts`: `FINDINGS_SCHEMA_VERSION = 2`. Update `docs/adr/0017-findings-contract.md`: in "Fingerprint" the inputs line becomes "rule code (`ruleCode` when the checker sets it, else the finding `title` with numbers and quoted values replaced)"; in "Version" add a line "Version 2: the rule code input changed, and the route is no longer lower-cased." Add a `CHANGELOG.md` entry under `[Unreleased]`, `### Changed`: "Finding fingerprints no longer change when a count or quoted value in the title changes; `findings.json` schemaVersion is 2. Fingerprints change once on upgrade."
6. `seo.ts`: set `ruleCode` on the four templated findings named above: `seo-multiple-h1`, `seo-multiple-canonical`, `seo-images-missing-alt`, `seo-broken-link`. `spec-conformance.ts`: set `ruleCode` on every finding whose title embeds the pattern, text, form path, role, field or url path (find them with `grep -n "title: \`" packages/checkers/src/spec-conformance.ts`): `spec-url-mismatch`, `spec-text-missing`, `spec-text-disallowed`, `spec-refusal-accepted`, `spec-refusal-wording`, `spec-form-broke`, `spec-denial-reached`, `spec-field-no-error`. Use one short kebab-case string per rule, the same for every instance. Leave other checkers on the fallback.
7. Update the two core tests that pin `schemaVersion` to 1 (`core/tests/findings-contract.test.ts:138`, `core/tests/reporter.test.ts:186`) to 2.
8. Run `pnpm exec prettier --write` on the touched files.

## Tests

- `packages/types/tests/rule-code.test.ts` (new, unit): `stableRuleCode('Page has multiple <h1> headings (5 found)')` equals `stableRuleCode('Page has multiple <h1> headings (4 found)')`; `Expected text not found: "A"` equals the same with `"B"`; two different rules do not collide (`Missing title` vs `Missing description`); `findingFingerprint` of two findings with different counts in the title but the same `ruleCode` is equal; with no `ruleCode` the fallback gives the same fingerprint for 5 and 4; a different `ruleCode` gives a different fingerprint.
- `packages/types/tests/fingerprint.test.ts`: `normalizeRoute('/Foo')` is `'/Foo'` and differs from `'/foo'`; the host part is still dropped; the "lowercase" test is renamed and its expectations kept (they use lower-case paths already).
- Core tests: schema version 2.

Run: `pnpm exec vitest run packages/types/tests`, then `pnpm exec vitest run --project unit packages/core/tests packages/checkers/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "ruleCode: f.title" packages/types/src/fingerprint.ts` finds nothing.
- [ ] `grep -n "ruleCode" packages/checkers/src/seo.ts packages/checkers/src/spec-conformance.ts` finds the set values.
- [ ] `grep -n "FINDINGS_SCHEMA_VERSION = 2" packages/types/src/findings-contract.ts` matches; ADR 0017 and CHANGELOG are updated.
- [ ] All unit tests pass; `pnpm build` passes (types are built first).

## Notes

- Audit finding M21 (audit of 11 Nov 2026 on `d225418`).
- Other checkers with counts in titles (`performance.ts`, `security.ts`) are covered by the fallback today; give them a `ruleCode` later if the fallback is not enough.
- Related: T-338 and T-340 (edit the same checker files, different lines).
