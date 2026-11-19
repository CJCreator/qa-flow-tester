import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { matchRoute, PATHS } from '../src/lib/router';

beforeAll(() => {
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { origin: 'http://localhost:3001', pathname: '/get-started', search: '' },
  });
  vi.stubGlobal('document', { title: '' });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('the get-started address', () => {
  it('is its own route', () => {
    expect(PATHS.getStarted).toBe('/get-started');
    expect(matchRoute('/get-started')).toEqual({ name: 'get-started' });
    expect(matchRoute('/get-started/')).toEqual({ name: 'get-started' });
  });
});

describe('the get-started page', () => {
  const markup = async () => {
    const { GetStartedScreen } = await import('../src/screens/GetStartedScreen');
    return renderToStaticMarkup(createElement(GetStartedScreen));
  };

  it('covers every step a first tester needs', async () => {
    const html = await markup();
    for (const part of [
      'Sign in with Google',
      'Paste your own AI key',
      'https://aistudio.google.com/apikey',
      'Enter your website address',
      'Review the Plan',
      'Start the Check-up',
      'kept for 30 days',
      'Verified Domain',
      'Sensitive Actions',
      'up to a minute',
      'per day',
    ]) {
      expect(html, part).toContain(part);
    }
  });

  it('keeps to the glossary: none of the avoided words', async () => {
    const html = (await markup()).replace(/<[^>]+>/g, ' ');
    for (const word of [/\bscan\b/i, /\bstaging\b/i, /\bpentest\b/i, /\btest case/i, /\bproduct\b/i, /\bsandbox\b/i]) {
      expect(html).not.toMatch(word);
    }
  });

  it('links to the new Check-up screen and the landing page', async () => {
    const html = await markup();
    expect(html).toContain('href="/check"');
    expect(html).toContain('href="/"');
  });
});

describe('the landing page links to it', () => {
  it('has a Get started entry in its navigation', async () => {
    const { LandingScreen } = await import('../src/screens/LandingScreen');
    expect(renderToStaticMarkup(createElement(LandingScreen))).toContain('href="/get-started"');
  });
});
