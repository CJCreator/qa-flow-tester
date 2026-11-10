import { describe, it, expect, vi, afterEach } from 'vitest';
import { setBrowserPolicy } from '../src/browser.js';
import { SafePublicCrawler } from '../src/competitive/safe-crawler.js';

const launch = vi.fn();
vi.mock('playwright', () => ({
  chromium: {
    launch: (...a: unknown[]) => launch(...a),
  },
}));

describe('SafePublicCrawler browser policy and guard', () => {
  afterEach(() => {
    setBrowserPolicy(null);
    vi.clearAllMocks();
  });

  it('passes the pinned address to Chromium and closes browser on setup throw', async () => {
    setBrowserPolicy({ pinned: { 'example.com': '93.184.216.34' } });
    const close = vi.fn().mockResolvedValue(undefined);
    launch.mockResolvedValue({
      newContext: vi.fn().mockRejectedValue(new Error('stop')),
      close,
    });

    const crawler = new SafePublicCrawler();
    await expect(
      crawler.crawl({ entryUrl: 'https://example.com/', respectRobots: false })
    ).rejects.toThrow('stop');

    expect(launch.mock.calls[0][0].args).toEqual(['--host-resolver-rules=MAP example.com 93.184.216.34']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('no policy, no pin', async () => {
    setBrowserPolicy(null);
    const close = vi.fn().mockResolvedValue(undefined);
    launch.mockResolvedValue({
      newContext: vi.fn().mockRejectedValue(new Error('stop')),
      close,
    });

    const crawler = new SafePublicCrawler();
    await expect(
      crawler.crawl({ entryUrl: 'https://example.com/', respectRobots: false })
    ).rejects.toThrow('stop');

    expect(launch.mock.calls[0][0].args).toEqual([]);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
