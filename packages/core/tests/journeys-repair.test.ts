import { describe, it, expect } from 'vitest';
import type { AICompletion, AIMessage, PageInventoryItem, PageLink } from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { planJourneys } from '../src/plan/journeys.js';

const menu: PageLink[] = [
  { name: 'Home', selector: 'role=link[name="Home"]', to: '/', landmark: 'nav' },
  { name: 'Products', selector: 'role=link[name="Products"]', to: '/products', landmark: 'nav' },
];

function makePage(urlPath: string): PageInventoryItem {
  return {
    urlPath,
    title: urlPath === '/' ? 'Home' : urlPath.slice(1),
    interactiveElementsCount: 0,
    formsCount: 0,
    elements: [],
    reachedBy: ['visitor'],
    links: menu,
    layoutGroup: 'layout-main',
  };
}

describe('Journeys Repair Error Handling (journeys.ts)', () => {
  const defaultInput = {
    targetUrl: 'https://shop.example/',
    productId: 'shop',
    promptPages: [makePage('/'), makePage('/products')],
    spider: { pages: [makePage('/'), makePage('/products')], forms: [] },
    roles: [],
    siteType: 'shop' as const,
    redact: (t: string) => t,
  };

  it('keeps first answer journeys with usedFallback false when first answer parses but has bad step and repair throws', async () => {
    let callCount = 0;
    const fakeProvider: AIProvider = {
      providerType: 'mock',
      async generateText() {
        throw new Error('complete() is used');
      },
      async complete(messages: AIMessage[]): Promise<AICompletion> {
        callCount++;
        if (callCount === 1) {
          // First response parses as JSON but has a fill step with empty value (bad step)
          return {
            text: JSON.stringify({
              flows: [
                {
                  id: 'FLOW-001',
                  name: 'Search products',
                  role: 'visitor',
                  description: 'Search for products on the site',
                  startPage: '/',
                  steps: [
                    {
                      name: 'Fill search query',
                      action: 'fill',
                      selector: 'input[name="q"]',
                      value: '',
                    },
                  ],
                },
              ],
            }),
            finishReason: 'stop',
          };
        }
        // Repair call throws an error (e.g. network error / 503)
        throw new Error('AI service network timeout during repair');
      },
    };

    const result = await planJourneys(defaultInput, fakeProvider);
    expect(callCount).toBe(2);
    expect(result.usedFallback).toBe(false);
    expect(result.flows).toHaveLength(1);
    expect(result.flows[0].id).toBe('FLOW-001');
    expect(result.flows[0].source).toBe('ai');
    // The empty fill step was backfilled
    expect(result.flows[0].steps?.[0]?.value).toBeTruthy();
  });

  it('runs fixed-rule fallback when first answer cannot be parsed and repair throws', async () => {
    let callCount = 0;
    const fakeProvider: AIProvider = {
      providerType: 'mock',
      async generateText() {
        throw new Error('complete() is used');
      },
      async complete(messages: AIMessage[]): Promise<AICompletion> {
        callCount++;
        if (callCount === 1) {
          // First response cannot be parsed as JSON
          return {
            text: 'This is not valid JSON at all {',
            finishReason: 'stop',
          };
        }
        // Repair call throws
        throw new Error('AI service network timeout during repair');
      },
    };

    const result = await planJourneys(defaultInput, fakeProvider);
    expect(callCount).toBe(2);
    expect(result.usedFallback).toBe(true);
    expect(result.flows.length).toBeGreaterThan(0);
    expect(result.flows.every((flow) => flow.source === 'fallback')).toBe(true);
  });
});
