import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_POLL_INTERVAL_MS, nextCheckDelayMs, POLL_INTERVAL_MS } from '../src/hooks/useRunnerConnection';
import { reconnectDelayMs } from '../src/hooks/useRunnerStream';

const read = (file: string) => readFileSync(resolve(__dirname, '..', file), 'utf8');

describe('stream reconnect waits', () => {
  it('waits 2 s, 4 s, 8 s, then 30 s, and stays at 30 s', () => {
    expect([0, 1, 2, 3, 4, 9].map(reconnectDelayMs)).toEqual([2000, 4000, 8000, 30000, 30000, 30000]);
  });
});

describe('runner connection checks back off while the runner is absent', () => {
  it('doubles the pause after each miss and caps it at 30 s', () => {
    expect(POLL_INTERVAL_MS).toBe(3000);
    expect(MAX_POLL_INTERVAL_MS).toBe(30000);
    expect([1, 2, 3, 4, 5, 6].map(nextCheckDelayMs)).toEqual([3000, 6000, 12000, 24000, 30000, 30000]);
  });

  it('never waits longer than 30 s between checks', () => {
    for (let misses = 1; misses < 50; misses++) {
      expect(nextCheckDelayMs(misses)).toBeLessThanOrEqual(30000);
    }
  });
});

describe('an idle wizard polls the runner at most every 30 s', () => {
  const app = read('src/App.tsx');

  it('keeps the 5 s poll for a check-up in progress and uses 30 s when idle', () => {
    expect(app).toMatch(/const POLL_MS = 5000;/);
    expect(app).toMatch(/const IDLE_POLL_MS = 30000;/);
    expect(app).toMatch(/setInterval\(\(\) => void reconcile\(\), inProgress \? POLL_MS : IDLE_POLL_MS\)/);
  });
});

describe('the first load ships only the first screen', () => {
  const app = read('src/App.tsx');

  it('loads Report, Plan Review and Benchmark with React.lazy', () => {
    for (const name of ['PlanReviewScreen', 'ReportScreen', 'BenchmarkScreen']) {
      expect(app).toMatch(new RegExp(`const ${name} = lazy\\(`));
      expect(app).not.toMatch(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from './screens/`));
    }
  });

  it('shows a fallback while a lazy screen loads', () => {
    expect(app).toMatch(/<Suspense fallback=\{<Loading label="Loading…" \/>\}>\{body\}<\/Suspense>/);
  });

  it('splits packages into a vendor chunk', () => {
    expect(read('vite.config.ts')).toMatch(/manualChunks: \(id\) => \(\/\[\\\\\/\]node_modules\[\\\\\/\]\/\.test\(id\) \? 'vendor' : undefined\)/);
  });
});

describe('the comparison poll reads the small progress route', () => {
  const screen = read('src/screens/BenchmarkScreen.tsx');

  it('polls /progress while running and reads the full comparison once when done', () => {
    expect(read('src/api.ts')).toMatch(/\/api\/runner\/benchmark\/\$\{encodeURIComponent\(id\)\}\/progress/);
    const tick = screen.slice(screen.indexOf('const tick = async'), screen.indexOf('timer.current = window.setTimeout(() => void tick(), POLL_MS);\n    };'));
    expect(tick).toContain('getBenchmarkProgress(runningId)');
    expect(tick.match(/getBenchmark\(runningId\)/g)?.length).toBe(1);
    expect(tick.indexOf('getBenchmark(runningId)')).toBeGreaterThan(tick.indexOf("progress.status === 'running'"));
  });
});
