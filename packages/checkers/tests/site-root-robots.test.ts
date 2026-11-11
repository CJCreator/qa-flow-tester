import { describe, it, expect } from 'vitest';
import { SiteRootAuditor } from '../src/site-root.js';

describe('SiteRootAuditor robots.txt parsing and caching (T-344)', () => {
  it('keeps group across blank lines between User-agent and Disallow', async () => {
    const auditor = new SiteRootAuditor();
    const mockRobots = 'User-agent: GPTBot\n\nDisallow: /\n';
    const result = await auditor.audit(
      async (url: string) => {
        if (url.endsWith('/robots.txt')) {
          return { status: () => 200, text: async () => mockRobots };
        }
        return { status: () => 404, text: async () => '' };
      },
      { baseUrl: 'https://example.com' }
    );
    expect(result.blockedAiBots).toContain('GPTBot');
  });

  it('blocks both crawlers when blank and comment lines appear inside a multi-agent group', async () => {
    const auditor = new SiteRootAuditor();
    const mockRobots = 'User-agent: GPTBot\n# note\nUser-agent: ClaudeBot\n\nDisallow: /\n';
    const result = await auditor.audit(
      async (url: string) => {
        if (url.endsWith('/robots.txt')) {
          return { status: () => 200, text: async () => mockRobots };
        }
        return { status: () => 404, text: async () => '' };
      },
      { baseUrl: 'https://example.com' }
    );
    expect(result.blockedAiBots).toContain('GPTBot');
    expect(result.blockedAiBots).toContain('ClaudeBot');
  });

  it('separates groups across blank lines when a new User-agent follows rules', async () => {
    const auditor = new SiteRootAuditor();
    const mockRobots = 'User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nDisallow: /\n';
    const result = await auditor.audit(
      async (url: string) => {
        if (url.endsWith('/robots.txt')) {
          return { status: () => 200, text: async () => mockRobots };
        }
        return { status: () => 404, text: async () => '' };
      },
      { baseUrl: 'https://example.com' }
    );
    expect(result.blockedAiBots).toEqual(['GPTBot']);
  });

  it('does not cache when fetchFn returns null for robots.txt', async () => {
    const auditor = new SiteRootAuditor();
    let fetchCount = 0;
    const fetchFn = async (url: string) => {
      fetchCount++;
      if (url.endsWith('/robots.txt')) {
        return null;
      }
      return { status: () => 404, text: async () => '' };
    };

    await auditor.audit(fetchFn, { baseUrl: 'https://example.com' });
    const countAfterFirst = fetchCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    await auditor.audit(fetchFn, { baseUrl: 'https://example.com' });
    expect(fetchCount).toBeGreaterThan(countAfterFirst);
  });

  it('does not cache when fetchFn returns HTTP >= 500', async () => {
    const auditor = new SiteRootAuditor();
    let fetchCount = 0;
    const fetchFn = async (url: string) => {
      fetchCount++;
      if (url.endsWith('/robots.txt')) {
        return { status: () => 500, text: async () => 'Internal Server Error' };
      }
      return { status: () => 404, text: async () => '' };
    };

    await auditor.audit(fetchFn, { baseUrl: 'https://example.com' });
    const countAfterFirst = fetchCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    await auditor.audit(fetchFn, { baseUrl: 'https://example.com' });
    expect(fetchCount).toBeGreaterThan(countAfterFirst);
  });

  it('does not cache when fetchFn throws an error', async () => {
    const auditor = new SiteRootAuditor();
    let fetchCount = 0;
    const fetchFn = async (url: string) => {
      fetchCount++;
      if (url.endsWith('/robots.txt')) {
        throw new Error('Network error');
      }
      return { status: () => 404, text: async () => '' };
    };

    await auditor.audit(fetchFn, { baseUrl: 'https://example.com' });
    const countAfterFirst = fetchCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    await auditor.audit(fetchFn, { baseUrl: 'https://example.com' });
    expect(fetchCount).toBeGreaterThan(countAfterFirst);
  });

  it('caches complete results when fetchFn answers 404 for all files', async () => {
    const auditor = new SiteRootAuditor();
    let fetchCount = 0;
    const fetchFn = async () => {
      fetchCount++;
      return { status: () => 404, text: async () => '' };
    };

    const firstResult = await auditor.audit(fetchFn, { baseUrl: 'https://example.com' });
    const countAfterFirst = fetchCount;
    expect(countAfterFirst).toBe(3); // robots.txt, sitemap.xml, llms.txt

    const secondResult = await auditor.audit(fetchFn, { baseUrl: 'https://example.com' });
    expect(fetchCount).toBe(countAfterFirst); // No new fetch calls
    expect(secondResult).toBe(firstResult); // Exactly same cached object
  });
});
