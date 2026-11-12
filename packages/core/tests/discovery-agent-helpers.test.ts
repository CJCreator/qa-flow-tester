import { describe, it, expect, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import type { StorageStateData } from '@qa/types';
import { mergeCrawls, restoreSession } from '../src/discovery/discovery-agent.js';
import type { SpiderResult } from '../src/discovery/deterministic-spider.js';

function createSpiderResult(partial: Partial<SpiderResult> = {}): SpiderResult {
  return {
    pages: [],
    forms: [],
    sensitiveActions: [],
    ambiguityQuestions: [],
    signInWalls: [],
    ...partial,
  };
}

describe('DiscoveryAgent helpers', () => {
  describe('mergeCrawls', () => {
    it('visitor crawl and role crawl reaching same path give one page with reachedBy: ["visitor", "admin"] and role elements', () => {
      const visitorPage = {
        urlPath: '/dashboard',
        title: 'Visitor View',
        interactiveElementsCount: 1,
        formsCount: 0,
        elements: [{ selector: '#visitor-btn', tagName: 'button', visible: true, enabled: true }],
      };
      const adminPage = {
        urlPath: '/dashboard',
        title: 'Admin View',
        interactiveElementsCount: 3,
        formsCount: 1,
        elements: [
          { selector: '#admin-panel', tagName: 'div', visible: true, enabled: true },
          { selector: '#delete-user', tagName: 'button', visible: true, enabled: true },
        ],
      };

      const merged = mergeCrawls([
        { who: 'visitor', result: createSpiderResult({ pages: [visitorPage as never] }) },
        { who: 'admin', result: createSpiderResult({ pages: [adminPage as never] }) },
      ]);

      expect(merged.pages).toHaveLength(1);
      const page = merged.pages[0];
      expect(page.urlPath).toBe('/dashboard');
      expect(page.reachedBy).toEqual(['visitor', 'admin']);
      expect(page.title).toBe('Admin View');
      expect(page.elements).toEqual([
        { selector: '#admin-panel', tagName: 'div', visible: true, enabled: true },
        { selector: '#delete-user', tagName: 'button', visible: true, enabled: true },
      ]);
    });

    it('a link seen by both has seenBy of both and keeps first landsOn', () => {
      const visitorPage = {
        urlPath: '/home',
        title: 'Home',
        interactiveElementsCount: 1,
        formsCount: 0,
        links: [
          {
            name: 'Profile',
            selector: 'a.profile-link',
            to: '/profile',
            landsOn: '/login',
          },
        ],
      };
      const adminPage = {
        urlPath: '/home',
        title: 'Home',
        interactiveElementsCount: 1,
        formsCount: 0,
        links: [
          {
            name: 'Profile',
            selector: 'a.profile-link',
            to: '/profile',
            landsOn: '/profile',
          },
        ],
      };

      const merged = mergeCrawls([
        { who: 'visitor', result: createSpiderResult({ pages: [visitorPage] }) },
        { who: 'admin', result: createSpiderResult({ pages: [adminPage] }) },
      ]);

      const link = merged.pages[0].links?.[0];
      expect(link).toBeDefined();
      expect(link?.seenBy).toEqual(['visitor', 'admin']);
      expect(link?.landsOn).toBe('/login');
    });

    it('a role landsOn is stored in landsOnBy under that role', () => {
      const visitorPage = {
        urlPath: '/home',
        title: 'Home',
        interactiveElementsCount: 1,
        formsCount: 0,
        links: [
          {
            name: 'Settings',
            selector: 'a#settings',
            to: '/settings',
            landsOn: '/login',
          },
        ],
      };
      const rolePage = {
        urlPath: '/home',
        title: 'Home',
        interactiveElementsCount: 1,
        formsCount: 0,
        links: [
          {
            name: 'Settings',
            selector: 'a#settings',
            to: '/settings',
            landsOn: '/settings',
          },
        ],
      };

      const merged = mergeCrawls([
        { who: 'visitor', result: createSpiderResult({ pages: [visitorPage] }) },
        { who: 'admin', result: createSpiderResult({ pages: [rolePage] }) },
      ]);

      const link = merged.pages[0].links?.[0];
      expect(link?.landsOnBy).toEqual({
        visitor: '/login',
        admin: '/settings',
      });
    });

    it('a sign-in wall reached by a role is not listed in signInWalls', () => {
      const visitorResult = createSpiderResult({
        signInWalls: ['/members-area', '/admin-panel'],
      });
      const roleResult = createSpiderResult({
        pages: [
          {
            urlPath: '/members-area',
            title: 'Members Area',
            interactiveElementsCount: 0,
            formsCount: 0,
          },
        ],
        signInWalls: [],
      });

      const merged = mergeCrawls([
        { who: 'visitor', result: visitorResult },
        { who: 'admin', result: roleResult },
      ]);

      expect(merged.signInWalls).toEqual(['/admin-panel']);
      expect(merged.signInWalls).not.toContain('/members-area');
    });

    it('forms and sensitive actions with the same key are listed once', () => {
      const duplicateForm1 = {
        urlPath: '/checkout',
        action: '/process-order',
        submitButtonSelector: 'button#pay',
        fields: [],
      };
      const duplicateForm2 = {
        urlPath: '/checkout',
        action: '/process-order',
        submitButtonSelector: 'button#pay',
        fields: [],
      };
      const duplicateAction1 = {
        type: 'deletion' as const,
        elementSelector: 'button.delete-account',
        elementText: 'Delete Account',
        urlPath: '/settings',
        reason: 'Deletes user account',
      };
      const duplicateAction2 = {
        type: 'deletion' as const,
        elementSelector: 'button.delete-account',
        elementText: 'Delete Account',
        urlPath: '/settings',
        reason: 'Deletes user account',
      };

      const merged = mergeCrawls([
        {
          who: 'visitor',
          result: createSpiderResult({
            forms: [duplicateForm1 as never],
            sensitiveActions: [duplicateAction1],
          }),
        },
        {
          who: 'admin',
          result: createSpiderResult({
            forms: [duplicateForm2 as never],
            sensitiveActions: [duplicateAction2],
          }),
        },
      ]);

      expect(merged.forms).toHaveLength(1);
      expect(merged.forms[0].action).toBe('/process-order');
      expect(merged.sensitiveActions).toHaveLength(1);
      expect(merged.sensitiveActions[0].elementSelector).toBe('button.delete-account');
    });

    it('ambiguity questions are renumbered Q-001, Q-002', () => {
      const question1 = {
        id: 'Q-OLD-999',
        urlPath: '/step1',
        targetElement: '#action-1',
        category: 'sensitive_action' as const,
        question: 'Allow action 1?',
        options: ['Yes', 'No'],
      };
      const question2 = {
        id: 'Q-OLD-888',
        urlPath: '/step2',
        targetElement: '#action-2',
        category: 'untested_form' as const,
        question: 'Allow action 2?',
        options: ['Yes', 'No'],
      };

      const merged = mergeCrawls([
        { who: 'visitor', result: createSpiderResult({ ambiguityQuestions: [question1] }) },
        { who: 'admin', result: createSpiderResult({ ambiguityQuestions: [question2] }) },
      ]);

      expect(merged.ambiguityQuestions).toHaveLength(2);
      expect(merged.ambiguityQuestions[0].id).toBe('Q-001');
      expect(merged.ambiguityQuestions[0].question).toBe('Allow action 1?');
      expect(merged.ambiguityQuestions[1].id).toBe('Q-002');
      expect(merged.ambiguityQuestions[1].question).toBe('Allow action 2?');
    });
  });

  describe('restoreSession', () => {
    it('cookies are cleared then added', async () => {
      const fakePage = {
        evaluate: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;
      const fakeContext = {
        clearCookies: vi.fn().mockResolvedValue(undefined),
        addCookies: vi.fn().mockResolvedValue(undefined),
        addInitScript: vi.fn().mockResolvedValue(undefined),
        pages: vi.fn().mockReturnValue([fakePage]),
      } as unknown as BrowserContext;

      const state: StorageStateData = {
        cookies: [{ name: 'auth_token', value: 'token-abc', domain: 'example.com', path: '/' }],
        origins: [],
      };

      await restoreSession(fakeContext, state);

      expect(fakeContext.clearCookies).toHaveBeenCalledTimes(1);
      expect(fakeContext.addCookies).toHaveBeenCalledTimes(1);
      expect(fakeContext.addCookies).toHaveBeenCalledWith(state.cookies);
    });

    it('origin with localStorage entries gets init script and evaluate on open pages', async () => {
      const fakePage = {
        evaluate: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;
      const fakeContext = {
        clearCookies: vi.fn().mockResolvedValue(undefined),
        addCookies: vi.fn().mockResolvedValue(undefined),
        addInitScript: vi.fn().mockResolvedValue(undefined),
        pages: vi.fn().mockReturnValue([fakePage]),
      } as unknown as BrowserContext;

      const entries = [{ name: 'jwt', value: 'xyz-secret-token' }];
      const state: StorageStateData = {
        cookies: [],
        origins: [
          {
            origin: 'https://app.example.com',
            localStorage: entries,
          },
        ],
      };

      await restoreSession(fakeContext, state);

      expect(fakeContext.addInitScript).toHaveBeenCalledTimes(1);
      expect(fakeContext.addInitScript).toHaveBeenCalledWith(expect.any(Function), {
        origin: 'https://app.example.com',
        entries,
      });

      expect(fakePage.evaluate).toHaveBeenCalledTimes(1);
      expect(fakePage.evaluate).toHaveBeenCalledWith(expect.any(Function), {
        origin: 'https://app.example.com',
        entries,
      });
    });

    it('origin with no entries is skipped', async () => {
      const fakePage = {
        evaluate: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;
      const fakeContext = {
        clearCookies: vi.fn().mockResolvedValue(undefined),
        addCookies: vi.fn().mockResolvedValue(undefined),
        addInitScript: vi.fn().mockResolvedValue(undefined),
        pages: vi.fn().mockReturnValue([fakePage]),
      } as unknown as BrowserContext;

      const state: StorageStateData = {
        cookies: [],
        origins: [
          { origin: 'https://no-entries.com', localStorage: [] },
          { origin: '', localStorage: [{ name: 'key', value: 'val' }] },
        ],
      };

      await restoreSession(fakeContext, state);

      expect(fakeContext.addInitScript).not.toHaveBeenCalled();
      expect(fakePage.evaluate).not.toHaveBeenCalled();
    });

    it('evaluate that rejects does not throw', async () => {
      const fakePage = {
        evaluate: vi.fn().mockRejectedValue(new Error('Cross-origin storage access denied')),
      } as unknown as Page;
      const fakeContext = {
        clearCookies: vi.fn().mockResolvedValue(undefined),
        addCookies: vi.fn().mockResolvedValue(undefined),
        addInitScript: vi.fn().mockResolvedValue(undefined),
        pages: vi.fn().mockReturnValue([fakePage]),
      } as unknown as BrowserContext;

      const state: StorageStateData = {
        cookies: [],
        origins: [
          {
            origin: 'https://app.example.com',
            localStorage: [{ name: 'item', value: '1' }],
          },
        ],
      };

      await expect(restoreSession(fakeContext, state)).resolves.not.toThrow();
      expect(fakePage.evaluate).toHaveBeenCalledTimes(1);
    });

    it('nothing logged to console', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const fakePage = {
        evaluate: vi.fn().mockResolvedValue(undefined),
      } as unknown as Page;
      const fakeContext = {
        clearCookies: vi.fn().mockResolvedValue(undefined),
        addCookies: vi.fn().mockResolvedValue(undefined),
        addInitScript: vi.fn().mockResolvedValue(undefined),
        pages: vi.fn().mockReturnValue([fakePage]),
      } as unknown as BrowserContext;

      const state: StorageStateData = {
        cookies: [{ name: 'session', value: 'test', domain: 'example.com', path: '/' }],
        origins: [
          {
            origin: 'https://app.example.com',
            localStorage: [{ name: 'jwt', value: '123' }],
          },
        ],
      };

      try {
        await restoreSession(fakeContext, state);

        expect(logSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();
        expect(infoSpy).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
        infoSpy.mockRestore();
      }
    });
  });
});
