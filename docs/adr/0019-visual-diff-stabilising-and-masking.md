# 0019: Perceptual Visual Diff: Stabilise Before Capture, Mask Volatile Regions, Show Old/New/Difference

Status: Accepted by plan approval, 2026-10-08 (the owner approved this through the T-21 plan).

Builds on [0016](0016-evidence-redaction.md) (what is redacted and what is not), [0017](0017-findings-contract.md) (new evidence fields are additive) and [0006](0006-two-tier-decoupled-design-checker.md) (Tier 2 stays deterministic and decoupled). Wording follows [0018](0018-claim-wording.md).

## Context
The Perceptual Visual Diff compared a raw screenshot with a stored baseline. Dates, ads and half-loaded pages made it flag changes nobody made. The Report showed only a difference image path, and the "new" image was never kept.

## Decision
- **Stabilise first.** Before every capture (new baseline and comparison) the page waits for fonts, forces lazy images to load, waits for network idle (capped) and two animation frames, all under one hard deadline (4 s). It never clicks, scrolls or submits, and never throws.
- **Mask by fixed rules, not by editing the page.** New baselines are taken with Playwright's `mask` over: elements whose whole text is a date, time or "N minutes ago"; `time` and `[datetime]`; a short list of well-known ad markup; `input[type=password]`; and any selectors in the profile's `visualMaskSelectors`. No AI, and no page changes beyond a temporary marker attribute that is removed afterwards.
- **A sidecar decides how to compare.** Each new baseline `<id>-<bp>.png` gets `<id>-<bp>.visual.json` with `version`, `masked`, the SHA-256 of the PNG and the extra selectors. A comparison is masked only when the sidecar is valid and its hash matches the PNG. Otherwise (older `.qa-baselines`, Figma-synced, or a PNG replaced through the app) it compares exactly as before, with no masks. No baseline is rewritten. Re-recording with update mode adopts masking.
- **Bump `version` when the mask rules change**; masked baselines then compare unmasked until re-recorded.
- **Old, new and difference in the Report.** On a regression the baseline and current images are copied into the test's evidence folder and recorded as `evidence.baselineScreenshotPath` and `evidence.currentScreenshotPath` (the existing `screenshotPath` stays the difference image). The single-file HTML Report embeds them as base64 within a size budget, then falls back to relative links. Only existing `.png` files inside the report folder are embedded.

## Consequences and limits
- Masking a password field applies to masked captures only. This tightens, but does not close, the screenshot limit in 0016: legacy baselines and the current image of a legacy comparison are unmasked.
- Embedded and copied images are not redacted: pixels cannot be. Their exposure is the same as the existing evidence folder. Report text is still redacted before the Report is written. The output folder and old baselines remain not fit to share as they are. Say what was hidden, never that the output is clean (0018).
- A baseline taken mid-load may now differ once the page is stabilised. The threshold (`visualDiffMaxPercent`, default 0.01) is unchanged.
- Date and ad rules can hide real content that looks like a date or ad. They are conservative and anchored; `visualMaskSelectors` can only add masks.
