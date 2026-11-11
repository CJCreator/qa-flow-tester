# T-243: One ZIP writer: the Playwright export uses `writeZip`

| Priority | Size | Area | Type | Status |
|---|---|---|---|---|
| P3 | S | core | duplication | todo |

**Files you may edit (no others):**

- `packages/core/src/plan/zip.ts`
- `packages/core/tests/playwright-export.test.ts`

**Do not build in parallel with:** nothing.

## Problem

Core has two ZIP writers. `plan/zip.ts` (`zipFiles`, with its own CRC-32 table) builds the Playwright export. `audit/documents/zip.ts` (`writeZip`, on `node:zlib`) builds the Word and export-bundle archives, and it also cleans entry names so an archive cannot write outside the folder it is unpacked into. The second one is safer and shorter. `zipFiles` has no name check.

## Current code

Branch from `main`. `packages/core/src/plan/zip.ts` is 83 lines: an interface, a CRC table, `crc32`, and `zipFiles`.

```ts
export interface ZipEntry {
  path: string;
  content: string;
}
...
export function crc32(data: Uint8Array): number { ... }
...
export function zipFiles(files: ZipEntry[]): Buffer { ... }
```

`packages/core/src/audit/documents/zip.ts` exports `writeZip(entries: ZipFileEntry[]): Buffer` where `ZipFileEntry` is `{ name: string; data: Uint8Array | string }`. It sorts entries by name, deflates when that is smaller, and throws on a duplicate name.

Users of `plan/zip.ts` (check with `grep -rn "plan/zip\|zipFiles\|crc32" packages --include=*.ts --exclude-dir=node_modules --exclude-dir=dist`):

- `packages/runner/src/routes/plan.ts`: `zipFiles(planToPlaywrightProject(record.plan))` (keep the name `zipFiles`, so no runner edit).
- `packages/core/src/index.ts`: `export * from './plan/zip.js';` (no edit needed).
- `packages/core/tests/playwright-export.test.ts`: imports `{ zipFiles, crc32 }` from `../src/plan/zip.js`.

## Change

1. Replace the whole of `packages/core/src/plan/zip.ts` with:

```ts
import { writeZip } from '../audit/documents/zip.js';

export interface ZipEntry {
  path: string;
  content: string;
}

/** A ZIP of text files, written by the one ZIP writer (`writeZip`): sorted names, safe paths, same bytes for the same files. */
export function zipFiles(files: ZipEntry[]): Buffer {
  return writeZip(files.map((f) => ({ name: f.path, data: f.content })));
}
```

`crc32` is no longer exported from here. Only the test used it.

2. In `playwright-export.test.ts`: change the import line `import { zipFiles, crc32 } from '../src/plan/zip.js';` to `import { zipFiles } from '../src/plan/zip.js';` and add `import { crc32, inflateRawSync } from 'node:zlib';` with the other imports.

3. In the same test file, replace the test `'export zip has a valid central directory and correct crc32 per file'` with the test in the Tests section. `writeZip` sorts names and deflates, so the old test (which read stored data in input order) no longer fits.

4. Run `pnpm exec prettier --write packages/core/src/plan/zip.ts packages/core/tests/playwright-export.test.ts`, then `pnpm build`.

## Tests

Replacement test in `packages/core/tests/playwright-export.test.ts`:

```ts
it('export zip is a valid archive holding every file unchanged', () => {
  const files = planToPlaywrightProject(planOf([tc()]));
  const zip = zipFiles(files);
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  expect(count).toBe(files.length);
  let p = zip.readUInt32LE(eocd + 16);
  expect(p + zip.readUInt32LE(eocd + 12)).toBe(eocd);
  const found = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const packed = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(body) : body;
    expect(data.length).toBe(size);
    expect(crc32(data) >>> 0).toBe(crc);
    found.set(name, data.toString('utf8'));
    p += 46 + nameLen;
  }
  expect([...found.keys()].sort()).toEqual(files.map((f) => f.path).sort());
  for (const f of files) expect(found.get(f.path)).toBe(f.content);
});
```

Also delete the last line of the old test, `expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);`, together with the old test (it checked the removed hand-written CRC).

Keep the test `'export is byte-identical for the same Plan'` as it is. It must still pass.

Run: `pnpm exec vitest run packages/core/tests/playwright-export.test.ts packages/core/tests/audit-doc-export.test.ts`, then `pnpm build`.

## Done when

- [ ] `packages/core/src/plan/zip.ts` has no `CRC_TABLE` and no `Buffer.alloc`: `grep -c "CRC_TABLE\|Buffer.alloc" packages/core/src/plan/zip.ts` prints 0.
- [ ] `grep -rn "crc32" packages --include=*.ts --exclude-dir=node_modules --exclude-dir=dist` shows no import of `crc32` from a `plan/zip` path.
- [ ] The two test files pass; `pnpm build` passes.

## Notes

- The download is now smaller (deflate) and its files are sorted by name. Playwright and `unzip` read both. Nothing in the repo reads the order.
- `writeZip` throws if a file name is empty after cleaning, or if two files end up with the same name. `planToPlaywrightProject` never makes either.
- `sanitizeEntryName` replaces `:` and `?` in a name with `_`. The export's names (`package.json`, `tests/....spec.ts`) have none.
