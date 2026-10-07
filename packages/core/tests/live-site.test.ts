import { describe, it, expect } from 'vitest';
import type { DiscoveredFlow, PageInventoryItem } from '@qa/types';
import { isTestHost, needsTestCopy } from '../src/live-site.js';
import { buildPageSweep } from '../src/discovery/page-sweep.js';

describe('Test hosts (Task 1.5 / D3)', () => {
  it('treats this machine, private networks, Docker and dev tunnels as test copies', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '::1',
      '[::1]',
      'host.docker.internal',
      '10.0.0.4',
      '172.20.1.9',
      '192.168.1.20',
      'app.localhost',
      'abc123-3050.uks1.devtunnels.ms',
      'fd12:3456::1',
    ]) {
      expect(isTestHost(host), host).toBe(true);
    }
  });

  it('treats everything else as live, unless the owner marked it as staging', () => {
    for (const host of ['www.saucedemo.com', 'books.toscrape.com', '172.32.0.1', '8.8.8.8', 'devtunnels.ms.evil.com']) {
      expect(isTestHost(host), host).toBe(false);
    }
    expect(isTestHost('staging.example.com', ['staging.example.com'])).toBe(true);
    expect(isTestHost('www.example.com', ['staging.example.com'])).toBe(false);
  });
});

describe('Journeys that need a test copy', () => {
  const pages: PageInventoryItem[] = [
    {
      urlPath: '/',
      title: 'Shop',
      interactiveElementsCount: 4,
      formsCount: 1,
      elements: [
        {
          role: 'link',
          name: 'Backpack',
          selector: '#item-4',
          tagName: 'a',
          href: '/item/4',
          visible: true,
          enabled: true,
        },
        { role: 'button', name: 'Add to cart', selector: '#add-4', tagName: 'button', visible: true, enabled: true },
        { role: 'button', name: 'Open menu', selector: '#menu', tagName: 'button', visible: true, enabled: true },
        {
          role: 'button',
          name: 'Search',
          selector: '#search-go',
          tagName: 'button',
          visible: true,
          enabled: true,
          insideForm: true,
        },
      ],
    },
  ];
  const forms = [{ urlPath: '/', inputs: [{ selector: '#q' }], submitButtonSelector: '#search-go', method: 'GET' }];
  const flow = (steps: DiscoveredFlow['steps']): DiscoveredFlow => ({
    id: 'F',
    name: 'Journey',
    role: 'visitor',
    description: '',
    startPage: '/',
    steps,
  });

  it('browsing, opening menus, typing and searching need nothing', () => {
    expect(
      needsTestCopy(
        flow([
          { action: 'click', selector: '#menu', name: 'Open menu' },
          { action: 'click', selector: '#item-4', name: 'Open the backpack' },
          { action: 'fill', selector: '#q', value: 'bag', name: 'Type a search' },
          { action: 'click', selector: '#search-go', name: 'Search' },
        ]),
        pages,
        forms
      )
    ).toBe(false);
  });

  it('adding to a cart, sending a POST form or paying needs a test copy', () => {
    expect(needsTestCopy(flow([{ action: 'click', selector: '#add-4', name: 'Add to cart' }]), pages, forms)).toBe(
      true
    );
    expect(
      needsTestCopy(flow([{ action: 'click', selector: '#send', name: 'Go' }]), pages, [
        { urlPath: '/', inputs: [], submitButtonSelector: '#send', method: 'POST' },
      ])
    ).toBe(true);
    expect(needsTestCopy(flow([{ action: 'click', selector: '#pay', name: 'Pay now' }]), pages, forms)).toBe(true);
  });
});

describe('Page sweep (Task 0.8)', () => {
  it('visits each page once for everyone who reached it', () => {
    const sweep = buildPageSweep({
      version: '1',
      productId: 'p',
      targetUrl: 'http://localhost',
      timestamp: '',
      pages: [
        { urlPath: '/', title: 'Home', interactiveElementsCount: 0, formsCount: 0, reachedBy: ['visitor', 'manager'] },
        { urlPath: '/account', title: 'Account', interactiveElementsCount: 0, formsCount: 0, reachedBy: ['manager'] },
      ],
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
    });
    expect(sweep.map((tc) => `${tc.startPage} ${tc.role}`)).toEqual(['/ visitor', '/ manager', '/account manager']);
    expect(new Set(sweep.map((tc) => tc.id)).size).toBe(3);
  });
});
