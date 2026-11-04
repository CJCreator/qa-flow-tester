import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SourceLocator } from '../src/source-locator.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'path';

// A tiny source tree in a temp folder (no fixture site): one component that carries the test id,
// plus a node_modules copy the locator must skip.
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'source-locator-'));
  await mkdir(path.join(root, 'src', 'screens'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'screens', 'Editor.tsx'),
    ['export function Editor() {', '  return <button data-testid="save-btn">Save</button>;', '}', ''].join('\n')
  );
  await mkdir(path.join(root, 'node_modules', 'lib'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', 'lib', 'index.js'), '<i data-testid="vendored-only"></i>\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('SourceLocator', () => {
  it('locates data-testid inside source files', async () => {
    const result = await new SourceLocator(root).findByTestId('save-btn');
    expect(result).toBeDefined();
    expect(result!.file).toContain('Editor.tsx');
    expect(result!.line).toBe(2);
    expect(result!.matchSnippet).toContain('save-btn');
  });

  it('skips node_modules', async () => {
    expect(await new SourceLocator(root).findByTestId('vendored-only')).toBeUndefined();
  });

  it('returns undefined if test-id is not found', async () => {
    expect(await new SourceLocator(root).findByTestId('non-existent-element-xyz-999')).toBeUndefined();
  });
});
