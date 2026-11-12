import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { isQaToolRepo } from '../src/source-locator.js';

let dir = '';
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = '';
});

describe('isQaToolRepo', () => {
  it('is true for a folder holding the tool core source', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-repo-'));
    await fs.mkdir(path.join(dir, 'packages', 'core', 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, 'packages', 'core', 'src', 'orchestrator.ts'), '');
    expect(isQaToolRepo(dir)).toBe(true);
  });
  it('is false for any other folder', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-app-'));
    await fs.writeFile(path.join(dir, 'index.html'), '<div data-testid="x"></div>');
    expect(isQaToolRepo(dir)).toBe(false);
  });
});
