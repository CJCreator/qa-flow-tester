import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// T-54: the CI video option must travel from RunStartBody through the stored run context to orchestrator.run.
const root = join(__dirname, '..', 'src', 'session');
const planStore = readFileSync(join(root, 'plan-store.ts'), 'utf8');
// The run code is split across checkup-run*.ts: read them as one text.
const checkupRun = ['checkup-run.ts', 'checkup-run-execute.ts', 'checkup-run-testing.ts']
  .map((f) => readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n'))
  .join('\n');

describe('T-54 recordVideo through the run context', () => {
  it('plan-store context type carries recordVideo as an optional boolean', () => {
    expect(planStore).toMatch(/recordVideo\?: boolean;/);
  });

  it('start() stores recordVideo only when the body sets it', () => {
    expect(checkupRun).toContain(
      '...(body.recordVideo !== undefined ? { recordVideo: body.recordVideo } : {}),'
    );
  });

  it('orchestrator.run receives recordVideo only when the context sets it', () => {
    expect(checkupRun).toContain(
      '...(context.recordVideo !== undefined ? { recordVideo: context.recordVideo } : {}),'
    );
  });
});
