# Decisions

> **Append-only** record of significant engineering decisions, documentation updates and lessons learned.
> Never rewrite or delete a past entry; supersede it with a new one that references it.

Entry format:

```markdown
## DEC-001 — Title
- Date: YYYY-MM-DD
- Status: proposed | accepted | superseded by DEC-00X
- Context: what forced the decision
- Decision: what was decided
- Consequences: trade-offs, follow-ups, known limitations
- Alternatives considered: …
```

## Known limitations

## Technical debt register

## Lessons learned

## Entries

## DEC-001 — Website Audit is a separate entry point on the shared engine
- Date: 2026-10-30
- Status: accepted
- Context: `Requirements.txt` (FR-1..FR-33) audits other people's websites to pitch redesign or repair work; the Check-up serves teams checking their own Apps (Q-01).
- Decision: add a "Website Audit" start screen beside the Check-up, reusing discovery, checkers, AI providers and reporting. India-wide market, English and Tamil first, free tier for now (Q-34, Q-05).
- Consequences: two audiences and wording sets; new CONTEXT.md terms (Website Audit, Audit Document, Improvement Roadmap); pitch output must follow ADR 0018 and never show the release verdict (RISK-009).
- Alternatives considered: a mode inside the Check-up; owner-side features only; a separate product (see `engineering/architecture.md`).

## DEC-002 — Implement ADR 0031 before any Website Audit work
- Date: 2026-10-30
- Status: accepted
- Context: ADR 0031 is Accepted, but page-derived requests still bypass `safeGet` (`deterministic-spider.ts:409,428`, `seo.ts:555-557`, `security-depth.ts:146`) and the named source-grep test does not exist (F-001, RISK-001).
- Decision: T-43 as ADR 0031 states is the first planned task.
- Consequences: broken-link and site-root checks report nothing until `fetchFn` is wired (fail closed, per the ADR).
- Alternatives considered: fixing it outside this workflow; deferring it.

## DEC-003 — Accept ADR 0015 live-site pacing
- Date: 2026-10-30
- Status: accepted (ADR text to be updated during planning)
- Context: third-party audits need polite crawling; ADR 0015 is Deferred, the run phase is unpaced and Crawl-delay is ignored (RISK-014).
- Decision: one request at a time per host; honour robots.txt Crawl-delay.
- Consequences: longer audits on large sites.
- Alternatives considered: keeping the current 2000 ms crawl-only delay.

## DEC-004 — Encrypt the AI key fallback file (amends ADR 0002)
- Date: 2026-10-30
- Status: accepted (ADR to be written during planning)
- Context: REQ-040 requires keys stored encrypted; `key-resolver.ts:61-72` writes plaintext `.qa-keys.json` when no OS keychain exists (RISK-004).
- Decision: encrypt the fallback file (AES-256-GCM); never write keys in plaintext.
- Consequences: key-management design for the encryption key belongs in the ADR.
- Alternatives considered: refusing to save keys without a keychain.

## DEC-005 — Hosted storage for shared pitch links
- Date: 2026-10-30
- Status: accepted (ADR to be written during planning)
- Context: the pitch glimpse is sent printed or as a shared link (Q-09); the hosted copy keeps data in `/tmp` on one instance (ADR 0032, RISK-002).
- Decision: store shared pitch pages in a Cloud Storage always-free bucket; unguessable link IDs, `noindex`, 30-day expiry, revocable by the tool user.
- Consequences: first persistent store on the hosted copy; RISK-022 (public exposure of third-party audits).
- Alternatives considered: no shared links (print only); Firestore.

## DEC-006 — Content extracted on every page, checks sampled
- Date: 2026-10-30
- Status: accepted
- Context: checkers run on Sample Pages only (3 per Layout Group); the audit needs per-page content (Q-35, RISK-010).
- Decision: deterministic content extraction (text, headings, images and alt, meta, CTAs, language, sections) on every crawled page; browser checkers and AI notes stay on Sample Pages; duplicate checks run site-wide on extracted content.
- Consequences: larger stored data per audit (RISK-017).
- Alternatives considered: checkers on every page (run time and AI cost).

## DEC-007 — Five Audit Documents in MVP, deterministic grades with AI notes
- Date: 2026-10-30
- Status: accepted
- Context: FR-18 never named "the three audit documents" (Q-02); FR-16 asked for an AI assessment (Q-04).
- Decision: MVP generates Structure, Content, Findings (technical, marketing and content sections), Improvement Roadmap and Proposal; REQ-026 and REQ-027 move from Phase 2 to MVP. Grades come from deterministic checks; AI writes notes citing evidence; no AI numeric score. External speed data from the PageSpeed Insights API; search data deferred (REQ-042).
- Consequences: larger MVP; the Proposal template needs the "website-only" scope confirmed (Q-19).
- Alternatives considered: three documents in MVP with roadmap and proposal in Phase 2.

## DEC-008 — One plan for all 43 active requirements
- Date: 2026-10-30
- Status: accepted
- Context: `/ai-eos:plan` must cover every active requirement; the developer chose to include Phase 2 and Phase 3 rows and answered their open questions (Q-08, Q-15 to Q-17, Q-20, Q-31, Q-38, Q-39).
- Decision: PLAN-001 covers REQ-001 to REQ-045 except the deferred REQ-031 and REQ-042.
- Consequences: a long plan; Phase 2/3 tasks depend on MVP foundations and run in later waves.
- Alternatives considered: MVP only; MVP plus Phase 2.

