/** T-410 follow-up: stopping the runner closes the shared Chromium used for PDF exports. */
import { describe, it, expect, vi } from 'vitest';
import path from 'path';

const closePdfBrowser = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@qa/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@qa/core')>()),
  closePdfBrowser,
}));

import { RunnerServer } from '../src/server.js';

describe('RunnerServer.stop', () => {
  it('closes the shared PDF browser', async () => {
    const scratch = path.join(process.cwd(), '.tmp-stop-pdf');
    const server = new RunnerServer({
      port: 3584,
      outputDir: path.join(scratch, 'report'),
      dataDir: path.join(scratch, 'data'),
    });
    await server.start();
    expect(closePdfBrowser).not.toHaveBeenCalled();
    await server.stop();
    expect(closePdfBrowser).toHaveBeenCalledTimes(1);
  });
});
