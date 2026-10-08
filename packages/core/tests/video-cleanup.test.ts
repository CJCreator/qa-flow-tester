import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { removeVideosExcept } from '../src/orchestrator.js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

describe('removeVideosExcept', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-video-cleanup-'));
    await fs.writeFile(path.join(dir, 'main.webm'), 'a');
    await fs.writeFile(path.join(dir, 'probe.webm'), 'b');
    await fs.writeFile(path.join(dir, 'step-1.png'), 'c');
    await fs.writeFile(path.join(dir, 'notes.json'), '{}');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('removes every video when none is kept (passed point)', async () => {
    await removeVideosExcept(dir);
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.webm'))).toEqual([]);
  });

  it('keeps exactly the named video (failed point)', async () => {
    await removeVideosExcept(dir, path.join(dir, 'main.webm'));
    expect((await fs.readdir(dir)).filter((f) => f.endsWith('.webm'))).toEqual(['main.webm']);
  });

  it('leaves screenshots and other files alone', async () => {
    await removeVideosExcept(dir);
    expect((await fs.readdir(dir)).sort()).toEqual(['notes.json', 'step-1.png']);
  });

  it('does not throw when the folder is missing', async () => {
    await expect(removeVideosExcept(path.join(dir, 'nope'))).resolves.toBeUndefined();
  });
});
