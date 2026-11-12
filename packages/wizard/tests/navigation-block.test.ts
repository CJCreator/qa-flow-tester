import { afterEach, describe, expect, it, vi } from 'vitest';

function createFakeWindow(initialUrl: string) {
  let entries = [initialUrl];
  let index = 0;

  class FakeWindow extends EventTarget {
    location = {
      get pathname() {
        const url = new URL(entries[index], 'http://localhost');
        return url.pathname;
      },
      get search() {
        const url = new URL(entries[index], 'http://localhost');
        return url.search;
      },
    };

    history = {
      pushState: (_data: unknown, _unused: string, url: string | URL) => {
        const nextUrl = String(url);
        entries = entries.slice(0, index + 1);
        entries.push(nextUrl);
        index = entries.length - 1;
      },
      replaceState: (_data: unknown, _unused: string, url: string | URL) => {
        const nextUrl = String(url);
        entries[index] = nextUrl;
      },
      back: () => {
        if (index > 0) {
          index--;
          this.dispatchEvent(new Event('popstate'));
        }
      },
      get length() {
        return entries.length;
      },
    };

    scrollTo = () => {};
  }

  return new FakeWindow();
}

async function setup(initialUrl = '/audits/a-1/versions/1/review') {
  vi.resetModules();
  const fake = createFakeWindow(initialUrl);
  vi.stubGlobal('window', fake);
  const router = await import('../src/lib/router');
  return { fake, router };
}

describe('navigation block', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves at once when nothing blocks', async () => {
    const { fake, router } = await setup();
    router.navigate('/audits');
    expect(fake.location.pathname).toBe('/audits');
  });

  it('stays when the person chooses to stay', async () => {
    const { fake, router } = await setup();
    const check = vi.fn(async () => false);
    router.blockNavigation(check);
    router.navigate('/audits');
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.location.pathname).toBe('/audits/a-1/versions/1/review');
    expect(check).toHaveBeenCalledWith('/audits');
  });

  it('moves and lifts the block when the person chooses to leave', async () => {
    const { fake, router } = await setup();
    const check = vi.fn(async () => true);
    router.blockNavigation(check);
    router.navigate('/audits');
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.location.pathname).toBe('/audits');
    router.navigate('/settings');
    expect(check).toHaveBeenCalledTimes(1);
    expect(fake.location.pathname).toBe('/settings');
  });

  it('the returned function lifts the block', async () => {
    const { fake, router } = await setup();
    const check = vi.fn(async () => false);
    const unblock = router.blockNavigation(check);
    unblock();
    router.navigate('/audits');
    expect(check).not.toHaveBeenCalled();
    expect(fake.location.pathname).toBe('/audits');
  });

  it('Back while blocked puts the screen address back and asks', async () => {
    const { fake, router } = await setup('/audits/a-1');
    router.navigate('/audits/a-1/versions/1/review');
    const check = vi.fn(async () => false);
    router.blockNavigation(check);
    fake.history.back();
    expect(fake.location.pathname).toBe('/audits/a-1/versions/1/review');
    expect(check).toHaveBeenCalledWith('/audits/a-1');
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.location.pathname).toBe('/audits/a-1/versions/1/review');
  });

  it('Back confirmed goes back', async () => {
    const { fake, router } = await setup('/audits/a-1');
    router.navigate('/audits/a-1/versions/1/review');
    const check = vi.fn(async () => true);
    router.blockNavigation(check);
    fake.history.back();
    await Promise.resolve();
    await Promise.resolve();
    expect(fake.location.pathname).toBe('/audits/a-1');
    router.navigate('/settings');
    expect(check).toHaveBeenCalledTimes(1);
    expect(fake.location.pathname).toBe('/settings');
  });
});
