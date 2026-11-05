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
  it('new check-up renders Adjust the check-up closed, one level deep, with the address field and Start outside it', async () => {
    const html = await newCheckupMarkup(EMPTY_FORM);
    const { open, inside, outside } = moreOptions(html);
    expect(open).not.toMatch(/\sopen(=|\s|>)/);
    expect(inside).toContain('Adjust the check-up');
    expect(inside).toContain('Explore up to');
    for (const group of [
      'Pages to explore',
      'Sign in to test pages behind a login',
      'Product context and design notes',
      'Search and AI visibility checks',
      'Details for developers',
    ]) {
      expect(inside).toContain(`<h3 class="mb-3 text-lg font-bold">${group}</h3>`);
    }
    // No disclosure inside the disclosure.
    expect(inside.match(/<details\b/g)).toHaveLength(1);
    expect(outside).toContain('id="url-input"');
    expect(outside).toContain('Start the check-up');
    expect(outside).not.toContain('Explore up to');
  });

  it('Adjust the check-up stays closed with changed or remembered values, and its hint says what they are', async () => {
    const html = await newCheckupMarkup({
      ...EMPTY_FORM,
      maxPages: 20,
      searchChecks: false,
      specs: 'Only managers see reports',
    });
    expect(moreOptions(html).open).not.toMatch(/\sopen(=|\s|>)/);
    expect(html).toContain('20 pages, search checks off, Product context added');
  });

  it('safety choice (AccessChoice) is outside Adjust the check-up', () => {
    // The choice only renders after an address check, which needs a browser; so check the source order.
    const source = readFileSync(`${SCREENS}NewCheckupScreen.tsx`, 'utf8');
    const choice = source.indexOf('<AccessChoice');
    const proof = source.indexOf('<DomainProofPanel');
    const prod = source.indexOf('This looks like a live site');
    const block = source.indexOf('data-testid="more-options"');
    const connectAi = source.indexOf('Connect the AI for a smarter plan');
    const submit = source.indexOf('Start the check-up');
    expect(choice).toBeGreaterThan(-1);
    expect(prod).toBeGreaterThan(-1);
    for (const safety of [choice, proof, prod]) expect(safety).toBeLessThan(block);
    expect(submit).toBeGreaterThan(block);
    // The AI panel sits above Start, not below it.
    expect(connectAi).toBeGreaterThan(-1);
    expect(connectAi).toBeLessThan(submit);
  });

  it('puts the sign-in consent beside the quick sign-in fields, never two editors for the first sign-in', async () => {
    const signIn = { role: '', username: 'alice', password: 'secret', loginPath: '' };
    const quick = await newCheckupMarkup({ ...EMPTY_FORM, signIns: [signIn] });
    const { inside } = moreOptions(quick);
    expect(inside).toContain('data-testid="sign-in-consent"');
    expect(inside).toContain('I accept this');
    expect(quick.match(/id="sign-in-username"/g)).toHaveLength(1);
    expect(quick).not.toContain('Sign-in 1');
    // The reason by Start names the group the box is in.
    expect(quick).toContain('under “Sign in to test pages behind a login”');

    const rows = await newCheckupMarkup({ ...EMPTY_FORM, signIns: [signIn, { ...signIn, role: 'admin' }] });
    expect(rows).toContain('Sign-in 1');
    expect(rows).toContain('Sign-in 2');
    expect(rows).not.toContain('id="sign-in-username"');
  });

  it('has exactly one primary button, also with the Connect the AI panel showing', async () => {
    const { NewCheckupScreen } = await import('../src/screens/NewCheckupScreen');
    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, {
        ai: { configured: false, model: '' } as never,
        onKeySaved: () => undefined,
        form: EMPTY_FORM,
        onFormChange: () => undefined,
        onStart: () => undefined,
        starting: false,
        startError: null,
        inProgress: null,
        recent: null,
      })
    );
    expect(html).toContain('Connect the AI for a smarter plan');
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(html).not.toContain('accent-[');
  });

  it('says only a public address works on the shared copy, in a hint outside the label', async () => {
    const { NewCheckupScreen } = await import('../src/screens/NewCheckupScreen');
    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, {
        ai: { configured: true, model: 'm' },
        onKeySaved: () => undefined,
        form: EMPTY_FORM,
        onFormChange: () => undefined,
        onStart: () => undefined,
        starting: false,
        startError: null,
        inProgress: null,
        recent: null,
        shared: true,
      })
    );
    expect(html).toContain('<p id="url-hint" class="-mt-1 mb-2 text-sm text-ink-soft">A public address</p>');
    expect(html).not.toContain('one on your computer');
    expect(html).toMatch(/id="url-input"[^>]*aria-describedby="url-hint url-status"/);
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
      expect(html).not.toContain('aria-label="Keyboard shortcuts (?)"');
      expect(html).toContain('Check-ups');
    }
  });

  it('shows them when showDeveloperShortcuts', async () => {
    const html = await topBar(true);
    expect(html).toContain('Commands');
    expect(html).toContain('aria-label="Keyboard shortcuts (?)"');
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

  it('has a Dark theme button that starts unpressed (light is the default)', async () => {
    const html = await landingMarkup();
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Dark theme<\/button>/);
  });
});
