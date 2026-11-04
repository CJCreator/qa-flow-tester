import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { origin: 'http://localhost:3001', pathname: '/', search: '' },
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('Landing: Website Audit section', () => {
  it('links to /audits/new, states what it does, and keeps the check-up as the main action', async () => {
    const { LandingScreen } = await import('../src/screens/LandingScreen');
    const html = renderToStaticMarkup(createElement(LandingScreen));
    expect(html).toContain('href="/audits/new"');
    expect(html).toMatch(/Website Audit/);
    expect(html).toMatch(/public website/i);
    expect(html).toMatch(/never fills in forms/i);
    expect(html).toMatch(/English or Tamil/);
    expect(html).toMatch(/free for now/i);
    expect(html).toMatch(/Start a free check-up/);
    // The audit section comes after the check-up content.
    expect(html.indexOf('audit-title')).toBeGreaterThan(html.indexOf('final-title'));
  });

  it('on the static site, links to the online copy origin like the check-up button', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/onlineUrl', () => ({ ONLINE_APP_URL: 'https://app.example.com' }));
    vi.stubGlobal('window', {
      addEventListener: () => {},
      removeEventListener: () => {},
      location: { origin: 'https://static.example.com', pathname: '/', search: '' },
    });
    try {
      const { LandingScreen } = await import('../src/screens/LandingScreen');
      const html = renderToStaticMarkup(createElement(LandingScreen));
      expect(html).toContain('href="https://app.example.com/audits/new"');
    } finally {
      vi.doUnmock('../src/lib/onlineUrl');
      vi.resetModules();
    }
  });
});
