import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  checkThresholds,
  detectionRate,
  falsePositiveRate,
  renderSummary,
  type GateScore,
  type Thresholds,
} from '../../../scripts/benchmark-gate.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const score = (over: Partial<GateScore> = {}): GateScore => ({
  site: 'fixture',
  reported: 10,
  real: 5,
  plantedFound: 7,
  plantedMissed: 0,
  ...over,
});
const limits: Thresholds = { sites: { fixture: { minDetectionRate: 0.85, maxFalsePositiveRate: 0.9 } } };

describe('rates', () => {
  it('detection rate is planted found over due planted', () => {
    expect(detectionRate(score({ plantedFound: 6, plantedMissed: 1 }))).toBeCloseTo(6 / 7);
  });
  it('false positive rate is one minus real over reported', () => {
    expect(falsePositiveRate(score({ reported: 10, real: 4 }))).toBeCloseTo(0.6);
  });
  it('rates are null when there is nothing to divide by', () => {
    expect(detectionRate(score({ plantedFound: 0, plantedMissed: 0 }))).toBeNull();
    expect(falsePositiveRate(score({ reported: 0, real: 0 }))).toBeNull();
  });
  it('later-phase planted defects are not in the detection rate', () => {
    // score() leaves them out of both counts, so only due defects reach the formula
    expect(detectionRate(score({ plantedFound: 7, plantedMissed: 0 }))).toBe(1);
  });
});

describe('thresholds', () => {
  it('a detection rate below the minimum is a failure and names the missed defects', () => {
    const { failures } = checkThresholds(
      [score({ plantedFound: 5, plantedMissed: 2, plantedMissedIds: ['console-error', 'api-500'] })],
      limits
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('fixture: detection rate');
    expect(failures[0]).toContain('console-error, api-500');
  });
  it('a false positive rate above the maximum is a failure', () => {
    const { failures } = checkThresholds([score({ reported: 100, real: 5 })], limits);
    expect(failures.join()).toContain('false positive rate');
  });
  it('meeting both thresholds gives no failures', () => {
    expect(checkThresholds([score()], limits).failures).toEqual([]);
  });
  it('a rate exactly at the threshold passes', () => {
    const t: Thresholds = { sites: { fixture: { minDetectionRate: 0.5, maxFalsePositiveRate: 0.5 } } };
    expect(checkThresholds([score({ plantedFound: 1, plantedMissed: 1, reported: 10, real: 5 })], t).failures).toEqual(
      []
    );
  });
  it('an error on a gated site is a failure', () => {
    const { failures } = checkThresholds([score({ error: 'boom' })], limits);
    expect(failures.join()).toContain('boom');
  });
  it('an error on a site with no thresholds is a warning, not a failure', () => {
    const { failures, warnings } = checkThresholds([score({ site: 'todomvc', error: 'blocked' })], limits);
    expect(failures).toEqual([]);
    expect(warnings.join()).toContain('blocked');
  });
  it('a site with no threshold entry is never a failure, whatever its rates', () => {
    const { failures } = checkThresholds(
      [score({ site: 'saucedemo', plantedFound: 0, plantedMissed: 9, reported: 50, real: 0 })],
      limits
    );
    expect(failures).toEqual([]);
  });
  it('a gated site with a null rate fails with a no-data message', () => {
    const { failures } = checkThresholds([score({ plantedFound: 0, plantedMissed: 0 })], limits);
    expect(failures.join()).toContain('no data');
  });
  it('thresholds.json gates the fixture site with rates between 0 and 1', () => {
    const t = JSON.parse(read('fixtures/benchmarks/thresholds.json')) as Thresholds;
    const fixture = t.sites.fixture;
    expect(fixture).toBeDefined();
    for (const v of [fixture.minDetectionRate, fixture.maxFalsePositiveRate]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('summary', () => {
  it('summary lists each site with its rates and any failures', () => {
    const rows = [
      {
        ...score({ plantedFound: 5, plantedMissed: 2, plantedMissedIds: ['api-500', 'dead-end'] }),
        detectionRate: 0.714,
        falsePositiveRate: 0.5,
      },
      { ...score({ site: 'todomvc' }), detectionRate: null, falsePositiveRate: 0.2 },
    ];
    const { failures, warnings } = checkThresholds(rows, limits);
    const md = renderSummary(rows, failures, warnings);
    expect(md).toContain('| fixture |');
    expect(md).toContain('| todomvc |');
    expect(md).toContain('0.714');
    expect(md).toContain('n/a');
    expect(md).toContain('## Failures');
    expect(md).toContain('api-500, dead-end');
  });
});

describe('benchmark workflow', () => {
  it('benchmark.yml triggers only on workflow_dispatch and schedule', () => {
    const yml = read('.github/workflows/benchmark.yml');
    for (const s of ['workflow_dispatch', 'schedule', 'upload-artifact', '.benchmark', '--no-ai']) {
      expect(yml).toContain(s);
    }
    expect(yml).not.toMatch(/pull_request|push:/);
    expect(yml).not.toContain('secrets.');
    expect(read('.github/workflows/ci.yml')).toContain('pull_request');
  });
});
