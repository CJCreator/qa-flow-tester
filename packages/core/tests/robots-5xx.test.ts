/**
 * A robots.txt that answers 5xx means the site could not say what it allows: no page is crawled this run.
 * A 404 still means allow all. The crawl skips a refused page with the reason `robots`.
 */
import { describe, it, expect } from 'vitest';
import { RobotsPolicy } from '../src/competitive/robots.js';

const UA = 'QA-Benchmarking-Bot';
const answer = (status: number) => async () => ({ status, headers: {}, text: async () => '' });

describe('RobotsPolicy.fetch and server errors', () => {
  it.each([500, 502, 503, 504])('a %i skips every page', async (status) => {
    const policy = await RobotsPolicy.fetch('https://shop.test', UA, answer(status));
    expect(policy.isAllowed('/')).toBe(false);
    expect(policy.isAllowed('/pricing')).toBe(false);
    expect(policy.isAllowed('/a/b?c=d')).toBe(false);
  });

  it('a 404 still allows everything', async () => {
    const policy = await RobotsPolicy.fetch('https://shop.test', UA, answer(404));
    expect(policy.isAllowed('/pricing')).toBe(true);
  });

  it('a 200 follows the file', async () => {
    const policy = await RobotsPolicy.fetch('https://shop.test', UA, async () => ({
      status: 200,
      headers: {},
      text: async () => 'User-agent: *\nDisallow: /admin\n',
    }));
    expect(policy.isAllowed('/pricing')).toBe(true);
    expect(policy.isAllowed('/admin')).toBe(false);
  });
});
