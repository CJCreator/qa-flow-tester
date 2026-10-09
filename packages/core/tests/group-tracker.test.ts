/** GroupTracker (pipelined planning) against sampleLayoutGroups: same groups, samples chosen at arrival. */
import { describe, it, expect } from 'vitest';
import type { PageInventoryItem } from '@qa/types';
import { GroupTracker, sampleLayoutGroups } from '../src/plan/sampling.js';

const page = (urlPath: string, layoutGroup?: string): PageInventoryItem => ({
  urlPath,
  title: urlPath,
  interactiveElementsCount: 0,
  formsCount: 0,
  elements: [],
  layoutGroup,
});

const site = [
  page('/about', 'layout-a'),
  page('/products/1', 'layout-p'),
  page('/products/2', 'layout-p'),
  page('/pricing', 'layout-a'),
  page('/products/3', 'layout-p'),
  page('/orders/1', 'layout-o'),
  page('/products/4', 'layout-p'),
  page('/orders/2', 'layout-o'),
  page('/products/5', 'layout-p'),
  page('/news/1', 'layout-n'),
];

describe('GroupTracker', () => {
  it('reports each arrival: fixed address tested, members 1-3 planned, 4+ covered by the first three', () => {
    const t = new GroupTracker();
    const got = site.map((p) => ({ path: p.urlPath, ...t.add(p) }));
    expect(got.find((g) => g.path === '/about')).toMatchObject({ coverage: 'tested', planNow: true });
    expect(got.find((g) => g.path === '/products/3')).toMatchObject({ coverage: 'sample', planNow: true });
    const fourth = got.find((g) => g.path === '/products/4')!;
    expect(fourth).toMatchObject({ coverage: 'covered', planNow: false });
    expect(fourth.coveredBy).toEqual(['/products/1', '/products/2', '/products/3']);
    expect(got.find((g) => g.path === '/products/5')!.coveredBy).toEqual(fourth.coveredBy);
  });

  it('matches sampleLayoutGroups on groups and on which pages are tested, except which pages are samples', () => {
    const t = new GroupTracker();
    for (const p of site) t.add(p);
    const mine = t.finish();
    const theirs = sampleLayoutGroups(site);
    expect(mine.groups.map((g) => ({ id: g.id, name: g.name, pages: g.pages }))).toEqual(
      theirs.groups.map((g) => ({ id: g.id, name: g.name, pages: g.pages }))
    );
    const count = (m: typeof mine.coverage, c: string) => site.filter((p) => m.get(p.urlPath)!.coverage === c).length;
    for (const c of ['tested', 'sample', 'covered']) expect(count(mine.coverage, c)).toBe(count(theirs.coverage, c));
    for (const p of site) expect(mine.coverage.get(p.urlPath)!.layoutGroup).toBe(theirs.coverage.get(p.urlPath)!.layoutGroup);
  });

  it('keeps the first three as samples (never replaced) and a group of 2 or 3 all tested', () => {
    const t = new GroupTracker();
    for (const p of site) t.add(p);
    const { groups, coverage } = t.finish();
    const products = groups.find((g) => g.name.includes('products'))!;
    expect(products.samples).toEqual(['/products/1', '/products/2', '/products/3']);
    expect(coverage.get('/products/4')).toMatchObject({ coverage: 'covered', coveredBy: products.samples });
    expect(coverage.get('/orders/1')!.coverage).toBe('tested');
    expect(coverage.get('/orders/2')!.coverage).toBe('tested');
    // A lone templated page is a group of one: tested, no group.
    expect(coverage.get('/news/1')).toEqual({ coverage: 'tested' });
  });
});
