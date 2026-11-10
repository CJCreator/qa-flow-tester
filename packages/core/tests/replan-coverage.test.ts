import { describe, it, expect } from 'vitest';
import type { DiscoveryDraft, PageInventoryItem } from '@qa/types';
import { currentCoverage } from '../src/plan/replan.js';

describe('currentCoverage', () => {
  it('keeps sample pages from the existing plan', () => {
    const pages: PageInventoryItem[] = Array.from({ length: 7 }, (_, i) => ({
      urlPath: `/products/item-${i + 1}`,
      title: 'P',
      links: [],
      interactiveElementsCount: 1,
      formsCount: 0,
      layoutGroup: 'layout-abc',
    })) as unknown as PageInventoryItem[];

    const planPages = [
      { urlPath: '/products/item-1', coverage: 'sample' as const, layoutGroup: 'layout-abc' },
      { urlPath: '/products/item-2', coverage: 'sample' as const, layoutGroup: 'layout-abc' },
      { urlPath: '/products/item-3', coverage: 'sample' as const, layoutGroup: 'layout-abc' },
      {
        urlPath: '/products/item-4',
        coverage: 'covered' as const,
        layoutGroup: 'layout-abc',
        coveredBy: ['/products/item-1', '/products/item-2', '/products/item-3'],
      },
      {
        urlPath: '/products/item-5',
        coverage: 'covered' as const,
        layoutGroup: 'layout-abc',
        coveredBy: ['/products/item-1', '/products/item-2', '/products/item-3'],
      },
      {
        urlPath: '/products/item-6',
        coverage: 'covered' as const,
        layoutGroup: 'layout-abc',
        coveredBy: ['/products/item-1', '/products/item-2', '/products/item-3'],
      },
      {
        urlPath: '/products/item-7',
        coverage: 'covered' as const,
        layoutGroup: 'layout-abc',
        coveredBy: ['/products/item-1', '/products/item-2', '/products/item-3'],
      },
    ];

    const draft = {
      targetUrl: 'http://example.com',
      pages,
      plan: {
        pages: planPages,
      },
    } as unknown as DiscoveryDraft;

    const coverage = currentCoverage(draft);

    expect(coverage.get('/products/item-1')?.coverage).toBe('sample');
    expect(coverage.get('/products/item-2')?.coverage).toBe('sample');
    expect(coverage.get('/products/item-3')?.coverage).toBe('sample');
    expect(coverage.get('/products/item-4')?.coverage).toBe('covered');
    expect(coverage.get('/products/item-7')?.coverage).toBe('covered');
  });

  it('samples fresh pages that are in draft.pages but not in draft.plan.pages', () => {
    const pages: PageInventoryItem[] = [
      {
        urlPath: '/about',
        title: 'About',
        links: [],
        interactiveElementsCount: 1,
        formsCount: 0,
        layoutGroup: 'layout-single',
      } as unknown as PageInventoryItem,
    ];

    const draft = {
      targetUrl: 'http://example.com',
      pages,
      plan: {
        pages: [],
      },
    } as unknown as DiscoveryDraft;

    const coverage = currentCoverage(draft);
    expect(coverage.has('/about')).toBe(true);
  });

  it('gives promoted coverage to a page with added: true', () => {
    const pages: PageInventoryItem[] = [
      {
        urlPath: '/custom',
        title: 'Custom',
        links: [],
        interactiveElementsCount: 1,
        formsCount: 0,
        layoutGroup: 'layout-custom',
      } as unknown as PageInventoryItem,
    ];

    const draft = {
      targetUrl: 'http://example.com',
      pages,
      plan: {
        pages: [{ urlPath: '/custom', added: true, layoutGroup: 'layout-custom' }],
      },
    } as unknown as DiscoveryDraft;

    const coverage = currentCoverage(draft);
    expect(coverage.get('/custom')?.coverage).toBe('promoted');
  });
});
