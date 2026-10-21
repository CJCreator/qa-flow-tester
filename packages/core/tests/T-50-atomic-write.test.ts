import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeJsonAtomic } from '../src/atomic-write.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('T-50 writeJsonAtomic durability', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-atomic-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes the value and leaves no temporary file behind', async () => {
    const file = path.join(dir, 'schedules.json');
    await writeJsonAtomic(file, [{ id: 'a' }]);
    await writeJsonAtomic(file, [{ id: 'b' }]);

    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual([{ id: 'b' }]);
    expect((await fs.readdir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });

  it('flushes the temporary file before the rename, and the folder after it', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'atomic-write.ts'), 'utf8');
    const body = src.slice(src.indexOf('export async function writeJsonAtomic'));
    const sync = body.indexOf('handle.sync()');
    const rename = body.indexOf('fs.rename(tmpFile, filePath)');
    expect(sync).toBeGreaterThan(-1);
    expect(sync).toBeLessThan(rename);
    expect(body.indexOf('await syncDir(dir)')).toBeGreaterThan(rename);
  });

  it('a failed write leaves the old file in place and no temporary file', async () => {
    const file = path.join(dir, 'data.json');
    await writeJsonAtomic(file, { ok: true });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(writeJsonAtomic(file, circular)).rejects.toThrow();

    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ ok: true });
    expect((await fs.readdir(dir)).filter((n) => n.includes('.tmp-'))).toEqual([]);
  });
});
