import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { installCheckupSignalHandlers } from '../src/checkup.js';

describe('checkup CLI signal handlers', () => {
  it('calls shutdown on SIGTERM and stops listening after disposer is called', async () => {
    const proc = new EventEmitter();
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const dispose = installCheckupSignalHandlers(shutdown, proc);

    proc.emit('SIGTERM');
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith('SIGTERM', 2);

    dispose();
    proc.emit('SIGTERM');
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('calls shutdown on SIGINT and stops listening after disposer is called', async () => {
    const proc = new EventEmitter();
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const dispose = installCheckupSignalHandlers(shutdown, proc);

    proc.emit('SIGINT');
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledWith('SIGINT', 2);

    dispose();
    proc.emit('SIGINT');
    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
