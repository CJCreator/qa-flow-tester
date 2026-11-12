import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';
import type { TestCase } from '@qa/types';
import { normaliseText, apiPathMatches, SpecConformanceChecker } from '../src/spec-conformance.js';

describe('normaliseText', () => {
  it('collapses multiple whitespace characters to a single space', () => {
    expect(normaliseText('hello   world')).toBe('hello world');
    expect(normaliseText('hello\t\n  world\r\nagain')).toBe('hello world again');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normaliseText('   hello world   ')).toBe('hello world');
    expect(normaliseText('\n\t  test  \t\n')).toBe('test');
  });

  it('converts text to lowercase', () => {
    expect(normaliseText('Welcome Back, ADMIN!')).toBe('welcome back, admin!');
  });

  it('handles empty and whitespace-only strings', () => {
    expect(normaliseText('')).toBe('');
    expect(normaliseText('   \t\n ')).toBe('');
  });
});

describe('apiPathMatches', () => {
  describe('whole segment matching', () => {
    it('matches exact pathname', () => {
      expect(apiPathMatches('/api/users', '/api/users')).toBe(true);
      expect(apiPathMatches('https://example.com/api/users', '/api/users')).toBe(true);
    });

    it('matches when request pathname continues with / right after expected path', () => {
      expect(apiPathMatches('/api/users/123', '/api/users')).toBe(true);
      expect(apiPathMatches('/api/users/123/profile', '/api/users')).toBe(true);
      expect(apiPathMatches('https://api.test/api/users/new', '/api/users')).toBe(true);
    });

    it('handles trailing slash on apiPath or requestUrl', () => {
      expect(apiPathMatches('/api/users/', '/api/users')).toBe(true);
      expect(apiPathMatches('/api/users', '/api/users/')).toBe(true);
      expect(apiPathMatches('/api/users/123', '/api/users/')).toBe(true);
    });

    it('rejects partial segment matches (not continuing with /)', () => {
      expect(apiPathMatches('/api/users_extra', '/api/users')).toBe(false);
      expect(apiPathMatches('/api/users-backup', '/api/users')).toBe(false);
      expect(apiPathMatches('/api/user', '/api/users')).toBe(false);
      expect(apiPathMatches('/other/users', '/api/users')).toBe(false);
    });
  });

  describe('wildcards in segments', () => {
    it('matches wildcard segments with *', () => {
      expect(apiPathMatches('/api/v1/users', '/api/*/users')).toBe(true);
      expect(apiPathMatches('/api/v2/users', '/api/*/users')).toBe(true);
      expect(apiPathMatches('/api/v1/users/42', '/api/*/users')).toBe(true);
      expect(apiPathMatches('/api/v1/users_extra', '/api/*/users')).toBe(false);
    });

    it('wildcard within segment does not span multiple path segments', () => {
      expect(apiPathMatches('/api/v1/sub/users', '/api/*/users')).toBe(false);
    });

    it('matches wildcard at end of segment', () => {
      expect(apiPathMatches('/api/users/42', '/api/users/*')).toBe(true);
      expect(apiPathMatches('/api/users/42/details', '/api/users/*')).toBe(true);
      expect(apiPathMatches('/api/users', '/api/users/*')).toBe(false);
    });

    it('matches wildcard inside a segment', () => {
      expect(apiPathMatches('/api/v1/items', '/api/v*/items')).toBe(true);
      expect(apiPathMatches('/api/v2/items', '/api/v*/items')).toBe(true);
      expect(apiPathMatches('/api/admin/items', '/api/v*/items')).toBe(false);
    });
  });

  describe('searchParams matching', () => {
    it('ignores query parameters in request when apiPath has no searchParams', () => {
      expect(apiPathMatches('/api/users?page=1&limit=10', '/api/users')).toBe(true);
    });

    it('requires every key=value from apiPath to be present in requestUrl', () => {
      expect(apiPathMatches('/api/users?role=admin&sort=asc', '/api/users?role=admin')).toBe(true);
      expect(apiPathMatches('/api/users?sort=asc&role=admin', '/api/users?role=admin&sort=asc')).toBe(true);
    });

    it('fails when a required search parameter is missing or has a different value', () => {
      expect(apiPathMatches('/api/users?sort=asc', '/api/users?role=admin')).toBe(false);
      expect(apiPathMatches('/api/users?role=guest', '/api/users?role=admin')).toBe(false);
      expect(apiPathMatches('/api/users?role=admin', '/api/users?role=admin&sort=asc')).toBe(false);
    });
  });
});

