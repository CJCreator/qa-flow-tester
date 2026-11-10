# T-163: plain-HTTP finding is raised for an App on a local network address

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P1 | S | checkers | bug | todo |

**Files you may edit (no others):**
- `packages/checkers/src/security-depth.ts`
- `packages/checkers/tests/security-depth.test.ts`

**Do not build in parallel with:** T-177 (same source file).

## Problem
`SecurityDepthChecker.checkTls` reports a Major "Connection is not encrypted with TLS (plain HTTP)" for every `http:` page except `localhost`, `127.0.0.1` and `*.local`. A local Check-up may run against an App on the same network or another loopback form. `http://192.168.1.20:3000`, `http://10.0.0.5`, `http://[::1]:3000` and `http://app.localhost:3000` all get the finding, although no production traffic is involved.

## Current code
`packages/checkers/src/security-depth.ts:437-443` (branch `worktree-audit-cleanup`)
```ts
  checkTls(pageUrl: string, context: SecurityDepthContext): Finding[] {
    const findings: Finding[] = [];
    try {
      const u = new URL(pageUrl);
      const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname.endsWith('.local');
      if (u.protocol === 'http:' && !isLocal) {
```

## Change
1. Add this function at module level in `packages/checkers/src/security-depth.ts` (for example just above `async function collectResources`):
```ts
/** A host on this computer or a private network: plain HTTP there is a development set-up, not a fault. */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0.0.0.0') return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
```
2. Replace the `const isLocal = ...` line with:
```ts
      const isLocal = isLocalNetworkHost(u.hostname);
```

## Tests
Edit `packages/checkers/tests/security-depth.test.ts`. Import `isLocalNetworkHost` from `'../src/security-depth.js'` (add it to the existing import from that module). Add:

1. `isLocalNetworkHost` table:
   - true: `localhost`, `app.localhost`, `printer.local`, `127.0.0.1`, `127.5.5.5`, `0.0.0.0`, `[::1]`, `::1`, `10.0.0.5`, `172.16.0.1`, `172.31.255.1`, `192.168.1.20`
   - false: `example.com`, `172.32.0.1`, `172.15.0.1`, `192.169.1.1`, `11.0.0.1`, `localhost.example.com`
2. `checkTls`: build the checker the way the file's other tests do (`new SecurityDepthChecker()`) and a context copied from an existing test in the file.
   - `checker.checkTls('http://192.168.1.20:3000/', ctx)` returns `[]`.
   - `checker.checkTls('http://[::1]:3000/', ctx)` returns `[]`.
   - `checker.checkTls('http://example.com/', ctx)` returns one finding whose title contains `not encrypted with TLS`.
   - `checker.checkTls('https://example.com/', ctx)` returns `[]`.

Run: `pnpm exec vitest run packages/checkers/tests/security-depth.test.ts`

## Done when
- [ ] New tests pass; existing tests in `security-depth.test.ts` pass unchanged.
- [ ] `pnpm build` passes.

## Notes
- `URL.hostname` for an IPv6 address includes the brackets (`[::1]`); the function strips them.
- Do not import a helper from `@qa/core`: `@qa/checkers` must not depend on core.
