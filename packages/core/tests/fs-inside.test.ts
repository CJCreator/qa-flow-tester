import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { isInside, resolveInside } from '../src/fs-inside.js';

const root = path.resolve('/a/b');

describe('isInside', () => {
  it('accepts a file or folder below the parent', () => {
    expect(isInside(root, path.join(root, 'c', 'd.png'))).toBe(true);
  });
  it('refuses the folder itself, a sibling and the parent above', () => {
    expect(isInside(root, root)).toBe(false);
    expect(isInside(root, path.resolve('/a/c'))).toBe(false);
    expect(isInside(root, path.resolve('/a'))).toBe(false);
    expect(isInside(root, path.resolve('/a/bc'))).toBe(false);
  });
  it('accepts names that only start with two dots', () => {
    expect(isInside(root, path.join(root, '..notes'))).toBe(true);
    expect(isInside(root, path.join(root, 'a', '..b'))).toBe(true);
    expect(isInside(root, path.join(root, '..'))).toBe(false);
  });
  it('normalises ../ steps and both separators', () => {
    expect(isInside(root, path.join(root, '..', 'x'))).toBe(false);
    expect(isInside(root, path.join(root, 'a', '..', '..', 'x'))).toBe(false);
    expect(isInside(root, root + '/c/../d')).toBe(true);
    // A backslash is a separator only on Windows; on POSIX it is part of a file name.
    expect(isInside(root, root + '\\..\\x')).toBe(process.platform !== 'win32');
  });
  it.runIf(process.platform === 'win32')('refuses another drive', () => {
    expect(isInside('C:\\a\\b', 'D:\\a\\b\\c')).toBe(false);
  });
});

describe('resolveInside', () => {
  it('returns the resolved path for a safe relative path', () => {
    expect(resolveInside(root, 'phone/x.png')).toBe(path.join(root, 'phone', 'x.png'));
    expect(resolveInside(root, '..notes')).toBe(path.join(root, '..notes'));
    expect(resolveInside(root, 'a/..b')).toBe(path.join(root, 'a', '..b'));
  });
  it('returns null when it leaves the folder', () => {
    expect(resolveInside(root, '../x')).toBeNull();
    expect(resolveInside(root, '..')).toBeNull();
    expect(resolveInside(root, 'a/../../x')).toBeNull();
    expect(resolveInside(root, '')).toBeNull();
    expect(resolveInside(root, path.resolve('/etc/passwd'))).toBeNull();
  });
});
