# T-222: Config docs: add `PAGESPEED_API_KEY`, remove `WIZARD_SCREENSHOTS`, drop an undocumented alias

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | docs | docs | todo |

**Files you may edit (no others):**
- `docs/CONFIGURATION.md`
- `.env.example`
- `scripts/smoke-audit.mjs` (lines 11 and 40 only)

**Do not build in parallel with:** none.

## Problem
1. **`PAGESPEED_API_KEY` is read but documented nowhere.** `packages/core/src/ai/key-resolver.ts:23` maps the
   `pagespeed` service key to it, and `resolveServiceKey` (line 153) reads `process.env[...]` as the last
   fallback after the OS keychain and the key file. `packages/runner/tests/config-docs.test.ts` does not catch
   it because the name is read through a lookup table, not as `process.env.PAGESPEED_API_KEY`.
2. **`WIZARD_SCREENSHOTS` is documented but read by nothing.** `docs/CONFIGURATION.md:198` itself says "Listed
   in `.env.example` but read by no code today". The test it belonged to (`wizard-e2e.test.ts`) is gone.
3. **`QA_ACCESS_TOKEN` is an undocumented second name** for `RUNNER_ACCESS_TOKEN`, accepted only by
   `scripts/smoke-audit.mjs`. One name is enough.

## Current code
`docs/CONFIGURATION.md:62-66` (branch `worktree-audit-cleanup`), the table under
`## Saved Website Audits and Helper sign-in` (cells shortened with `...`)
```markdown
| Variable                    | Default                                 | Meaning ...
| --------------------------- | --------------------------------------- | ------- ...
| `AUDIT_STORE_BUCKET`        | none                                    | Cloud Storage bucket for saved Website Audits ...
| `SCHEDULER_SERVICE_ACCOUNT` | none                                    | Email of the Cloud Scheduler service account ...
| `AUDIT_OWNER_EMAILS`        | none                                    | Comma-separated Google account emails whose owner audit rows pass on a beta copy (T-86). Unset: no owner access ...
| `AUDIT_DAILY_LIMIT`         | none                                    | Daily audit starts per owner email per UTC day. Unset: no limit ...
```

`docs/CONFIGURATION.md:198`
```markdown
| `WIZARD_SCREENSHOTS`      | none                    | Listed in `.env.example` but read by no code today                                               |
```

`.env.example:116-127`
```
# Turns on screenshot capture in the wizard end-to-end test
# WIZARD_SCREENSHOTS=
# Optional: folder for the local key file qa-flow-tester/key-file.key (default %APPDATA% on Windows, else ~/.config)
# XDG_CONFIG_HOME=
# AUDIT_STORE_BUCKET=
# SCHEDULER_SERVICE_ACCOUNT=
# FIREBASE_PROJECT_ID=
# FIREBASE_WEB_API_KEY=
# FIREBASE_AUTH_DOMAIN=
# AUDIT_OWNER_EMAILS=
# AUDIT_DAILY_LIMIT=
```

`scripts/smoke-audit.mjs:11`
```js
 *   RUNNER_ACCESS_TOKEN / QA_ACCESS_TOKEN: Access token if server requires authentication
```
`scripts/smoke-audit.mjs:40`
```js
const token = process.env.RUNNER_ACCESS_TOKEN || process.env.QA_ACCESS_TOKEN || '';
```

## Change
1. `docs/CONFIGURATION.md`: add this row directly after the `AUDIT_DAILY_LIMIT` row of the
   "Saved Website Audits and Helper sign-in" table:
   ```markdown
   | `PAGESPEED_API_KEY` | none | Google PageSpeed Insights key for the Website Audit's speed step. Used only when no key is saved in Audit settings (the saved key wins). Unset and none saved: speed is measured by this tool's own browser |
   ```
2. `docs/CONFIGURATION.md`: delete the `WIZARD_SCREENSHOTS` row (line 198).
3. `.env.example`: delete the two lines
   `# Turns on screenshot capture in the wizard end-to-end test` and `# WIZARD_SCREENSHOTS=`.
4. `.env.example`: add after the line `# AUDIT_DAILY_LIMIT=`:
   ```
   # Google PageSpeed Insights key for the Website Audit's speed step (a key saved in Audit settings wins)
   # PAGESPEED_API_KEY=
   ```
5. `scripts/smoke-audit.mjs:11`: change to
   ` *   RUNNER_ACCESS_TOKEN: Access token if server requires authentication`
6. `scripts/smoke-audit.mjs:40`: change to
   `const token = process.env.RUNNER_ACCESS_TOKEN || '';`

## Tests
```
pnpm exec prettier --write docs/CONFIGURATION.md
pnpm exec vitest run packages/runner/tests/config-docs.test.ts
node --check scripts/smoke-audit.mjs
pnpm format:check
pnpm lint
```
This grep must print nothing:
```
grep -rn "WIZARD_SCREENSHOTS\|QA_ACCESS_TOKEN" docs .env.example scripts packages --include=*.md --include=*.example --include=*.mjs --include=*.ts --include=*.tsx --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=tickets
```

## Done when
- [ ] `PAGESPEED_API_KEY` is in both `docs/CONFIGURATION.md` and `.env.example`, once each.
- [ ] `WIZARD_SCREENSHOTS` and `QA_ACCESS_TOKEN` appear nowhere outside `docs/tickets/`.
- [ ] `config-docs.test.ts` passes (it requires every `.env.example` name to be documented, exactly once).

## Notes
- `.env.example` is the example file and may be read and edited. Never open or print `.env`.
- Key order in the code: OS keychain, then the key file, then the environment variable
  (`resolveServiceKey`, `packages/core/src/ai/key-resolver.ts:146-156`).
- `AIEOS_CLI` is read only inside a test; leave it undocumented.
