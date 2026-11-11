import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NOTHING_STOPPED, stopProblem } from '../src/lib/stop-result';

describe('stopProblem', () => {
  it('gives null when aborted is true', () => {
    expect(stopProblem({ aborted: true })).toBeNull();
  });

  it('gives null when aborted is false and finishing is true', () => {
    expect(stopProblem({ aborted: false, finishing: true })).toBeNull();
  });

  it('gives NOTHING_STOPPED when aborted is false and no error or finishing', () => {
    expect(stopProblem({ aborted: false })).toBe(NOTHING_STOPPED);
  });

  it('gives the error text when aborted is false and an error is provided', () => {
    const error = 'Release check-up couldn’t stop the check-up. Try again.';
    expect(stopProblem({ aborted: false, error })).toBe(error);
  });

  it('gives NOTHING_STOPPED when aborted is false and planKept is true', () => {
    expect(stopProblem({ aborted: false, planKept: true })).toBe(NOTHING_STOPPED);
  });
});

describe('App.tsx stop handling source check', () => {
  it('contains stopProblem(result) and no longer contains if (result.aborted) {', () => {
    const appSource = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');
    expect(appSource).toContain('stopProblem(result)');
    expect(appSource).not.toContain('if (result.aborted) {');
  });
});
