import { describe, it, expect } from 'vitest';
import { shouldResetFeed } from '../src/hooks/useRunnerStream';

describe('runner stream: a resumed reconnect keeps the feed (T-357)', () => {
  it('resets the feed when the connection carries no resumed flag', () => {
    expect(shouldResetFeed({})).toBe(true);
  });

  it('resets the feed when the runner says the connection was not resumed', () => {
    expect(shouldResetFeed({ resumed: false })).toBe(true);
  });

  it('keeps the feed when the runner resumed the connection', () => {
    expect(shouldResetFeed({ resumed: true })).toBe(false);
  });
});
