import { describe, it, expect } from 'vitest';
import { SeoChecker, isActionLink, isNoindexExempt } from '../src/seo.js';
import type { Page } from 'playwright';
import type { FetchFn } from '../src/security-depth.js';

describe('T-340: SEO noindex exemptions, action link probe filtering, and lengths', () => {
  const checker = new SeoChecker();

  function createMockPage(details: any): Page {
    return {
      evaluate: async () => details,
      context: () => {
        throw new Error('Playwright request API used');
      },
    } as unknown as Page;
  }

  function createMockPageAt(url: string, details: any): Page {
    return { ...(createMockPage(details) as any), url: () => url } as unknown as Page;
  }

  function recordingFetch(
    responseFor: (url: string) => { status: number; headers?: Record<string, string> } = () => ({
      status: 200,
      headers: {},
    })
  ) {
    const calls: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      calls.push(url);
      const res = responseFor(url);
      return { status: res.status, headers: res.headers || {}, text: async () => '' };
    };
    return { fetchFn, calls };
  }

  const basePageDetails = (overrides: Record<string, any> = {}) => ({
    title: 'Valid Page Title Length Here',
    metaDescription: 'This is a valid meta description that easily exceeds fifty characters in total length.',
    h1Count: 1,
    headings: [{ level: 1, text: 'Heading' }],
    htmlLang: 'en',
    sameSiteLinks: [],
    canonicalUrl: 'http://localhost/page',
    canonicalCount: 1,
    hasViewportMeta: true,
    hasFavicon: true,
    imagesWithoutAltCount: 0,
    ...overrides,
  });

  describe('isActionLink helper', () => {
    it('identifies action segments (case-insensitive)', () => {
      expect(isActionLink('/logout')).toBe(true);
      expect(isActionLink('/auth/signout')).toBe(true);
      expect(isActionLink('/user/sign-out')).toBe(true);
      expect(isActionLink('/log-out')).toBe(true);
      expect(isActionLink('/Unsubscribe')).toBe(true);
      expect(isActionLink('/delete?id=7')).toBe(true);
      expect(isActionLink('/cart/remove/123')).toBe(true);
      expect(isActionLink('/order/cancel')).toBe(true);
      expect(isActionLink('/email/confirm')).toBe(true);
      expect(isActionLink('/phone/verify')).toBe(true);
      expect(isActionLink('/account/activate')).toBe(true);
      expect(isActionLink('/request/approve')).toBe(true);
      expect(isActionLink('/checkout')).toBe(true);
      expect(isActionLink('/pay')).toBe(true);
    });

    it('identifies sensitive action query keys', () => {
      expect(isActionLink('/verify?token=abc')).toBe(true);
      expect(isActionLink('/access?KEY=secret')).toBe(true);
      expect(isActionLink('/auth?code=123456')).toBe(true);
      expect(isActionLink('/login?otp=999999')).toBe(true);
      expect(isActionLink('/webhook?signature=sig123')).toBe(true);
      expect(isActionLink('/callback?sig=xyz')).toBe(true);
      expect(isActionLink('/page?action=del')).toBe(true);
      expect(isActionLink('/Unsubscribe?token=abc')).toBe(true);
    });

    it('requires exact segment equality and does not match substrings within segments', () => {
      expect(isActionLink('/about')).toBe(false);
      expect(isActionLink('/blog/cancel-culture-essay')).toBe(false);
      expect(isActionLink('/products/payphone-model-2')).toBe(false);
      expect(isActionLink('/company/delete-my-data-policy')).toBe(false);
      expect(isActionLink('/activate-feature-overview')).toBe(false);
      expect(isActionLink('/pricing')).toBe(false);
    });

    it('handles empty or malformed inputs safely', () => {
      expect(isActionLink('')).toBe(false);
      expect(isActionLink('   ')).toBe(false);
    });
  });

  describe('isNoindexExempt helper', () => {
    it('exempts standard private and transactional routes (exact or leading path segment)', () => {
      expect(isNoindexExempt('/login')).toBe(true);
      expect(isNoindexExempt('/login/oauth')).toBe(true);
      expect(isNoindexExempt('/auth')).toBe(true);
      expect(isNoindexExempt('/auth/callback')).toBe(true);
      expect(isNoindexExempt('/signup')).toBe(true);
      expect(isNoindexExempt('/signup/step-2')).toBe(true);
      expect(isNoindexExempt('/cart')).toBe(true);
      expect(isNoindexExempt('/account')).toBe(true);
      expect(isNoindexExempt('/account/billing')).toBe(true);
      expect(isNoindexExempt('/checkout')).toBe(true);
      expect(isNoindexExempt('/checkout/review')).toBe(true);
      expect(isNoindexExempt('/admin')).toBe(true);
      expect(isNoindexExempt('/admin/users')).toBe(true);
      expect(isNoindexExempt('/dashboard')).toBe(true);
      expect(isNoindexExempt('/dashboard/reports')).toBe(true);
      expect(isNoindexExempt('/settings')).toBe(true);
      expect(isNoindexExempt('/settings/security')).toBe(true);
    });

    it('does not exempt public marketing or content routes', () => {
      expect(isNoindexExempt('/')).toBe(false);
      expect(isNoindexExempt('/pricing')).toBe(false);
      expect(isNoindexExempt('/about')).toBe(false);
      expect(isNoindexExempt('/features')).toBe(false);
      expect(isNoindexExempt('/blog/login')).toBe(false);
      expect(isNoindexExempt('/login-help')).toBe(false);
      expect(isNoindexExempt('')).toBe(false);
    });
  });

  describe('checkBrokenLinks link probe filtering', () => {
    it('skips action links before taking the 5-link slice and does not probe them', async () => {
      const pageWithLinks = createMockPage(
        basePageDetails({
          sameSiteLinks: ['/about', '/logout', '/unsubscribe?token=x'],
        })
      );
      const { fetchFn, calls } = recordingFetch();

      const findings = await checker.checkPage(
        pageWithLinks,
        {
          testCaseId: 'TC-PROBE-1',
          role: 'visitor',
          breakpoint: '1440px',
          urlPath: '/',
          baseUrl: 'http://localhost:3050',
          visibility: { search: false, answers: false, aiSearch: false, marketing: false },
        },
        fetchFn
      );

      // Only /about was probed; /logout and /unsubscribe?token=x were filtered out
      expect(calls).toEqual(['http://localhost:3050/about']);
      expect(findings).toHaveLength(0);
    });

    it('does not report skipped action links as broken or as not checked when only action links are present', async () => {
      const pageWithOnlyActionLinks = createMockPage(
        basePageDetails({
          sameSiteLinks: ['/logout', '/delete?id=10', '/checkout/pay'],
        })
      );
      const { fetchFn, calls } = recordingFetch();

      const findings = await checker.checkPage(
        pageWithOnlyActionLinks,
        {
          testCaseId: 'TC-PROBE-2',
          role: 'visitor',
          breakpoint: '1440px',
          urlPath: '/',
          baseUrl: 'http://localhost:3050',
          visibility: { search: false, answers: false, aiSearch: false, marketing: false },
        },
        fetchFn
      );

      expect(calls).toHaveLength(0);
      expect(findings).toHaveLength(0);
    });
  });

  describe('noindex directive: visitor role and path exemptions', () => {
    it('raises Major noindex finding for public visitor on non-exempt page', async () => {
      const page = createMockPage(basePageDetails({ metaRobots: 'noindex' }));

      const findings = await checker.checkPage(page, {
        testCaseId: 'TC-NOINDEX-PUB',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/pricing',
      });

      const noindexFinding = findings.find((f) =>
        f.title.includes('noindex directive preventing search engine indexing')
      );
      expect(noindexFinding).toBeDefined();
      expect(noindexFinding?.severity).toBe('Major');
      expect(noindexFinding?.expectedVsActual.actual).toContain('meta robots directive is "noindex"');
    });

    it('does not raise noindex finding for non-public roles (e.g. admin, user)', async () => {
      const page = createMockPage(basePageDetails({ metaRobots: 'noindex' }));

      const adminFindings = await checker.checkPage(page, {
        testCaseId: 'TC-NOINDEX-ADMIN',
        role: 'admin',
        breakpoint: '1440px',
        urlPath: '/pricing',
      });
      expect(adminFindings.some((f) => f.title.includes('noindex directive'))).toBe(false);

      const userFindings = await checker.checkPage(page, {
        testCaseId: 'TC-NOINDEX-USER',
        role: 'user',
        breakpoint: '1440px',
        urlPath: '/pricing',
      });
      expect(userFindings.some((f) => f.title.includes('noindex directive'))).toBe(false);
    });

    it('does not raise noindex finding on exempt paths for visitor (e.g. /login, /cart, /settings, /checkout)', async () => {
      const page = createMockPage(basePageDetails({ metaRobots: 'noindex' }));

      const loginFindings = await checker.checkPage(page, {
        testCaseId: 'TC-NOINDEX-LOGIN',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/login',
      });
      expect(loginFindings.some((f) => f.title.includes('noindex directive'))).toBe(false);

      const cartFindings = await checker.checkPage(page, {
        testCaseId: 'TC-NOINDEX-CART',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/cart',
      });
      expect(cartFindings.some((f) => f.title.includes('noindex directive'))).toBe(false);

      const settingsFindings = await checker.checkPage(page, {
        testCaseId: 'TC-NOINDEX-SETTINGS',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/settings',
      });
      expect(settingsFindings.some((f) => f.title.includes('noindex directive'))).toBe(false);
    });
  });

  describe('X-Robots-Tag response header', () => {
    it('detects noindex in X-Robots-Tag header on public visitor page', async () => {
      const page = createMockPageAt('http://localhost:3050/pricing', basePageDetails({ metaRobots: undefined }));
      const { fetchFn } = recordingFetch(() => ({
        status: 200,
        headers: { 'x-robots-tag': 'noindex, nofollow' },
      }));

      const findings = await checker.checkPage(
        page,
        {
          testCaseId: 'TC-XROBOTS-1',
          role: 'visitor',
          breakpoint: '1440px',
          urlPath: '/pricing',
          baseUrl: 'http://localhost:3050',
        },
        fetchFn
      );

      const headerFinding = findings.find((f) => f.expectedVsActual.actual?.includes('X-Robots-Tag header is'));
      expect(headerFinding).toBeDefined();
      expect(headerFinding?.severity).toBe('Major');
      expect(headerFinding?.expectedVsActual.actual).toBe('X-Robots-Tag header is "noindex, nofollow"');
    });

    it('ignores null or failing fetchFn cleanly without raising errors or findings', async () => {
      const page = createMockPageAt('http://localhost:3050/pricing', basePageDetails({ metaRobots: undefined }));
      const nullFetchFn: FetchFn = async () => null as any;
      const throwFetchFn: FetchFn = async () => {
        throw new Error('Network timeout');
      };

      const findingsNull = await checker.checkPage(
        page,
        {
          testCaseId: 'TC-XROBOTS-NULL',
          role: 'visitor',
          breakpoint: '1440px',
          urlPath: '/pricing',
          baseUrl: 'http://localhost:3050',
        },
        nullFetchFn
      );
      expect(findingsNull.some((f) => f.title.includes('noindex directive'))).toBe(false);

      const findingsThrow = await checker.checkPage(
        page,
        {
          testCaseId: 'TC-XROBOTS-THROW',
          role: 'visitor',
          breakpoint: '1440px',
          urlPath: '/pricing',
          baseUrl: 'http://localhost:3050',
        },
        throwFetchFn
      );
      expect(findingsThrow.some((f) => f.title.includes('noindex directive'))).toBe(false);
    });

    it('respects siteWide memoization and only checks x-robots-tag once per urlPath', async () => {
      const siteWide = new Set<string>();
      const page = createMockPageAt('http://localhost:3050/pricing', basePageDetails({ metaRobots: undefined }));
      const { fetchFn, calls } = recordingFetch(() => ({
        status: 200,
        headers: { 'x-robots-tag': 'noindex' },
      }));

      await checker.checkPage(
        page,
        {
          testCaseId: 'TC-XROBOTS-MEMO1',
          role: 'visitor',
          breakpoint: '1440px',
          urlPath: '/pricing',
          baseUrl: 'http://localhost:3050',
          siteWide,
        },
        fetchFn
      );
      expect(calls).toHaveLength(1);

      await checker.checkPage(
        page,
        {
          testCaseId: 'TC-XROBOTS-MEMO2',
          role: 'visitor',
          breakpoint: '1440px',
          urlPath: '/pricing',
          baseUrl: 'http://localhost:3050',
          siteWide,
        },
        fetchFn
      );
      // Not called a second time
      expect(calls).toHaveLength(1);
    });
  });

  describe('title and meta description length checks', () => {
    it('flags title shorter than 10 characters as Suggestion', async () => {
      const page = createMockPage(basePageDetails({ title: 'Short' }));

      const findings = await checker.checkPage(page, {
        testCaseId: 'TC-TITLE-SHORT',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/pricing',
      });

      const lengthFinding = findings.find((f) => f.id.includes('TITLE-LENGTH'));
      expect(lengthFinding).toBeDefined();
      expect(lengthFinding?.severity).toBe('Suggestion');
      expect(lengthFinding?.title).toBe('Page title is too short (5 characters)');
      expect(lengthFinding?.expectedVsActual.expected).toBe('A title of 10 to 60 characters');
    });

    it('flags title longer than 60 characters as Suggestion', async () => {
      const longTitle = 'This title exceeds the recommended limit of sixty characters by quite a bit!';
      const page = createMockPage(basePageDetails({ title: longTitle }));

      const findings = await checker.checkPage(page, {
        testCaseId: 'TC-TITLE-LONG',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/pricing',
      });

      const lengthFinding = findings.find((f) => f.id.includes('TITLE-LENGTH'));
      expect(lengthFinding).toBeDefined();
      expect(lengthFinding?.severity).toBe('Suggestion');
      expect(lengthFinding?.title).toBe(`Page title is too long (${longTitle.length} characters)`);
      expect(lengthFinding?.expectedVsActual.expected).toBe('A title of 10 to 60 characters');
    });

    it('accepts title between 10 and 60 characters without raising TITLE-LENGTH', async () => {
      const validTitle = 'A 30-character page title here';
      const page = createMockPage(basePageDetails({ title: validTitle }));

      const findings = await checker.checkPage(page, {
        testCaseId: 'TC-TITLE-OK',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/pricing',
      });

      expect(findings.some((f) => f.id.includes('TITLE-LENGTH'))).toBe(false);
    });

    it('flags description shorter than 50 characters as Suggestion', async () => {
      const shortDesc = 'Too short description';
      const page = createMockPage(basePageDetails({ metaDescription: shortDesc }));

      const findings = await checker.checkPage(page, {
        testCaseId: 'TC-DESC-SHORT',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/pricing',
      });

      const lengthFinding = findings.find((f) => f.id.includes('DESC-LENGTH'));
      expect(lengthFinding).toBeDefined();
      expect(lengthFinding?.severity).toBe('Suggestion');
      expect(lengthFinding?.title).toBe(`Page description is too short (${shortDesc.length} characters)`);
      expect(lengthFinding?.expectedVsActual.expected).toBe('A meta description of 50 to 160 characters');
    });

    it('flags description longer than 160 characters as Suggestion', async () => {
      const longDesc = 'D'.repeat(200);
      const page = createMockPage(basePageDetails({ metaDescription: longDesc }));

      const findings = await checker.checkPage(page, {
        testCaseId: 'TC-DESC-LONG',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/pricing',
      });

      const lengthFinding = findings.find((f) => f.id.includes('DESC-LENGTH'));
      expect(lengthFinding).toBeDefined();
      expect(lengthFinding?.severity).toBe('Suggestion');
      expect(lengthFinding?.title).toBe('Page description is too long (200 characters)');
      expect(lengthFinding?.expectedVsActual.expected).toBe('A meta description of 50 to 160 characters');
    });

    it('accepts description between 50 and 160 characters without raising DESC-LENGTH', async () => {
      const validDesc = 'This is an ideal meta description of exactly right length between 50 and 160 chars.';
      const page = createMockPage(basePageDetails({ metaDescription: validDesc }));

      const findings = await checker.checkPage(page, {
        testCaseId: 'TC-DESC-OK',
        role: 'visitor',
        breakpoint: '1440px',
        urlPath: '/pricing',
      });

      expect(findings.some((f) => f.id.includes('DESC-LENGTH'))).toBe(false);
    });
  });
});
