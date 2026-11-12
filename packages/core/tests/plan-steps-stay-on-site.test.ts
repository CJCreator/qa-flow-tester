import { describe, it, expect } from 'vitest';
import type { DiscoveredFlow, PageInventoryItem } from '@qa/types';
import { isSitePath, onSiteAddress } from '../src/same-site.js';
import { CredentialPlaceholderError, resolveCredentialPlaceholders } from '../src/credentials.js';
import { PlanValidator } from '../src/discovery/plan-validator.js';

describe('onSiteAddress', () => {
  const target = 'https://example.com/';

  it('keeps and resolves paths on the target site and www twin', () => {
    expect(onSiteAddress('/pricing', target)).toBe('https://example.com/pricing');
    expect(onSiteAddress('https://www.example.com/a', target)).toBe('https://www.example.com/a');
  });

  it('rejects foreign origins, bad schemes, and user credentials in the URL', () => {
    expect(onSiteAddress('https://other.example/', target)).toBeNull();
    expect(onSiteAddress('//other.example/', target)).toBeNull();
    expect(onSiteAddress('/\\other.example/', target)).toBeNull();
    expect(onSiteAddress('file:///etc/passwd', target)).toBeNull();
    expect(onSiteAddress('javascript:alert(1)', target)).toBeNull();
    expect(onSiteAddress('data:text/html,x', target)).toBeNull();
    expect(onSiteAddress('chrome://settings', target)).toBeNull();
    expect(onSiteAddress('https://user:pw@example.com/', target)).toBeNull();
  });

  it('keeps foreign address only when in allowedHosts', () => {
    expect(onSiteAddress('https://auth.partner.example/login', target)).toBeNull();
    expect(onSiteAddress('https://auth.partner.example/login', target, ['auth.partner.example'])).toBe(
      'https://auth.partner.example/login'
    );
  });
});

describe('isSitePath', () => {
  it('accepts valid site paths', () => {
    expect(isSitePath('/')).toBe(true);
    expect(isSitePath('/a/b?x=1')).toBe(true);
  });

  it('rejects empty, scheme-relative, relative, or foreign paths', () => {
    expect(isSitePath('')).toBe(false);
    expect(isSitePath('pricing')).toBe(false);
    expect(isSitePath('//x')).toBe(false);
    expect(isSitePath('/\\x')).toBe(false);
    expect(isSitePath('https://example.com/')).toBe(false);
    expect(isSitePath('file:///x')).toBe(false);
  });
});

describe('resolveCredentialPlaceholders', () => {
  const roles = [{ role: 'manager', username: 'm@example.com', password: 'pw' }];

  it('resolves credentials on the target site and www twin', () => {
    expect(
      resolveCredentialPlaceholders('{{password}}', 'manager', roles, {
        pageUrl: 'https://example.com/login',
        targetUrl: 'https://example.com/',
      })
    ).toBe('pw');
    expect(
      resolveCredentialPlaceholders('{{password}}', 'manager', roles, {
        pageUrl: 'https://www.example.com/login',
        targetUrl: 'https://example.com/',
      })
    ).toBe('pw');
  });

  it('throws CredentialPlaceholderError when on another origin', () => {
    expect(() =>
      resolveCredentialPlaceholders('{{password}}', 'manager', roles, {
        pageUrl: 'https://other.example/login',
        targetUrl: 'https://example.com/',
      })
    ).toThrow(CredentialPlaceholderError);
  });

  it('throws CredentialPlaceholderError when protocol is downgraded', () => {
    expect(() =>
      resolveCredentialPlaceholders('{{password}}', 'manager', roles, {
        pageUrl: 'http://example.com/login',
        targetUrl: 'https://example.com/',
      })
    ).toThrow(CredentialPlaceholderError);
  });

  it('throws CredentialPlaceholderError when role has no sign-in details', () => {
    expect(() =>
      resolveCredentialPlaceholders('{{password}}', 'visitor', roles, {
        pageUrl: 'https://example.com/login',
        targetUrl: 'https://example.com/',
      })
    ).toThrow(CredentialPlaceholderError);
  });

  it('returns plain text without placeholders unchanged regardless of page', () => {
    expect(
      resolveCredentialPlaceholders('hello', 'manager', roles, {
        pageUrl: 'https://other.example/login',
        targetUrl: 'https://example.com/',
      })
    ).toBe('hello');
  });
});

describe('PlanValidator with site paths', () => {
  const pages: PageInventoryItem[] = [
    {
      urlPath: '/invoices/new',
      title: 'Create Invoice',
      interactiveElementsCount: 1,
      formsCount: 0,
      elements: [
        {
          role: 'textbox',
          name: 'Customer',
          selector: '[data-testid="customer-field"]',
          tagName: 'input',
          visible: true,
          enabled: true,
        },
      ],
    },
    {
      urlPath: '/dashboard',
      title: 'Dashboard',
      interactiveElementsCount: 1,
      formsCount: 0,
      elements: [
        {
          role: 'button',
          name: 'Save',
          selector: '[data-testid="save-btn"]',
          tagName: 'button',
          visible: true,
          enabled: true,
        },
      ],
    },
  ];

  const validator = new PlanValidator(pages);

  it('flags start pages and navigate steps that leave the site', () => {
    const foreignStart: DiscoveredFlow = {
      id: 'FLOW-1',
      name: 'Flow 1',
      role: 'manager',
      description: '',
      startPage: 'https://other.example/',
      steps: [{ action: 'navigate', value: '/invoices/new', name: 'Go to invoice' }],
    };
    const issuesStart = validator.checkFlow(foreignStart);
    expect(issuesStart.some((i) => i.stepIndex === -1 && i.message.includes('https://other.example/'))).toBe(true);

    const foreignNav: DiscoveredFlow = {
      id: 'FLOW-2',
      name: 'Flow 2',
      role: 'manager',
      description: '',
      startPage: '/dashboard',
      steps: [{ action: 'navigate', value: '//other.example/x', name: 'Go to other' }],
    };
    const issuesNav = validator.checkFlow(foreignNav);
    expect(issuesNav.some((i) => i.stepIndex === 0 && i.message.includes('//other.example/x'))).toBe(true);

    const validFlow: DiscoveredFlow = {
      id: 'FLOW-3',
      name: 'Flow 3',
      role: 'manager',
      description: '',
      startPage: '/dashboard',
      steps: [{ action: 'navigate', value: '/invoices/new', name: 'Go to invoice' }],
    };
    const validIssues = validator.checkFlow(validFlow);
    expect(validIssues).toEqual([]);
  });
});
