import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import type { ElementInventoryItem, PageInventoryItem } from '@qa/types';
import { lookAtNarrowScreens } from '../src/plan/narrow-look.js';

let stubElements: ElementInventoryItem[] = [];

vi.mock('../src/discovery/element-inventory.js', () => ({
  collectElementInventory: vi.fn(async () => stubElements),
}));

function createFakeContext() {
  const fakePage = {
    goto: vi.fn(async () => null),
  } as unknown as Page;

  const fakeContext = {
    newPage: vi.fn(async () => fakePage),
    close: vi.fn(async () => undefined),
  } as unknown as BrowserContext;

  return fakeContext;
}

describe('lookAtNarrowScreens', () => {
  beforeEach(() => {
    stubElements = [];
  });

  it('(a) a past deadlineAt makes zero openContext calls', async () => {
    const pages: PageInventoryItem[] = [
      {
        urlPath: '/page-1',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
      {
        urlPath: '/page-2',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
    ];

    const openContext = vi.fn(async () => createFakeContext());

    await lookAtNarrowScreens(pages, {
      baseUrl: 'http://localhost:3000',
      openContext,
      deadlineAt: Date.now() - 1000,
    });

    expect(openContext).not.toHaveBeenCalled();
  });

  it('(b) three pages sharing the same two nav links make one group (two openContext calls, one per size), not three', async () => {
    const pages: PageInventoryItem[] = [
      {
        urlPath: '/page-1',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
      {
        urlPath: '/page-2',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
      {
        urlPath: '/page-3',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
    ];

    const openContext = vi.fn(async () => createFakeContext());

    await lookAtNarrowScreens(pages, {
      baseUrl: 'http://localhost:3000',
      openContext,
    });

    expect(openContext).toHaveBeenCalledTimes(2);
  });

  it('(c) a nav link present on one page only does not split the group', async () => {
    const pages: PageInventoryItem[] = [
      {
        urlPath: '/page-1',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
          { selector: 'nav > a.crumb', landmark: 'nav', name: 'Crumb', to: '/page-1' },
        ],
      } as PageInventoryItem,
      {
        urlPath: '/page-2',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
      {
        urlPath: '/page-3',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
    ];

    const openContext = vi.fn(async () => createFakeContext());

    await lookAtNarrowScreens(pages, {
      baseUrl: 'http://localhost:3000',
      openContext,
    });

    expect(openContext).toHaveBeenCalledTimes(2);
  });

  it('(d) the hidden links and the menu button are marked on every page that shares the menu', async () => {
    stubElements = [
      {
        selector: 'button.menu-toggle',
        name: 'Menu',
        role: 'button',
        visible: true,
        enabled: true,
        landmark: 'header',
      },
      {
        selector: 'nav > a.home',
        name: 'Home',
        role: 'link',
        visible: true,
        enabled: true,
        landmark: 'nav',
      },
    ];

    const pages: PageInventoryItem[] = [
      {
        urlPath: '/page-1',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
      {
        urlPath: '/page-2',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
      {
        urlPath: '/page-3',
        links: [
          { selector: 'nav > a.home', landmark: 'nav', name: 'Home', to: '/' },
          { selector: 'nav > a.about', landmark: 'nav', name: 'About', to: '/about' },
        ],
      } as PageInventoryItem,
    ];

    const openContext = vi.fn(async () => createFakeContext());

    await lookAtNarrowScreens(pages, {
      baseUrl: 'http://localhost:3000',
      openContext,
    });

    expect(openContext).toHaveBeenCalledTimes(2);

    for (const page of pages) {
      const aboutLink = page.links?.find((l) => l.selector === 'nav > a.about');
      expect(aboutLink?.hiddenAt).toEqual(expect.arrayContaining(['375px', '768px']));
      expect(page.narrowMenus).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ breakpoint: '375px', selector: 'button.menu-toggle', name: 'Menu' }),
          expect.objectContaining({ breakpoint: '768px', selector: 'button.menu-toggle', name: 'Menu' }),
        ])
      );
    }
  });
});
