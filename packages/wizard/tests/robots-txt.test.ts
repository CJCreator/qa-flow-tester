import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATHS } from '../src/lib/router';

interface Rule {
  type: 'allow' | 'disallow';
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
}

function parseRobots(content: string): Group[] {
  const lines = content.split(/\r?\n/);
  const groups: Group[] = [];
  let currentGroup: Group | null = null;
  let inRuleSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (key === 'user-agent') {
      if (inRuleSection || !currentGroup) {
        currentGroup = { agents: [], rules: [] };
        groups.push(currentGroup);
        inRuleSection = false;
      }
      currentGroup.agents.push(value);
    } else if (key === 'allow' || key === 'disallow') {
      if (!currentGroup) continue;
      inRuleSection = true;
      currentGroup.rules.push({
        type: key,
        pattern: value,
      });
    }
  }

  return groups;
}

function findGroupForAgent(groups: Group[], agent: string): Group | undefined {
  const exact = groups.find((g) => g.agents.some((a) => a.toLowerCase() === agent.toLowerCase()));
  if (exact) return exact;
  return groups.find((g) => g.agents.includes('*'));
}

function isPathAllowed(groups: Group[], agent: string, pathname: string): boolean {
  const group = findGroupForAgent(groups, agent);
  if (!group || group.rules.length === 0) {
    return true;
  }

  const matchingRules = group.rules.filter((rule) => {
    if (rule.pattern.endsWith('$')) {
      const prefix = rule.pattern.slice(0, -1);
      return pathname === prefix;
    }
    return pathname.startsWith(rule.pattern);
  });

  if (matchingRules.length === 0) {
    return true;
  }

  let bestLength = -1;
  let decision: 'allow' | 'disallow' = 'allow';

  for (const rule of matchingRules) {
    const len = rule.pattern.length;
    if (len > bestLength) {
      bestLength = len;
      decision = rule.type;
    } else if (len === bestLength && rule.type === 'allow') {
      decision = 'allow';
    }
  }

  return decision === 'allow';
}

const robotsPath = resolve(__dirname, '../public/robots.txt');
const rawText = readFileSync(robotsPath, 'utf8');
const rawBuffer = readFileSync(robotsPath);
const groups = parseRobots(rawText);

const AI_CRAWLERS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];
const ALL_AGENTS = ['*', ...AI_CRAWLERS];

describe('robots.txt', () => {
  it('has no byte order mark', () => {
    expect(rawText[0]).toBe('#');
    expect(rawBuffer[0]).toBe(0x23);
  });

  it('every named AI crawler and * share the same rules', () => {
    const starRules = findGroupForAgent(groups, '*')?.rules;
    expect(starRules).toBeDefined();
    expect(starRules!.length).toBeGreaterThan(0);

    for (const agent of AI_CRAWLERS) {
      const agentRules = findGroupForAgent(groups, agent)?.rules;
      expect(agentRules).toEqual(starRules);
    }
  });

  it('the public pages are open', () => {
    for (const agent of ALL_AGENTS) {
      expect(isPathAllowed(groups, agent, '/')).toBe(true);
      expect(isPathAllowed(groups, agent, '/llms.txt')).toBe(true);
      expect(isPathAllowed(groups, agent, '/sample-report.html')).toBe(true);
    }
  });

  it('every app screen is closed', () => {
    const screenEntries = Object.entries(PATHS).filter(([key]) => key !== 'landing');
    for (const [key, value] of screenEntries) {
      const screenPath = typeof value === 'function' ? (value as any)('x', 1) : value;
      expect(isPathAllowed(groups, '*', screenPath), `path ${screenPath} (${key}) should be disallowed for *`).toBe(
        false
      );
      expect(
        isPathAllowed(groups, 'GPTBot', screenPath),
        `path ${screenPath} (${key}) should be disallowed for GPTBot`
      ).toBe(false);
    }
  });

  it('/api/ is closed', () => {
    expect(isPathAllowed(groups, '*', '/api/runner/status')).toBe(false);
    expect(isPathAllowed(groups, 'GPTBot', '/api/runner/status')).toBe(false);
  });

  it('the sitemap line is kept', () => {
    expect(rawText).toContain('Sitemap: %ORIGIN%/sitemap.xml');
  });
});
