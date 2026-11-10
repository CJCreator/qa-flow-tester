# T-104: Plan approval checks screen sizes and uses the shared error redaction

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | S | runner | inconsistency | todo |

**Files you may edit (no others):**
- `packages/runner/src/routes/plan.ts`
- `packages/runner/tests/plan-routes.test.ts`

**Do not build in parallel with:** T-102, T-109 (edit `routes/plan.ts`).

## Problem

A. `POST` approve stores `body.breakpoints` unchecked. `PATCH` on the same Plan filters sizes to `375px`, `768px`, `1440px`. A bad value sent to approve reaches the orchestrator.

B. `redactError` in `routes/plan.ts` is an older copy of `redactedMessage` in `session/checkup-run.ts`. The copy does not strip cookie values or the target address's own query values the way the shared one does.

## Current code

`packages/runner/src/routes/plan.ts:377-378` (the PATCH handler, correct)

```ts
  const sizes = (body.screenSizes || []).filter((s): s is Breakpoint => ['375px', '768px', '1440px'].includes(s));
  if (sizes.length > 0) record.context.breakpoints = sizes;
```

`packages/runner/src/routes/plan.ts:1000-1002` (the approve handler)

```ts
  if (body?.breakpoints) {
    record.context.breakpoints = body.breakpoints as Breakpoint[];
  }
```

`packages/runner/src/routes/plan.ts:198-215`

```ts
function redactError(err: unknown, record: StoredPlanRecord, session: CheckupSession): string {
  const raw = err instanceof Error ? err.message : String(err);
  const secrets: Array<Partial<RoleCredential>> = [...(record.context.profile?.roles || [])];
  const customHeaders = record.context.customHeaders || session.secrets.headers;
  if (customHeaders) {
    for (const val of Object.values(customHeaders)) {
      if (typeof val === 'string' && val.length >= 3) secrets.push({ token: val });
    }
  }
  const tunnelAuth = record.context.tunnelAuth || session.secrets.tunnelAuth;
  if (tunnelAuth && tunnelAuth.length >= 3) secrets.push({ token: tunnelAuth });
  const redactor = new Redactor(secrets);
  let out = redactor.text(raw);
  out = redactUrl(out);
  out = out.replace(/(https?:\/\/[^\s"'<>)]+)\?[^\s"'<>)]*/gi, '$1');
  return out;
}
```

It has one caller, at line 573: `error: redactError(err, record, session),`.

The shared function, `packages/runner/src/session/checkup-run.ts:285`:

```ts
export function redactedMessage(
  err: unknown,
  extra?: {
    roles?: Array<Partial<RoleCredential>>;
    customHeaders?: Record<string, string>;
    tunnelAuth?: string;
    cookies?: Array<{ name?: string; value?: string }>;
    targetUrl?: string;
  }
): string {
```

## Change

1. Replace the approve block with:

```ts
  // Only the three sizes the tool tests at, the same rule as PATCH.
  const approvedSizes = (Array.isArray(body?.breakpoints) ? body.breakpoints : []).filter(
    (s): s is Breakpoint => ['375px', '768px', '1440px'].includes(s)
  );
  if (approvedSizes.length > 0) record.context.breakpoints = approvedSizes;
```

2. Replace the whole body of `redactError` with:

```ts
function redactError(err: unknown, record: StoredPlanRecord, session: CheckupSession): string {
  return redactedMessage(err, {
    roles: record.context.profile?.roles,
    customHeaders: record.context.customHeaders || session.secrets.headers,
    tunnelAuth: record.context.tunnelAuth || session.secrets.tunnelAuth,
    targetUrl: record.context.targetUrl,
  });
}
```

3. Import `redactedMessage`: find the existing import from `'../session/checkup-run.js'` in `plan.ts` and add `redactedMessage` to it. If there is none, add `import { redactedMessage } from '../session/checkup-run.js';`.

4. Run `pnpm build`. If `Redactor` or `redactUrl` are now unused in `plan.ts`, remove them from their import lines. If the build reports a circular-import error at runtime in tests, revert step 2 and 3 only, keep step 1, and say so in your notes.

## Tests

Edit `packages/runner/tests/plan-routes.test.ts`. Copy the setup of an existing approve test (search for `/approve`).

Add `'approve ignores screen sizes the tool does not test at'`: approve with body `{ breakpoints: ['375px', '9999px', 'x'] }`. Expect the stored record's `context.breakpoints` to equal `['375px']`.

Add `'approve keeps the Plan sizes when none sent is valid'`: approve with `{ breakpoints: ['bogus'] }`. Expect `context.breakpoints` unchanged from before the call.

Run: `pnpm exec vitest run packages/runner/tests/plan-routes.test.ts`, then `pnpm build`.

## Done when

- [ ] Approve stores only `375px`, `768px`, `1440px`.
- [ ] `redactError` delegates to `redactedMessage`.
- [ ] Tests and `pnpm build` pass.

## Notes

- `record.context.targetUrl` exists on the stored Plan context; if the build says it does not, pass `record.plan.targetUrl` instead.
