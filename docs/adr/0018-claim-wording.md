# 0018: Claim Wording: Never "Compliant", Never "Secure"

Status: Accepted. Known gap (2026-10-21, T-63): the score in `packages/core/src/scoring.ts` still names one of the six quality areas "Secure". It is an area label, not a claim of security, but this record says the word is not used. Renaming the area is a code change that this record does not make.

## Context and Decision
A check-up looks at a small part of a site and says what it found. People read a clean report as "this site is fine". Two words cause the most harm when the tool is wrong:
- **"Compliant"** (with WCAG, the ADA, GDPR and so on). Automated checks find only a part of the accessibility problems, and the tool cannot judge law.
- **"Secure"**. Passive checks read what the site already sends. They cannot show that a site is safe.

We decided that the tool and its reports never say a site is compliant, accessible, or secure. Instead:
- **Say what was checked.** "No accessibility problems found by the automatic checks on 12 pages" is allowed. "Accessible" is not.
- **Say what was not checked.** Every report lists what the checks cannot see: for accessibility, anything that needs a person (alt-text quality, captions, reading order); for security, anything that needs active probing; for speed, what real visitors experience.
- **Name the standard and level that was tested.** "WCAG 2.2 AA, automatic checks only." A finding cites its criterion number.
- **Separate failures from questions.** What the automatic check could not decide is shown as "Needs human review", never as a pass and never as a failure.
- **Say how a number was measured.** A speed number says it is a test-browser measurement, how many loads it is the median of, and the phone and network profile it simulated.
- **A scan that did not run is a finding.** A page that was not scanned is "not checked", never a clean result.
- **Engines are named truthfully.** The Playwright WebKit build is "WebKit (Playwright build)", never "Safari".

Words to avoid in the product, reports, docs and marketing: compliant, compliance (as a result), certified, secure, safe, hack-proof, passes WCAG, fully accessible. A report may say that a site "meets" or "fails" a single named check.

## Consequences
- Reports and the wizard need a "What this did not check" section. This is built with the accessibility checklist (item 3.4) and the report work (item 1.1). Until then, each finding states its own limits.
- Marketing copy and the README are reviewed against this list before each release.
- It costs some persuasiveness. We accept that, because a trusted verdict is the product.
