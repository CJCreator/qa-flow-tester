import { describe, it, expect } from 'vitest';
import type { PageInventoryItem } from '@qa/types';
import { buildSiteGraph, pathOf } from '../src/plan/site-graph.js';

const page = (urlPath: string, title: string, links: Array<{ name: string; to: string }> = []) =>
  ({ urlPath, title, links, interactiveElementsCount: 0, formsCount: 0 }) as unknown as PageInventoryItem;

describe('pathOf', () => {
  it('is the path for a page on the site', () => {
    expect(pathOf('/pricing?plan=pro#top')).toBe('/pricing');
    expect(pathOf('/')).toBe('/');
  });
  it('keeps the origin for a page on another host', () => {
    expect(pathOf('https://help.example.org/')).toBe('https://help.example.org/');
    expect(pathOf('https://help.example.org/faq?x=1')).toBe('https://help.example.org/faq');
  });
});

describe('buildSiteGraph with another host in the Plan', () => {
  it('starts click paths from the site’s own home page', () => {
    const pages = [
      page('/', 'Home', [{ name: 'Pricing', to: '/pricing' }]),
      page('/pricing', 'Pricing'),
      page('https://help.example.org/', 'Help centre', [{ name: 'FAQ', to: 'https://help.example.org/faq' }]),
      page('https://help.example.org/faq', 'FAQ'),
    ];
    const graph = buildSiteGraph(pages, '/');
    expect(graph.clickPaths.get('/')).toEqual([]);
    expect(graph.clickPaths.get('/pricing')).toEqual(['Pricing']);
  });
});
