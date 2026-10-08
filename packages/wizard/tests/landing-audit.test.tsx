import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EMPTY_FORM, type CheckupForm } from '../src/lib/form';

// The screens read window.location.origin while rendering; there is no browser in a node test.
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

const SCREENS = fileURLToPath(new URL('../src/screens/', import.meta.url));

async function landingMarkup(): Promise<string> {
  const { LandingScreen } = await import('../src/screens/LandingScreen');
  return renderToStaticMarkup(createElement(LandingScreen));
}

async function newCheckupMarkup(form: CheckupForm): Promise<string> {
  const { NewCheckupScreen } = await import('../src/screens/NewCheckupScreen');
  return renderToStaticMarkup(
    createElement(NewCheckupScreen, {
      ai: { configured: true, model: 'm' },
      onKeySaved: () => undefined,
      form,
      onFormChange: () => undefined,
      onStart: () => undefined,
      starting: false,
      startError: null,
      inProgress: null,
      recent: null,
    })
  );
}

/** The markup of the <details> that opens at `from`, with nested <details> counted. */
function detailsAt(html: string, from: number): string {
  let depth = 0;
  const re = /<details\b|<\/details>/g;
  re.lastIndex = from;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</details>' ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index + m[0].length);
  }
  throw new Error('details never closes');
}

function moreOptions(html: string): { open: string; inside: string; outside: string } {
  const marker = html.indexOf('data-testid="more-options"');
  expect(marker, 'More options block is missing').toBeGreaterThan(-1);
  const start = html.lastIndexOf('<details', marker);
  const inside = detailsAt(html, start);
  return {
    open: html.slice(start, html.indexOf('>', marker) + 1),
    inside,
    outside: html.slice(0, start) + html.slice(start + inside.length),
  };
}

describe('new check-up screen', () => {
  it('new check-up renders More options closed with the address field and Scan button outside it', async () => {
    const html = await newCheckupMarkup(EMPTY_FORM);
    const { open, inside, outside } = moreOptions(html);
    expect(open).not.toMatch(/\sopen(=|\s|>)/);
    expect(inside).toContain('More options');
    expect(inside).toContain('Explore up to');
    expect(inside).toContain('Add specs, design notes or journeys');
    expect(outside).toContain('id="url-input"');
    expect(outside).toContain('Scan the site');
    expect(outside).not.toContain('Explore up to');
  });

  it('More options open when a spec is added', async () => {
    const html = await newCheckupMarkup({ ...EMPTY_FORM, specs: 'Only managers see reports' });
    expect(moreOptions(html).open).toMatch(/\sopen(=|\s|>)/);
  });

  it('safety choice (AccessChoice) is outside More options', () => {
    // The choice only renders after an address check, which needs a browser; so check the source order.
    const source = readFileSync(`${SCREENS}NewCheckupScreen.tsx`, 'utf8');
    const choice = source.indexOf('<AccessChoice');
    const proof = source.indexOf('<DomainProofPanel');
    const prod = source.indexOf('This appears to be a live production site');
    const block = source.indexOf('data-testid="more-options"');
    const submit = source.indexOf('Scan the site');
    expect(choice).toBeGreaterThan(-1);
    for (const safety of [choice, proof, prod]) expect(safety).toBeLessThan(block);
    expect(submit).toBeGreaterThan(block);
  });
});

describe('top bar', () => {
  async function topBar(show?: boolean): Promise<string> {
    const { TopBar } = await import('../src/components/TopBar');
    return renderToStaticMarkup(
      createElement(TopBar, { route: { name: 'new' }, checkupInProgress: false, showDeveloperShortcuts: show })
    );
  }

  it('TopBar hides Commands and Keyboard shortcuts by default', async () => {
    for (const html of [await topBar(), await topBar(false)]) {
      expect(html).not.toContain('Commands');
      expect(html).not.toContain('aria-label="Keyboard shortcuts"');
      expect(html).toContain('New check-up');
    }
  });

  it('shows them when showDeveloperShortcuts', async () => {
    const html = await topBar(true);
    expect(html).toContain('Commands');
    expect(html).toContain('aria-label="Keyboard shortcuts"');
  });
});

describe('landing page', () => {
  it('landing hero form has one text input (hero-url) and one submit button; no developer shortcuts', async () => {
    const html = await landingMarkup();
    const form = /<form[^>]*method="get"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';
    expect(form).toContain('id="hero-url"');
    expect(form.match(/<input\b/g)).toHaveLength(1);
    expect(form.match(/<button\b/g)).toHaveLength(1);
    expect(html).not.toContain('Keyboard shortcuts');
    expect(html).not.toContain('Commands');
  });

  it('every area links to /sample-report.html', async () => {
    const { AREAS } = await import('../src/screens/LandingScreen');
    const html = await landingMarkup();
    expect(AREAS).toHaveLength(6);
    for (const area of AREAS) {
      const escaped = area.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/’/g, '(?:’|&#x27;)');
      const link = new RegExp(`<a href="/sample-report\\.html"[^>]*>${escaped}<span class="sr-only">`).exec(html);
      expect(link, `${area.name} has no link to the sample report`).not.toBeNull();
    }
  });

  it('has a Light theme button that starts unpressed', async () => {
    const html = await landingMarkup();
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Light theme<\/button>/);
  });
});
