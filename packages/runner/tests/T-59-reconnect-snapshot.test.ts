/**
 * T-59 (LAT-12): a reconnect to the stream gets one connected snapshot, not the run's replay log. The first
 * connect still gets the replay. Source checks only: the wizard hook asks for `?reconnect=1` after a first open.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('T-59 reconnect snapshot', () => {
  it('skips the replay loop on the stream handler when reconnect=1 is asked', async () => {
    const server = await fs.readFile(path.join(root, 'packages', 'runner', 'src', 'server.ts'), 'utf8');

    expect(server).toContain(`url.searchParams.get('reconnect') !== '1' && this.isMine(this.currentRunId)`);
    expect(server).toContain(`{ type: 'connected', timestamp: Date.now() }`);
  });

  it('keeps the first connect URL unchanged and adds the reconnect flag only after an open', async () => {
    const hook = await fs.readFile(
      path.join(root, 'packages', 'wizard', 'src', 'hooks', 'useRunnerStream.ts'),
      'utf8'
    );

    expect(hook).toContain('new EventSource(opened ? `${url}?reconnect=1` : url)');
    expect(hook).toContain('opened = true;');
  });
});
