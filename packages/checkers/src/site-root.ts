import type { Finding, Breakpoint } from '@qa/types';

export interface SiteRootContext {
  baseUrl: string;
  testCaseId?: string;
  flowId?: string;
  role?: string;
  breakpoint?: Breakpoint;
}

export interface SiteRootAuditResult {
  hasRobotsTxt: boolean;
  robotsTxtContent?: string;
  hasSitemap: boolean;
  sitemapUrl?: string;
  hasLlmsTxt: boolean;
  llmsTxtContent?: string;
  blockedAiBots: string[];
  findings: Finding[];
}

const KNOWN_AI_BOTS = [
  'GPTBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'PerplexityBot',
  'Google-Extended',
  'CCBot',
  'Applebot-Extended',
  'Bytespider',
  'cohere-ai',
];

export class SiteRootAuditor {
  private cache = new Map<string, SiteRootAuditResult>();

  /**
   * Audit root assets (robots.txt, sitemap.xml, llms.txt, AI crawler directives).
   * Results are cached per base URL to prevent redundant network requests.
   */
  async audit(
    fetchFn: (url: string) => Promise<{ status: () => number; text?: () => Promise<string> } | null>,
    context: SiteRootContext
  ): Promise<SiteRootAuditResult> {
    const origin = new URL(context.baseUrl).origin;
    if (this.cache.has(origin)) {
      return this.cache.get(origin)!;
    }

    const findings: Finding[] = [];
    const role = context.role || 'visitor';
    const bp: Breakpoint = context.breakpoint || '1440px';
    const tcId = context.testCaseId || 'ROOT';

    // 1. Audit robots.txt
    let hasRobotsTxt = false;
    let robotsTxtContent: string | undefined;
    const blockedAiBots: string[] = [];
    const declaredSitemaps: string[] = [];

    try {
      const robotsUrl = `${origin}/robots.txt`;
      const res = await fetchFn(robotsUrl);
      if (res && res.status() >= 200 && res.status() < 300 && res.text) {
        hasRobotsTxt = true;
        robotsTxtContent = await res.text();

        // Parse robots.txt for AI bots and Sitemaps
        const lines = robotsTxtContent.split('\n');
        let currentUserAgents: string[] = [];
        let wildcardDisallowAll = false;

        for (const rawLine of lines) {
          const line = rawLine.split('#')[0].trim();
          if (!line) {
            currentUserAgents = [];
            continue;
          }

          const uaMatch = line.match(/^User-agent:\s*(.+)$/i);
          if (uaMatch) {
            currentUserAgents.push(uaMatch[1].trim());
            continue;
          }

          const sitemapMatch = line.match(/^Sitemap:\s*(.+)$/i);
          if (sitemapMatch) {
            declaredSitemaps.push(sitemapMatch[1].trim());
          }

          const disallowMatch = line.match(/^Disallow:\s*(.*)$/i);
          if (disallowMatch) {
            const rule = disallowMatch[1].trim();
            if (rule === '/' || rule === '/*') {
              for (const ua of currentUserAgents) {
                if (ua === '*') {
                  wildcardDisallowAll = true;
                }
                const matchedAi = KNOWN_AI_BOTS.find((bot) => bot.toLowerCase() === ua.toLowerCase());
                if (matchedAi && !blockedAiBots.includes(matchedAi)) {
                  blockedAiBots.push(matchedAi);
                }
              }
            }
          }
        }

        // If wildcard disallows all and no specific AI bot overrides exist, flag them as blocked
        if (wildcardDisallowAll) {
          for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
            if (!blockedAiBots.includes(bot)) {
              blockedAiBots.push(bot);
            }
          }
        }

        // Flag AI crawlers blocked finding
        if (blockedAiBots.length > 0) {
          findings.push({
            id: `F-GEO-${tcId}-ROBOTS-BLOCKED`,
            testCaseId: context.testCaseId,
            flowId: context.flowId,
            severity: 'Minor',
            checker: 'seo',
            categoryTag: 'GEO',
            title: `AI search crawlers are disallowed in robots.txt (${blockedAiBots.slice(0, 3).join(', ')}${blockedAiBots.length > 3 ? '...' : ''})`,
            where: { urlPath: '/robots.txt', role, breakpoint: bp },
            expectedVsActual: {
              expected:
                'robots.txt should permit generative AI engines (e.g. GPTBot, PerplexityBot, ClaudeBot) to crawl public content if you want to appear in AI search results and citations',
              actual: `Directives disallow: ${blockedAiBots.join(', ')}`,
            },
            stepsToReproduce: [`Fetch ${robotsUrl}`, 'Inspect User-agent and Disallow rules'],
            evidence: {},
            resolution:
              'Update robots.txt to explicitly allow AI crawlers (e.g. "User-agent: GPTBot / Allow: /") if you want generative AI search engines to reference your site.',
          });
        }
      } else {
        // robots.txt missing
        findings.push({
          id: `F-SEO-${tcId}-ROBOTSTXT-MISSING`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Minor',
          checker: 'seo',
          categoryTag: 'SEO',
          title: 'Site is missing a robots.txt file at domain root',
          where: { urlPath: '/robots.txt', role, breakpoint: bp },
          expectedVsActual: {
            expected: 'Sites should host a /robots.txt file specifying crawler indexing instructions',
            actual: `GET ${robotsUrl} returned HTTP ${res ? res.status() : 'Error/NotFound'}`,
          },
          stepsToReproduce: [`Request ${robotsUrl}`],
          evidence: {},
          resolution: 'Create a /robots.txt file at the root of your public web directory with crawler rules.',
        });
      }
    } catch {
      // Ignore network errors
    }

