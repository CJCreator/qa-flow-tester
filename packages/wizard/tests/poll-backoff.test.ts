import { describe, it, expect } from 'vitest';
import { pollDelay } from '../src/hooks/usePollBackoff';
import { resumeUrl } from '../src/hooks/useRunnerStream';

describe('polling backoff (LAT-9)', () => {
  it('starts at the base interval, doubles, and stops at the cap', () => {
    const delays = [0, 1, 2, 3, 4, 5].map((n) => pollDelay(n, 5000, 30000));
    expect(delays).toEqual([5000, 10000, 20000, 30000, 30000, 30000]);
  });

  it('stays at the cap for a very long wait, never NaN or past the cap', () => {
    expect(pollDelay(10_000, 5000, 30000)).toBe(30000);
  });
});

describe('SSE resume URL (LAT-10)', () => {
  it('leaves the URL alone before any event id is known', () => {
    expect(resumeUrl('/api/runner/stream', null)).toBe('/api/runner/stream');
  });

  it('adds lastEventId with ? or & as the URL needs', () => {
    expect(resumeUrl('/api/runner/stream', 42)).toBe('/api/runner/stream?lastEventId=42');
    expect(resumeUrl('/api/runner/stream?x=1', 0)).toBe('/api/runner/stream?x=1&lastEventId=0');
  });
});
