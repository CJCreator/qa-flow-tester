import { describe, it, expect } from 'vitest';
import path from 'path';
import { evidenceUrl } from '../src/evidence-url.js';

const out = path.resolve('/data/out');

describe('evidenceUrl', () => {
  it('a path relative to the run folder gets the runs/<runId> prefix', () => {
    expect(evidenceUrl(out, 'run-1', 'evidence/TC-1-1440px/visual-current.png')).toBe(
      '/api/evidence/runs/run-1/evidence/TC-1-1440px/visual-current.png'
    );
  });

  it('an absolute path inside the output folder is made relative to it', () => {
    expect(evidenceUrl(out, 'run-1', path.join(out, 'runs', 'run-1', 'evidence', 'a.png'))).toBe(
      '/api/evidence/runs/run-1/evidence/a.png'
    );
  });

  it('an absolute path outside the output folder gives nothing', () => {
    expect(evidenceUrl(out, 'run-1', path.resolve('/etc/passwd'))).toBeUndefined();
  });

  it('a path that climbs out gives nothing', () => {
    expect(evidenceUrl(out, 'run-1', '../../secret.png')).toBeUndefined();
  });

  it('no path gives nothing', () => {
    expect(evidenceUrl(out, 'run-1', undefined)).toBeUndefined();
    expect(evidenceUrl(out, 'run-1', '')).toBeUndefined();
  });

  it('segments are encoded', () => {
    expect(evidenceUrl(out, 'run-1', 'evidence/a b#1.png')).toBe('/api/evidence/runs/run-1/evidence/a%20b%231.png');
  });
});
