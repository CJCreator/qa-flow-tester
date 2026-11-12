import { describe, it, expect } from 'vitest';
import { RobotsPolicy, ROBOTS_USER_AGENT_TOKEN, crawlPageDelayMs } from '../src/competitive/robots.js';

describe('ROBOTS_USER_AGENT_TOKEN', () => {
  it('is the name the crawls give', () => {
    expect(ROBOTS_USER_AGENT_TOKEN).toBe('QA-Benchmarking-Bot');
  });
  it('selects the robots.txt group written for it', () => {
    const robots = RobotsPolicy.parse(
      'User-agent: QA-Benchmarking-Bot\nDisallow: /private\n\nUser-agent: *\nDisallow:\n',
      ROBOTS_USER_AGENT_TOKEN
    );
    expect(robots.isAllowed('/private/a')).toBe(false);
    expect(robots.isAllowed('/public')).toBe(true);
  });
});

describe('crawlPageDelayMs', () => {
  const slow = RobotsPolicy.parse('User-agent: *\nCrawl-delay: 5\n', ROBOTS_USER_AGENT_TOKEN);
  it('keeps our own delay when the site sets none', () => {
    expect(crawlPageDelayMs(2000, RobotsPolicy.allowAll())).toBe(2000);
    expect(crawlPageDelayMs(2000, undefined)).toBe(2000);
  });
  it('raises it to the site Crawl-delay', () => {
    expect(slow.crawlDelayMs).toBe(5000);
    expect(crawlPageDelayMs(2000, slow)).toBe(5000);
    expect(crawlPageDelayMs(0, slow)).toBe(5000);
  });
  it('keeps the longer of the two', () => {
    expect(crawlPageDelayMs(8000, slow)).toBe(8000);
  });
});
