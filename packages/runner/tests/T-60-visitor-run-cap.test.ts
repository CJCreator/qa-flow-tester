import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

// Source checks for T-60 (GROW-3): a beta visitor keeps at most ten finished runs.
const here = path.dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(path.join(here, '..', 'src', 'server.ts'), 'utf8');

describe('T-60 beta visitor run cap in server.ts', () => {
  it('keeps ten runs per visitor', () => {
    expect(serverSource).toContain('const RUNS_KEPT_PER_VISITOR = 10;');
  });

  it('prunes the visitor’s oldest runs, never a running or waiting one', () => {
    expect(serverSource).toContain('private async pruneVisitorRuns(owner: string | undefined): Promise<void> {');
    expect(serverSource).toContain('mine.slice(RUNS_KEPT_PER_VISITOR)');
    expect(serverSource).toContain('if (protectedIds.has(run.runId)) continue;');
  });

  it('prunes only in beta', () => {
    expect(serverSource).toContain('if (!this.beta || !owner) return;');
    expect(serverSource).toContain('if (this.beta) await this.pruneVisitorRuns(currentSessionId());');
  });

  it('runs the cap after a reviewed run is saved and when the visitor lists runs', () => {
    expect(serverSource).toContain('await this.pruneVisitorRuns(this.runOwners.get(report.runId));');
  });
});
