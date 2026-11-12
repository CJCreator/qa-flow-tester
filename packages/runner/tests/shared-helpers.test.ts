import { describe, it, expect } from 'vitest';
import path from 'path';
import { isInside } from '../src/fs-inside.js';
import { cookieFrom, readCookie } from '../src/cookies.js';

describe('isInside', () => {
  it('is true for a file below the folder', () => {
    expect(isInside(path.resolve('/a/b'), path.resolve('/a/b/c/d.png'))).toBe(true);
  });

  it('is false for the folder itself, a sibling and a parent', () => {
    expect(isInside(path.resolve('/a/b'), path.resolve('/a/b'))).toBe(false);
    expect(isInside(path.resolve('/a/b'), path.resolve('/a/c'))).toBe(false);
    expect(isInside(path.resolve('/a/b'), path.resolve('/a'))).toBe(false);
  });

  it('is false for a path that climbs out', () => {
    expect(isInside(path.resolve('/a/b'), path.resolve('/a/b/../c'))).toBe(false);
  });
});

describe('readCookie / cookieFrom', () => {
  it('reads one cookie among several', () => {
    expect(cookieFrom('a=1; qa_session=abc_-9; b=2', 'qa_session')).toBe('abc_-9');
    expect(readCookie('a=1; qa_session=abc_-9; b=2', 'qa_session')).toBe('abc_-9');
  });

  it('keeps an = inside the value and decodes it', () => {
    expect(cookieFrom('k=a%3Db', 'k')).toBe('a=b');
    expect(cookieFrom('k=x=y', 'k')).toBe('x=y');
    expect(readCookie('k=a%3Db', 'k')).toBe('a=b');
    expect(readCookie('k=x=y', 'k')).toBe('x=y');
  });

  it('is undefined when absent, empty or not decodable', () => {
    expect(cookieFrom(undefined, 'k')).toBeUndefined();
    expect(cookieFrom('', 'k')).toBeUndefined();
    expect(cookieFrom('j=1', 'k')).toBeUndefined();
    expect(cookieFrom('k=%E0%A4%A', 'k')).toBeUndefined();

    expect(readCookie(undefined, 'k')).toBeUndefined();
    expect(readCookie('', 'k')).toBeUndefined();
    expect(readCookie('j=1', 'k')).toBeUndefined();
    expect(readCookie('k=%E0%A4%A', 'k')).toBeUndefined();
  });
});
