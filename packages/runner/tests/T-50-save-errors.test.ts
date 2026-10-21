import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (file: string) => readFileSync(path.join(here, '..', 'src', file), 'utf8');

describe('T-50 save errors are shown, not swallowed', () => {
  // The run code is split across checkup-run*.ts: read them as one text.
  const checkupRun = ['checkup-run.ts', 'checkup-run-execute.ts', 'checkup-run-testing.ts', 'checkup-run-helpers.ts']
    .map((f) => src(path.join('session', f)))
    .join('\n');

  it('a failed plan save shows "Couldn\'t save the plan. Try again." to the wizard', () => {
    expect(checkupRun).toContain("Couldn't save the plan. Try again.");
    expect(checkupRun).toContain('session.report.setError(');
    expect(checkupRun).toContain('PLAN_SAVE_FAILED');
  });

  it('no plan save is swallowed with an empty catch', () => {
    expect(checkupRun).not.toMatch(/plan\.save\([^)]*\)\.catch\(\(\) => \{\}\)/);
  });

  it('a failed site memory save is reported on the report', () => {
    expect(checkupRun).not.toMatch(/saveSiteMemory\([^)]*\)\.catch\(\(\) => \{\}\)/);
  });
});

describe('T-50 scheduler file is written atomically and never read as []', () => {
  const scheduler = src('scheduler.ts');

  it('saves through writeJsonAtomic (temp file, fsync, rename)', () => {
    expect(scheduler).toContain('writeJsonAtomic(this.schedulesFile, schedules)');
    expect(scheduler).not.toMatch(/fs\.writeFile\(this\.schedulesFile/);
  });

  it('loadSchedules has no catch that returns an empty list', () => {
    const start = scheduler.indexOf('async loadSchedules(');
    const end = scheduler.indexOf('async saveSchedules(', start);
    const body = scheduler.slice(start, end);
    expect(body).not.toMatch(/catch/);
    expect(body).toContain('.corrupt');
  });

  it('every change to the schedules file goes through the shared queue', () => {
    for (const name of ['addSchedule(', 'deleteSchedule(', 'toggleSchedule(']) {
      const start = scheduler.indexOf(name);
      expect(scheduler.slice(start, start + 200)).toContain('this.exclusive(');
    }
  });
});
