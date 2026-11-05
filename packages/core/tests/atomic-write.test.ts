import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { writeJsonAtomic, readJsonSafe, purgeStaleTempFiles, STALE_TEMP_MS } from '../src/atomic-write.js';

describe('atomic-write (writeJsonAtomic and readJsonSafe)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-write-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('writes json atomically and reads it safely', async () => {
    const target = path.join(tmpDir, 'test.json');
    const data = { hello: 'world', schemaVersion: 1 };

    await writeJsonAtomic(target, data);

    const result = await readJsonSafe<typeof data>(target);
    expect(result.data).toEqual(data);
    expect(result.readOnly).toBe(false);
    expect(result.version).toBe(1);
  });

  it('handles missing file gracefully', async () => {
    const target = path.join(tmpDir, 'missing.json');
    const result = await readJsonSafe(target);
    expect(result.data).toBeNull();
    expect(result.corrupt).toBeUndefined();
  });

  it('leaves original file intact and cleans up temp file when rename fails (kill simulation)', async () => {
    const target = path.join(tmpDir, 'target.json');
    const original = { initial: 'data', schemaVersion: 1 };
    await writeJsonAtomic(target, original);

    // Spy on fs.rename to simulate crash / error
    const originalRename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async () => {
      throw new Error('SIMULATED_RENAME_FAILURE');
    });

    await expect(writeJsonAtomic(target, { updated: 'data' })).rejects.toThrow('SIMULATED_RENAME_FAILURE');

    // Restore rename
    vi.restoreAllMocks();

    // Original file intact
    const content = JSON.parse(await fs.readFile(target, 'utf8'));
    expect(content).toEqual(original);

    // No temp files left
    const files = await fs.readdir(tmpDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp-'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('backs up corrupt file to .corrupt-<timestamp> and returns null, preserving backup across subsequent writes', async () => {
    const target = path.join(tmpDir, 'corrupt.json');
    // Truncate / corrupt JSON
    await fs.writeFile(target, '{"truncated": true, "broken": ', 'utf8');

    let warningLogged = '';
    const result = await readJsonSafe(target, {
      logWarning: (msg) => {
        warningLogged = msg;
      },
    });

    expect(result.data).toBeNull();
    expect(result.corrupt).toBe(true);
    expect(warningLogged).toContain('corrupt');

    // Check that .corrupt-* file was created
    const files = await fs.readdir(tmpDir);
    const corruptCopies = files.filter((f) => f.startsWith('corrupt.json.corrupt-'));
    expect(corruptCopies.length).toBeGreaterThanOrEqual(1);

    const corruptBackupPath = path.join(tmpDir, corruptCopies[0]);
    const corruptContent = await fs.readFile(corruptBackupPath, 'utf8');
    expect(corruptContent).toBe('{"truncated": true, "broken": ');

    // Subsequent write should not overwrite or delete the corrupt backup
    const newData = { recovered: true, schemaVersion: 1 };
    await writeJsonAtomic(target, newData);

    const filesAfter = await fs.readdir(tmpDir);
    expect(filesAfter).toContain(corruptCopies[0]);
    expect(await fs.readFile(corruptBackupPath, 'utf8')).toBe('{"truncated": true, "broken": ');

    const readAgain = await readJsonSafe(target);
    expect(readAgain.data).toEqual(newData);
  });

  it('marks readOnly: true when schemaVersion is greater than currentVersion', async () => {
    const target = path.join(tmpDir, 'future.json');
    await writeJsonAtomic(target, { future: true, schemaVersion: 99 });

    let warningLogged = '';
    const result = await readJsonSafe<{ future: boolean }>(target, {
      currentVersion: 1,
      logWarning: (msg) => {
        warningLogged = msg;
      },
    });

    expect(result.data).toEqual({ future: true, schemaVersion: 99 });
    expect(result.readOnly).toBe(true);
    expect(result.version).toBe(99);
    expect(warningLogged).toContain('newer than supported');
  });

  it('defaults schemaVersion: 0 for documents without schemaVersion', async () => {
    const target = path.join(tmpDir, 'legacy.json');
    await fs.writeFile(target, JSON.stringify({ legacy: true }), 'utf8');

    const result = await readJsonSafe(target);
    expect(result.data).toEqual({ legacy: true });
    expect(result.readOnly).toBe(false);
    expect(result.version).toBe(0);
  });
});

describe('atomic-write fsync and stale temp purge (R6)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-fsync-test-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('flushes the temp file to disk (fsync) before renaming it over the target', async () => {
    const target = path.join(tmpDir, 'synced.json');
    const realOpen = fs.open.bind(fs);
    const syncSpy = vi.fn();
    vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const fh = await realOpen(...args);
      const realSync = fh.sync.bind(fh);
      fh.sync = async () => {
        syncSpy();
        return realSync();
      };
      return fh;
    });

    await writeJsonAtomic(target, { a: 1 });

    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ a: 1 });
  });

  it('purges temp files of this file older than the threshold, and keeps fresh and foreign ones', async () => {
    const target = path.join(tmpDir, 'plan.json');
    const now = Date.now();
    const old = `plan.json.tmp-4242-${now - STALE_TEMP_MS - 5000}-abc123`;
    const fresh = `plan.json.tmp-4242-${now - 1000}-abc123`;
    const otherFile = `other.json.tmp-4242-${now - STALE_TEMP_MS - 5000}-abc123`;
    const notPattern = 'plan.json.tmp-notes.txt';
    for (const name of [old, fresh, otherFile, notPattern]) {
      await fs.writeFile(path.join(tmpDir, name), 'partial', 'utf8');
    }

    const removed = await purgeStaleTempFiles(target, now);

    expect(removed).toBe(1);
    const left = (await fs.readdir(tmpDir)).sort();
    expect(left).toEqual([fresh, notPattern, otherFile].sort());
  });

  it('a write removes a stale temp left by a crashed earlier write', async () => {
    const target = path.join(tmpDir, 'state.json');
    const stale = `state.json.tmp-999-${Date.now() - STALE_TEMP_MS - 60000}-zzz999`;
    await fs.writeFile(path.join(tmpDir, stale), 'half', 'utf8');

    await writeJsonAtomic(target, { ok: true });

    const files = await fs.readdir(tmpDir);
    expect(files).not.toContain(stale);
    expect(files).toContain('state.json');
  });

  it('purge never throws when the folder does not exist', async () => {
    await expect(purgeStaleTempFiles(path.join(tmpDir, 'missing', 'x.json'))).resolves.toBe(0);
  });
});
