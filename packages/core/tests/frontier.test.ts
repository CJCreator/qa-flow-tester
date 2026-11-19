import { describe, it, expect } from 'vitest';
import { normalizeRoute, CrawlFrontier } from '../src/discovery/frontier.js';

describe('Frontier and normalizeRoute (T-112)', () => {
  it('normalizes paths: lowercases, collapses duplicate slashes, trims trailing slash', () => {
    const res = normalizeRoute('//Foo//Bar/', 'http://example.com');
    expect(res.path).toBe('/foo/bar');
    expect(res.key).toBe('/foo/bar');

    const root = normalizeRoute('/', 'http://example.com');
    expect(root.path).toBe('/');
    expect(root.key).toBe('/');
  });

  it('drops query params by default, preserves only routeQueryParams when requested', () => {
    const dropped = normalizeRoute('/search?q=shoes&sort=asc', 'http://example.com');
    expect(dropped.key).toBe('/search');
    expect(dropped.search).toBe('?q=shoes&sort=asc');

    const kept = normalizeRoute('/search?sort=asc&q=shoes&ignore=1', 'http://example.com', {
      routeQueryParams: ['q', 'sort'],
    });
    // Allowed params are sorted for stability
    expect(kept.key).toBe('/search?q=shoes&sort=asc');
  });

  it('drops hash by default, preserves hash when includeHash is true', () => {
    const dropped = normalizeRoute('/lab/hash#/two', 'http://example.com');
    expect(dropped.key).toBe('/lab/hash');
    expect(dropped.hash).toBe('#/two');

    const kept = normalizeRoute('/lab/hash#/two', 'http://example.com', {
      includeHash: true,
    });
    expect(kept.key).toBe('/lab/hash#/two');
  });

  it('computes shapes: replaces digit runs, UUIDs, and hex tokens', () => {
    expect(normalizeRoute('/lab/trap/1', 'http://example.com').shape).toBe('/lab/trap/:n');
    expect(normalizeRoute('/lab/trap/999', 'http://example.com').shape).toBe('/lab/trap/:n');

    expect(normalizeRoute('/items/550e8400-e29b-41d4-a716-446655440000', 'http://example.com').shape).toBe(
      '/items/:id'
    );
    expect(normalizeRoute('/commit/a1b2c3d4e5', 'http://example.com').shape).toBe('/commit/:id');

    const cal1 = normalizeRoute('/lab/calendar?month=2026-10', 'http://example.com', {
      routeQueryParams: ['month'],
    });
    const cal2 = normalizeRoute('/lab/calendar?month=2026-11', 'http://example.com', {
      routeQueryParams: ['month'],
    });
    expect(cal1.shape).toBe('/lab/calendar?month=:n-:n');
    expect(cal2.shape).toBe('/lab/calendar?month=:n-:n');
    expect(cal1.shape).toBe(cal2.shape);
  });

  describe('CrawlFrontier', () => {
    it('admits new URL, rejects duplicates', () => {
      const frontier = new CrawlFrontier({ maxPerShape: 5, maxDepth: 3 });
      const first = frontier.admit('/page1', 'http://example.com', 0);
      expect(first.admit).toBe(true);
      expect(first.key).toBe('/page1');

      const dup = frontier.admit('/page1', 'http://example.com', 1);
      expect(dup.admit).toBe(false);
      expect(dup.reason).toBe('duplicate');
    });

    it('enforces maxDepth limit', () => {
      const frontier = new CrawlFrontier({ maxPerShape: 5, maxDepth: 2 });
      expect(frontier.admit('/d0', 'http://example.com', 0).admit).toBe(true);
      expect(frontier.admit('/d1', 'http://example.com', 1).admit).toBe(true);
      expect(frontier.admit('/d2', 'http://example.com', 2).admit).toBe(true);
      const d3 = frontier.admit('/d3', 'http://example.com', 3);
      expect(d3.admit).toBe(false);
      expect(d3.reason).toBe('depth-limit');
    });

    it('enforces maxPerShape limit', () => {
      const frontier = new CrawlFrontier({ maxPerShape: 3, maxDepth: 10 });
      expect(frontier.admit('/lab/trap/1', 'http://example.com', 1).admit).toBe(true);
      expect(frontier.admit('/lab/trap/2', 'http://example.com', 1).admit).toBe(true);
      expect(frontier.admit('/lab/trap/3', 'http://example.com', 1).admit).toBe(true);

      const trap4 = frontier.admit('/lab/trap/4', 'http://example.com', 1);
      expect(trap4.admit).toBe(false);
      expect(trap4.reason).toBe('trap-limit');

      // Different shape still admitted
      expect(frontier.admit('/other-page', 'http://example.com', 1).admit).toBe(true);
    });

    it('marks visited and checks has', () => {
      const frontier = new CrawlFrontier();
      frontier.admit('/home', 'http://example.com', 0);
      expect(frontier.has('/home')).toBe(true);
      expect(frontier.has('/about')).toBe(false);

      frontier.markVisited('/home');
      expect(frontier.has('/home')).toBe(true);
    });
  });
});

describe('CrawlFrontier serialize and restore (T-407)', () => {
  it('a restored frontier refuses what the saved one held and keeps its shape counts', () => {
    const base = 'http://example.com';
    const saved = new CrawlFrontier({ maxPerShape: 2 });
    saved.admit('/a', base, 1);
    saved.markVisited('/a');
    saved.admit('/p/1', base, 1);
    saved.admit('/p/2', base, 1);
    const state = JSON.parse(JSON.stringify(saved.serialize()));

    const restored = CrawlFrontier.restore(state, { maxPerShape: 2 });
    expect(restored.isVisited('/a')).toBe(true);
    expect(restored.admit('/a', base, 1).reason).toBe('duplicate');
    expect(restored.admit('/p/2', base, 1).reason).toBe('duplicate');
    expect(restored.admit('/p/3', base, 1).reason).toBe('trap-limit');
    expect(restored.admit('/b', base, 1).admit).toBe(true);
  });
});
