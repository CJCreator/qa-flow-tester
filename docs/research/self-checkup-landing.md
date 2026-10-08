# Check-up of our own landing page

**Date:** PENDING /verify-all. Ticket [T-15](../tickets/T-15-self-checkup-landing.md). The Check-up could not run at build time (tests and runs are deferred); results below are filled in at verify.

## Header

| | |
|---|---|
| Date | PENDING /verify-all |
| Commit | PENDING /verify-all |
| Target | `http://localhost:3001/` (landing page served by `pnpm start --no-open`) |
| Mode | read-only (no `--staging`), no AI key, fixed-rule Plan |

Command (from [`docs/TESTING.md`](../TESTING.md)):

```
node packages/runner/dist/checkup.js http://localhost:3001/ --fail-on none --max-pages 20 --output .tmp-self-checkup
```

## Verdict and score

PENDING /verify-all. To fill: verdict stamp and reason from the report, tests passed and failed.

## Findings

Only findings on `/` and `/sample-report.html` count as landing findings. Status is `fixed` (with file), `filed` (ticket id and reason) or `intended` (reason).

| Id and title | Severity | Page | Status |
|---|---|---|---|
| PENDING /verify-all | | | |

## Could not verify

- The run itself: deferred at build, so no result exists yet. Nothing here counts as checked until the PENDING markers are gone.
- Landing changes from T-13 and T-14 (counter, share image, contact and sign-up, remaining audit items) were not built when this was written; any run before they land is out of date and needs a dated re-run.
- Speed numbers are lab measurements in a test browser with a simulated phone and network. Localhost has no real network. Lab results on one machine vary by about 15% (see [`lab-lcp-noise.md`](lab-lcp-noise.md)).
- Real-network, CDN and hosted (Vercel) behavior, and differences in the Vercel static build, were not checked.
- Accessibility: automatic checks only. Alt-text quality, reading order and captions need a human review (ADR 0018).
- Security: passive checks only.
- The AI-written Plan was not used.
- Sign-in and send paths (forms, email updates) were not exercised because the Check-up is read-only.
- Real mobile devices were not used.
- Owner-only content (testimonials, pricing, contact target) was not judged.
