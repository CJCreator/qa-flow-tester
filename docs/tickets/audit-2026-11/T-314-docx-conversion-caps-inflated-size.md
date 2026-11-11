# T-314: The .docx conversion caps the inflated size, not just the declared size

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P2 | M | core | security | todo |

**Files you may edit (no others):**

- `packages/core/src/discovery/docx-to-markdown.ts`
- `packages/core/tests/docx-to-markdown.test.ts`

**Do not build in parallel with:** none.

## Problem

A Word file for the Product Context is turned into Markdown by `POST /api/runner/context/docx` (`packages/runner/src/server.ts:1258`, handler `handleContextDocx` at `:1705`). The route is open on the shared copy ("stateless; open in beta"), so anyone who can reach the hosted copy can send a file.

Before mammoth sees the file, `checkZip` (`packages/core/src/discovery/docx-to-markdown.ts:18-57`) adds up the uncompressed sizes that the ZIP's central directory **declares** and refuses more than 20 MB. Those numbers are written by whoever made the file. A 2 MB ZIP can declare 1 KB for `word/document.xml` and hold a deflate stream that inflates to about 2 GB (deflate's ratio is roughly 1000:1). `checkZip` passes it.

Suspected, not run: mammoth opens the file with JSZip. JSZip slices each entry by the central directory's compressed size and inflates it in chunks; it compares the inflated length with the declared size only after the whole entry has been inflated (the `data_length` check at the end of `getContentWorker` in `jszip/lib/compressedObject.js`). So the lie is noticed after the memory is spent. The 10-second `Promise.race` (`docx-to-markdown.ts:266-292`) rejects the request but cannot stop the inflate already running: the shared runner (2 GiB, one instance) keeps allocating. Confirm by reading `node_modules/jszip/lib/compressedObject.js` before you start; the new test below fails today either way, because it asserts the file is refused before mammoth is called.

## Current code

Branch from `main`. `packages/core/src/discovery/docx-to-markdown.ts` (`grep -n "const size = view.getUint32(pos + 24, true)\|checkZip(bytes);" packages/core/src/discovery/docx-to-markdown.ts`):

```ts
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) throw new Error(BAD_FILE);
    const size = view.getUint32(pos + 24, true);
    ...
    total += size;
```

and

```ts
export async function docxToMarkdown(bytes: Uint8Array): Promise<{ text: string; warnings: string[] }> {
  checkZip(bytes);
  const mammoth = loadMammoth();
```

## Change

1. In `docx-to-markdown.ts` add `import { inflateRawSync } from 'node:zlib';` and a new exported function below `checkZip`:

   ```ts
   /**
    * Inflates every entry once, with a hard output cap, before mammoth (JSZip) sees the file: a ZIP can declare
    * small sizes and inflate to gigabytes, and JSZip only notices after inflating. Throws a plain-sentence Error.
    * Call after checkZip, which has already checked the central directory's shape and the declared total.
    */
   export function checkInflatedSizes(bytes: Uint8Array): void
   ```

   Walk the central directory the same way `checkZip` does. For each entry read: flags (`+8`), method (`+10`), compressed size (`+20`), declared uncompressed size (`+24`), local header offset (`+42`). Then:
   - Flag bit 0 (encrypted) set: throw `BAD_FILE`.
   - At the local header offset, check the signature `0x04034b50` and bounds; the data starts at `offset + 30 + nameLength(+26) + extraLength(+28)` of the **local** header and runs for the central directory's compressed size. Out of bounds: `BAD_FILE`.
   - Method 0 (stored): the compressed size must equal the declared size, else `BAD_FILE`.
   - Method 8 (deflate): `inflateRawSync(slice, { maxOutputLength: declared + 1 })`. A thrown `RangeError` (output over the cap) or any zlib error: `BAD_FILE`. An output length other than `declared`: `BAD_FILE`. Drop the output at once (do not keep it).
   - Any other method: throw `'This Word file uses a ZIP format that is not supported. Save it again as .docx.'`.
   The declared total is already at most 20 MB (checked by `checkZip`), so the memory spent here is bounded by that.
2. In `docxToMarkdown`, call `checkInflatedSizes(bytes);` right after `checkZip(bytes);`, outside the `try` (its messages must reach the person unchanged, like `checkZip`'s).
3. Update the module's top comment: "the ZIP is checked by hand, declared and inflated sizes, before mammoth sees it".
4. Run `pnpm exec prettier --write packages/core/src/discovery/docx-to-markdown.ts packages/core/tests/docx-to-markdown.test.ts`, then `pnpm build`.

## Tests

`packages/core/tests/docx-to-markdown.test.ts`:

- Extend the test-only `buildZip`: a `ZipEntry` gets `deflate?: boolean`. When set, compress `data` with `deflateRawSync` from `node:zlib`, write method 8 at local `+8` and central `+10`, the compressed length at local `+18` and central `+20`, and keep `declaredSize ?? data.length` at central `+24` (and the real length at local `+22`). `makeDocx` passes a `deflate` flag through to every entry.
- New cases in a `describe('checkInflatedSizes')`:
  - "refuses an entry that declares 1 KB and inflates to 30 MB": `buildZip([{ name: 'word/document.xml', data: 'x'.repeat(30 * 1024 * 1024), deflate: true, declaredSize: 1024 }])`. `checkZip` does not throw; `checkInflatedSizes` throws `/could not be read/`; `docxToMarkdown` rejects with `/could not be read/`.
  - "refuses an entry whose inflated size differs from the declared size": 5,000 `a` characters, deflated, declared 4,000 → throws `/could not be read/`.
  - "refuses a stored entry whose sizes disagree": stored, `declaredSize` 10 for 3 bytes → throws.
  - "accepts an honest deflated .docx": `docxToMarkdown(makeDocx(para('Hello', 'Heading1'), [], { deflate: true }))` returns text containing `# Hello`.
- Every existing case keeps passing (stored entries with honest sizes pass the new check).

Run: `pnpm exec vitest run packages/core/tests/docx-to-markdown.test.ts packages/core/tests/audit-doc-docx.test.ts`, then `pnpm exec vitest run --project unit packages/core/tests`, then `pnpm build`.

## Done when

- [ ] `grep -n "checkInflatedSizes(bytes)" packages/core/src/discovery/docx-to-markdown.ts` shows the call right after `checkZip(bytes)`.
- [ ] `grep -n "maxOutputLength" packages/core/src/discovery/docx-to-markdown.ts` finds the capped inflate.
- [ ] The new cases and the core unit tests pass; `pnpm build` passes.

## Notes

- Audit finding M5 (audit of 11 Nov 2026 on `d225418`).
- Why not a worker thread with `resourceLimits`: it would bound memory too, but adds a worker file to the build and a start-up cost per file. The capped inflate is enough because the 2 MB input cap and the 20 MB declared cap stay in place, and mammoth then works on data whose real size is known.
- The 10-second timeout stays. It still cannot stop mammoth, but after this check mammoth only parses at most 20 MB of XML.
- `packages/runner/src/checkup.ts:357` (CI check-up, a local file) gets the same check through `docxToMarkdown`; nothing to change there.
