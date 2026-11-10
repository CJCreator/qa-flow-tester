# T-92: Serve scanned-site HTML evidence sandboxed

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P0 | S | runner | security | todo |

**Files you may edit (no others):**
- `packages/runner/src/evidence-file.ts`
- `packages/runner/src/server.ts`
- `packages/runner/tests/evidence-file.test.ts`

**Do not build in parallel with:** T-91, T-94, T-96, T-97, T-99, T-100, T-106, T-108, T-110, T-112 (all edit `server.ts`).

## Problem

A Check-up saves raw DOM snapshots of the scanned site as `step-N-*.html` (scripts included). `GET /api/evidence/...` serves them as `text/html` from the runner's own origin with no `Content-Security-Policy` and no `X-Content-Type-Options`.

Scenario: the owner opens a snapshot link. The scanned site's scripts run on the runner's origin and can call the runner API with the owner's access cookie.

## Current code

`packages/runner/src/evidence-file.ts:42-61` (branch `worktree-audit-cleanup`)

```ts
export function sendEvidenceFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
  stat: Pick<Stats, 'size' | 'mtimeMs'>,
  contentType: string
): void {
  const etag = evidenceEtag(stat);
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
  if (isNotModified(req, etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Type': contentType, 'Content-Length': stat.size });
  const stream = createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
```

`packages/runner/src/server.ts:1486` (the only caller)

```ts
              sendEvidenceFile(req, res, targetFile, stat, evidenceContentType(path.extname(targetFile)));
```

## Change

1. In `evidence-file.ts`, add `import path from 'path';` under the existing imports.

2. Add this exported function above `sendEvidenceFile`:

```ts
/** The tool's own HTML files. Every other .html under the output folder is a snapshot of the scanned site. */
const OWN_HTML = new Set(['report.html', 'issues.html']);

/**
 * Extra headers for an evidence file. A snapshot of the scanned site is sandboxed: its scripts must not run
 * on the runner's origin, where they could call the API with the owner's cookie.
 */
export function evidenceSafetyHeaders(filePath: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  const name = path.basename(filePath).toLowerCase();
  if (name.endsWith('.html') && !OWN_HTML.has(name)) headers['Content-Security-Policy'] = 'sandbox';
  return headers;
}
```

3. In `sendEvidenceFile`, replace the `const headers = ...` line with:

```ts
  const headers = { ETag: etag, 'Cache-Control': 'no-cache', ...evidenceSafetyHeaders(filePath) };
```

4. `server.ts` needs no change unless the build fails. Do not change the route.

## Tests

Edit `packages/runner/tests/evidence-file.test.ts`. Import `evidenceSafetyHeaders` beside the existing imports from `../src/evidence-file.js`. Add:

```ts
describe('evidenceSafetyHeaders', () => {
  it('sandboxes a snapshot of the scanned site', () => {
    expect(evidenceSafetyHeaders('/out/runs/r1/step-3-after.html')).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    });
  });
  it("leaves the tool's own report pages unsandboxed", () => {
    expect(evidenceSafetyHeaders('/out/runs/r1/report.html')).toEqual({ 'X-Content-Type-Options': 'nosniff' });
    expect(evidenceSafetyHeaders('/out/runs/r1/issues.html')).toEqual({ 'X-Content-Type-Options': 'nosniff' });
  });
  it('adds nosniff to images', () => {
    expect(evidenceSafetyHeaders('/out/runs/r1/shot.png')).toEqual({ 'X-Content-Type-Options': 'nosniff' });
  });
});
```

If the file already has a test of `sendEvidenceFile` that checks the exact header object, add the new headers to its expectation.

Run: `pnpm exec vitest run packages/runner/tests/evidence-file.test.ts`, then `pnpm build`.

## Done when

- [ ] `step-*.html` evidence is answered with `Content-Security-Policy: sandbox`.
- [ ] `report.html` and `issues.html` are not sandboxed.
- [ ] Every evidence reply has `X-Content-Type-Options: nosniff`.
- [ ] Tests and `pnpm build` pass.

## Notes

- `report.html` uses inline scripts and must keep working, which is why it is excluded.
- Out of scope: changing how core writes the snapshots.