## DEC-009 — Helper sign-in with Google accounts (Firebase Authentication)
- Date: 2026-10-30
- Status: accepted (ADR to be written in the plan)
- Context: helper accounts (REQ-033) need identity on the hosted copy, which has one shared access key (ADR 0032, RISK-018).
- Decision: Google sign-in through Firebase Authentication (free tier); helpers view, edit and export audits they are given; no access to the owner's AI keys, deleting audits or adding helpers.
- Consequences: new dependency and auth surface (P2); local runs stay single-user.
- Alternatives considered: personal invite links; email one-time codes.

## DEC-010 — Saved audits in the Cloud Storage bucket on the hosted copy
- Date: 2026-10-30
- Status: accepted (covered by the DEC-005 ADR)
- Context: REQ-028 saved audits with history; `/tmp` is wiped on redeploy (RISK-002).
- Decision: one folder per audit and version in the DEC-005 bucket; local runs keep plain files.
- Consequences: one storage interface with a file and a bucket implementation.
- Alternatives considered: Firestore; local only.

## DEC-011 — AI rewrite reads the site and writes new copy into documents only
- Date: 2026-10-30
- Status: accepted
- Context: FR-30 "AI agents with browser access rewrite content after approval" (Q-08).
- Decision: agents browse read-only; new copy goes into the Audit Documents; the tool user approves each section; a word-overlap check flags copied phrases. ADR 0030 unchanged.
- Consequences: no live-site edits; the overlap threshold is a setting.
- Alternatives considered: editing the owner's live site through their CMS.

## DEC-012 — Baseline gates for PLAN-001
- Date: 2026-10-31
- Status: accepted
- Context: baselines EV-0003 (typecheck: 216 errors in 86 test files, CI tolerates with `|| true`), EV-0004 (secret scan reads git-ignored `.env`, generated reports, the worktree), EV-0006 (54 tests in 29 files time out locally; CI passes on the same commit).
- Decision: CHK-NODE-TYPECHECK type-checks package sources only; CHK-SECRETS scans only what would be committed (BE-011, REC-001); new REQ-046 and task QA-003 fix the 29 failing test files first, with the repository kept in its current OneDrive folder (REC-002). CHK-NODE-UNIT stays the full `pnpm test` with a 3600 s timeout.
- Consequences: test type debt stays (RISK-023); BE-001 waits for QA-003.
- Alternatives considered: fixing test type errors in this plan; gating on CI's test set; moving the repository out of OneDrive.

## DEC-013 — Delivery: one branch, PR per milestone, one release, 5 agents
- Date: 2026-10-31
- Status: accepted
- Context: a push to main deploys to Cloud Run; CLAUDE.md requires a branch and PR (Q-41 to Q-43).
- Decision: branch `feat/website-audit`; a PR per verified milestone (M1 waves 1-5, M2 waves 6-9, M3 waves 10-14); one release (REL-001) after everything; `max_parallel_agents` 5.
- Consequences: main deploys only reviewed milestones; nothing reaches users until the release.
- Alternatives considered: one PR at the end; branch per task; MVP release first.

## DEC-014 — Firebase on the existing Cloud Run project; translation review
- Date: 2026-10-31
- Status: accepted
- Context: helper sign-in needs Firebase (Q-44); fixed strings are machine-translated into 12 languages (Q-45).
- Decision: add Firebase to the existing Google Cloud project; the developer runs the documented setup. The developer reviews Tamil; Hindi and the other languages ship with a visible beta label until reviewed.
- Consequences: BE-031 setup is manual (waiver); BE-018 and FE-003 add the beta label.
- Alternatives considered: native-speaker reviewers for Tamil and Hindi; all languages beta.

## DEC-015 — Wave-1 re-plan: ownership gaps and the test gate
- Date: 2026-10-31
- Status: accepted
- Context: wave 1 reports: BE-002 broke two files outside its ownership; BE-010 left beta service keys and a test writing to the real config folder (RISK-027); BE-011 found the `.dockerignore` gap (RISK-028); BE-002's new skip reasons need wizard wording; QA-003 fixed most local failures but left the crawler time-limit overshoot, a 10+ minute signed-in test, port clashes in non-owned files and a suite longer than one 60-minute check.
- Decision: BE-002 owns `issues-document.ts` and `browser-entry.test.ts`; BE-027 owns `beta.ts` (session-only service keys); BE-012 fixes `ai-provider.test.ts`; BE-031 owns `.dockerignore`; FE-001 owns `coverage-text.ts`. The crawler enforces its time limit during a page load (BE-003, product fix, test bound unchanged). The signed-in test gets a bigger budget (QA-003). QA-003 also fixes the remaining port clashes and splits the suite into vitest projects `unit` and `browser`; CHK-NODE-UNIT runs `unit`, new mandatory CHK-NODE-BROWSER runs `browser`, each with 3600 s. The developer pauses OneDrive syncing during long test runs.
- Consequences: re-approval of PLAN-001; BE-002 and QA-003 are re-dispatched to finish.
- Alternatives considered: widening the crawler test bound; capping the signed-in test's points; one 60-minute suite check.