describe('SpecConformanceChecker text expectations (case-insensitive & whitespace-normalised)', () => {
  const makeChecker = () => new SpecConformanceChecker();

  const mockPage = (title: string, bodyText: string) =>
    ({
      url: () => 'http://localhost:3000/dashboard',
      title: async () => title,
      innerText: async (_selector: string) => bodyText,
    }) as unknown as Page;

  const mockTestCase = (expectations: { contains?: string; notContains?: string; description?: string }) =>
    ({
      id: 'tc-text-1',
      flowId: 'flow-1',
      name: 'Text check test',
      role: 'user',
      startPage: '/dashboard',
      steps: [{ name: 'Step 1', action: 'navigate' }],
      expectations: {
        text: expectations,
      },
    }) as unknown as TestCase;

  const context = {
    role: 'user',
    breakpoint: '1440px' as const,
    baseUrl: 'http://localhost:3000',
  };

  it('passes when expected text matches with different casing', async () => {
    const page = mockPage('My App Title', 'Welcome Back, Jane Doe!');
    const testCase = mockTestCase({ contains: 'welcome back, jane doe!' });

    const findings = await makeChecker().check(page, testCase, [], context);
    expect(findings.filter((f) => f.ruleCode === 'spec-text-missing')).toHaveLength(0);
  });

  it('passes when expected text matches with irregular whitespace', async () => {
    const page = mockPage('Dashboard', 'Order   #1042\n\n\thas been confirmed.');
    const testCase = mockTestCase({ contains: 'Order #1042 has been confirmed.' });

    const findings = await makeChecker().check(page, testCase, [], context);
    expect(findings.filter((f) => f.ruleCode === 'spec-text-missing')).toHaveLength(0);
  });

  it('creates finding when contains text is genuinely missing, retaining original text in finding', async () => {
    const page = mockPage('Dashboard', 'Welcome Back!');
    const testCase = mockTestCase({
      contains: 'Order Success Banner',
      description: 'shows order success',
    });

    const findings = await makeChecker().check(page, testCase, [], context);
    const missingFinding = findings.find((f) => f.ruleCode === 'spec-text-missing');
    expect(missingFinding).toBeDefined();
    expect(missingFinding?.title).toBe('Expected text not found: "Order Success Banner"');
    expect(missingFinding?.expectedVsActual.expected).toContain('"Order Success Banner"');
    expect(missingFinding?.expectedVsActual.actual).toContain('"Order Success Banner"');
  });

  it('creates finding when disallowed text (notContains) is present regardless of case or whitespace', async () => {
    const page = mockPage('Error Page', 'Internal   Server   Error');
    const testCase = mockTestCase({ notContains: 'internal server error' });

    const findings = await makeChecker().check(page, testCase, [], context);
    const disallowedFinding = findings.find((f) => f.ruleCode === 'spec-text-disallowed');
    expect(disallowedFinding).toBeDefined();
    expect(disallowedFinding?.title).toBe('Disallowed text appeared: "internal server error"');
    expect(disallowedFinding?.expectedVsActual.expected).toContain('"internal server error"');
    expect(disallowedFinding?.expectedVsActual.actual).toContain('"internal server error"');
  });

  it('passes notContains check when text is absent', async () => {
    const page = mockPage('Dashboard', 'All systems operational');
    const testCase = mockTestCase({ notContains: '500 Server Error' });

    const findings = await makeChecker().check(page, testCase, [], context);
    expect(findings.filter((f) => f.ruleCode === 'spec-text-disallowed')).toHaveLength(0);
  });
});