    // 2. Audit sitemap.xml
    let hasSitemap = false;
    let sitemapUrl: string | undefined = declaredSitemaps[0];

    try {
      const probeUrl = sitemapUrl || `${origin}/sitemap.xml`;
      const sitemapRes = await fetchFn(probeUrl);
      if (sitemapRes && sitemapRes.status() >= 200 && sitemapRes.status() < 300) {
        hasSitemap = true;
        sitemapUrl = probeUrl;
      } else if (!hasSitemap) {
        findings.push({
          id: `F-SEO-${tcId}-SITEMAP-MISSING`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Minor',
          checker: 'seo',
          categoryTag: 'SEO',
          title: 'Site is missing a sitemap.xml file',
          where: { urlPath: '/sitemap.xml', role, breakpoint: bp },
          expectedVsActual: {
            expected: 'A sitemap.xml file should exist at the site root or be referenced in robots.txt',
            actual: `Sitemap could not be retrieved at ${probeUrl}`,
          },
          stepsToReproduce: [`Request ${probeUrl}`],
          evidence: {},
          resolution: 'Generate an XML sitemap and declare it in robots.txt or place it at /sitemap.xml.',
        });
      }
    } catch {
      // Ignore
    }

    // 3. Audit /llms.txt standard
    let hasLlmsTxt = false;
    let llmsTxtContent: string | undefined;

    try {
      const llmsUrl = `${origin}/llms.txt`;
      const llmsRes = await fetchFn(llmsUrl);
      if (llmsRes && llmsRes.status() >= 200 && llmsRes.status() < 300 && llmsRes.text) {
        hasLlmsTxt = true;
        llmsTxtContent = await llmsRes.text();
        if (!llmsTxtContent.trim().startsWith('#')) {
          findings.push({
            id: `F-GEO-${tcId}-LLMSTXT-FORMAT`,
            testCaseId: context.testCaseId,
            flowId: context.flowId,
            severity: 'Suggestion',
            checker: 'seo',
            categoryTag: 'GEO',
            title: '/llms.txt file is missing standard H1 title structure',
            where: { urlPath: '/llms.txt', role, breakpoint: bp },
            expectedVsActual: {
              expected:
                'The /llms.txt standard requires an H1 heading (# Project/Site Name) followed by a blockquote summary and markdown links',
              actual: 'The file does not start with an H1 (# Title)',
            },
            stepsToReproduce: [`Fetch ${llmsUrl}`, 'Verify markdown format conforms to llmstxt.org'],
            evidence: {},
            resolution:
              'Format /llms.txt according to the llmstxt.org proposal with an H1 project title and section links.',
          });
        }
      } else {
        findings.push({
          id: `F-GEO-${tcId}-LLMSTXT-MISSING`,
          testCaseId: context.testCaseId,
          flowId: context.flowId,
          severity: 'Suggestion',
          checker: 'seo',
          categoryTag: 'GEO',
          title: 'Site is missing an /llms.txt file for generative AI models',
          where: { urlPath: '/llms.txt', role, breakpoint: bp },
          expectedVsActual: {
            expected:
              'Modern websites provide /llms.txt to help LLMs understand and cite their core documentation and services accurately',
            actual: `GET ${llmsUrl} returned HTTP ${llmsRes ? llmsRes.status() : 'Error/NotFound'}`,
          },
          stepsToReproduce: [`Request ${llmsUrl}`],
          evidence: {},
          resolution:
            'Add an /llms.txt file at your domain root summarizing your product and key links in concise markdown (see llmstxt.org).',
        });
      }
    } catch {
      // Ignore
    }

    const result: SiteRootAuditResult = {
      hasRobotsTxt,
      robotsTxtContent,
      hasSitemap,
      sitemapUrl,
      hasLlmsTxt,
      llmsTxtContent,
      blockedAiBots,
      findings,
    };

    this.cache.set(origin, result);
    return result;
  }

  clearCache() {
    this.cache.clear();
  }
}
