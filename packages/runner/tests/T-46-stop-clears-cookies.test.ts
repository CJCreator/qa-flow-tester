import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sessionDir = path.join(here, '..', 'src', 'session');
const read = (name: string) => readFileSync(path.join(sessionDir, name), 'utf8');

describe('T-46 sign-in is cleared once execution begins', () => {
  it('testing finally clears savedSessions and the auth folder on every exit, with no awaiting-review exception', () => {
    const src = read('checkup-run-testing.ts');
    const finallyBlock = src.slice(src.indexOf('const executeTesting'));
    expect(finallyBlock).toContain('session.secrets.savedSessions.delete(runId)');
    expect(finallyBlock).toContain('await session.secrets.clean(runId)');
    expect(finallyBlock).not.toContain('keptForReview');
  });

  it('execute-run finally keeps sign-in only before testing has begun', () => {
    const src = read('checkup-run-execute.ts');
    expect(src).toContain('let testingBegun = false;');
    expect(src.match(/testingBegun = true;/g)?.length).toBe(2);
    expect(src).toMatch(/!testingBegun && session\.run\.phase === 'awaiting-review'/);
  });

  it('stop during testing clears the run sign-in before the plan is kept for review', () => {
    const src = read('checkup-run.ts');
    const stop = src.slice(src.indexOf('async function stopRun'));
    const clearAt = stop.indexOf('session.secrets.savedSessions.delete(runId)');
    const keptAt = stop.indexOf("session.run.setPhase('awaiting-review')");
    expect(clearAt).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(keptAt);
    expect(stop).toContain('await session.secrets.clean(runId)');
  });
});
