import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (file: string) => readFileSync(path.join(here, '..', 'src', file), 'utf8').replace(/\r\n/g, '\n');

describe('T-60 per-visitor run cap runs when a run finishes', () => {
  // The run code is split across checkup-run*.ts: read them as one text.
  const run = ['checkup-run.ts', 'checkup-run-execute.ts', 'checkup-run-testing.ts', 'checkup-run-types.ts']
    .map((f) => src(path.join('session', f)))
    .join('\n');
  const server = src('server.ts');

  it('checkup-run.ts exposes an optional afterKeep dependency', () => {
    expect(run).toMatch(/afterKeep\?: \(runId: string\) => void;/);
  });

  it('checkup-run.ts calls afterKeep after the testing-phase keep', () => {
    const keep = run.indexOf('.keep(report, record.plan.targetUrl || context.targetUrl, context.siteHost)');
    expect(keep).toBeGreaterThan(-1);
    expect(run.indexOf('deps.afterKeep?.(context.runId);', keep)).toBeGreaterThan(keep);
  });

  it('checkup-run.ts calls afterKeep after the safe-public keep', () => {
    const keep = run.indexOf('await session.report.keep(report, body.targetUrl, undefined).catch(() => {});');
    expect(keep).toBeGreaterThan(-1);
    expect(run.indexOf('deps.afterKeep?.(runId);', keep)).toBeGreaterThan(keep);
  });

  it('server.ts passes afterKeep to createCheckupRun, pruning the run owner without awaiting', () => {
    expect(server).toMatch(
      /afterKeep: \(runId\) => \{\s*void this\.pruneVisitorRuns\(this\.runOwners\.get\(runId\)\)\.catch\(\(\) => \{\}\);\s*\}/
    );
  });
});
