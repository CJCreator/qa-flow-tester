import { defineConfig } from 'vitest/config';
import os from 'os';
import { sharedTest, sharedResolve } from './vitest.shared';
import { projects } from './vitest.workspace';

// Many test files start their own Chromium, and often a runner and the fixture app too. Vitest's
// default (one worker per CPU thread, less one) ran seven of them at once on a 4-core, 8-thread laptop
// with 16 GB: memory ran out, Chromium launches passed the 30 s hook timeout and whole runs passed their
// budgets (EV-0006). One worker per 4 GB of memory, never more than the default, fits the machine and
// leaves CI as it was (4 threads and 16 GB: 3 workers either way). `--maxWorkers` still overrides it.
const workers = Math.max(1, Math.min(os.availableParallelism() - 1, Math.floor(os.totalmem() / 2 ** 32)));

// Global options (workers). The projects (`unit`, `browser`) come from vitest.workspace.ts through `test.projects`.
export default defineConfig({
  test: {
    ...sharedTest,
    projects,
    minWorkers: 1,
    maxWorkers: workers,
    include: ['packages/*/tests/**/*.test.{ts,tsx}'],
  },
  resolve: sharedResolve,
});
