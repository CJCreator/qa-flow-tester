import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'path';
import http from 'http';
import { promises as fs } from 'fs';
import { server as fixtureServer } from '../../../fixtures/test-app/server.js';
import { DiscoveryAgent } from '../src/discovery/discovery-agent.js';
import { FlowTestOrchestrator } from '../src/orchestrator.js';
import { PreFlightChecker } from '../src/preflight.js';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';
import { BrowserManager } from '../src/browser.js';
import { RobotsPolicy } from '../src/competitive/robots.js';
import type { TestCase, ProductProfile } from '@qa/types';

describe('T-117 Auth and crawl end-to-end (auth-crawl-e2e.test.ts)', () => {
  let port: number;
  let base: string;
  const tmpDir = path.join(process.cwd(), '.tmp-auth-crawl-e2e');

  beforeAll(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await new Promise<void>((resolve) => {
      fixtureServer.listen(0, () => {
        const addr = fixtureServer.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
          base = `http://localhost:${port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  beforeEach(async () => {
    await fetch(`${base}/lab/reset`, { method: 'POST' });
  });

  it('end-to-end: discovers with session, hands off to orchestrator, single sign-in, headers on all phases, secrets redacted', async () => {
    const sentinelToken = 'secret-sentinel-bypass-val-999';
    const sentinelPassword = 'manager-password';
    const outputDir = path.join(tmpDir, 'e2e-run');
    const authDir = path.join(outputDir, 'auth');
    await fs.mkdir(outputDir, { recursive: true });

    const consoleLogs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      consoleLogs.push(args.join(' '));
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
      consoleLogs.push(args.join(' '));
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      consoleLogs.push(args.join(' '));
    });

    try {
      const profile: ProductProfile = {
        name: 'Manager',
        productId: 'auth-e2e',
        roles: [
          {
            role: 'manager',
            username: 'manager@example.com',
            password: sentinelPassword,
            loginPath: '/signin',
          },
        ],
      };

      // 1. Run DiscoveryAgent.discoverWithSession
      const outcome = await DiscoveryAgent.discoverWithSession({
        targetUrl: `${base}/lab/index`,
        productId: 'auth-e2e',
        outputDir,
        authDir,
        maxPages: 15,
        useAI: false,
        profile,
        customHeaders: {
          'x-qa-bypass-token': sentinelToken,
        },
      });

      expect(outcome.draft).toBeTruthy();
      expect(outcome.preflight).toBeTruthy();
      expect(outcome.preflight?.roleStorageStates?.['manager']).toBeTruthy();

      // Check SPA late links found
      const pagePaths = outcome.draft.pages.map((p) => p.urlPath);
      expect(pagePaths.some((p) => p.startsWith('/lab/spa-late'))).toBe(true);

      // Check 500 and 403 recorded with status in telemetry / skipped
      const skipped = outcome.draft.exploration?.pageCoverage?.skipped || [];
      const err500 = skipped.find((s) => s.urlPath === '/lab/always-500');
      const err403 = skipped.find((s) => s.urlPath === '/lab/forbidden');
      expect(err500).toBeTruthy();
      expect(err500?.status).toBe(500);
      expect(err403).toBeTruthy();
      expect(err403?.status).toBe(403);

      // Check trap bounded
      const traps = skipped.filter((s) => s.urlPath.startsWith('/lab/trap/'));
      expect(traps.length).toBeGreaterThan(0);
      expect(traps.length).toBeLessThan(10);

      // 2. Run FlowTestOrchestrator.run with handed off preflight session
      const testCase: TestCase = {
        id: 'TC-AUTH-1',
        flowId: 'auth-flow',
        name: 'Protected Area Verification',
        role: 'manager',
        startPage: '/account',
        steps: [{ action: 'wait', name: 'Wait on protected page' }],
        expectations: {},
      };

      const orchestrator = new FlowTestOrchestrator();
      const report = await orchestrator.run({
        targetUrl: `${base}/lab/index`,
        productId: 'auth-e2e',
        specTestCases: [testCase],
        outputDir,
        authDir,
        // The default is now three sizes (T-55); this test is about sign-in and headers, so one size.
        breakpoints: ['1440px'],
        profile,
        preflight: outcome.preflight,
        suppliedSessions: outcome.preflight?.roleStorageStates,
        enableSecurity: false,
        enablePerformance: false,
        enableSeo: false,
        enableA11y: false,
        customHeaders: {
          'x-qa-bypass-token': sentinelToken,
        },
      });

      expect(report.results.length).toBeGreaterThan(0);
      expect(report.results[0]?.status).toBe('Passed');

      // Assert single sign-in across both discovery and run phases
      const statsRes = await fetch(`${base}/lab/stats`);
      const stats = await statsRes.json();
      expect(stats.signIns).toBe(1);

      // Assert bypass header hit during signin, discovery, and test phases
      expect(stats.headerHits['/signin']).toBeGreaterThanOrEqual(1);
      expect(stats.headerHits['/account']).toBeGreaterThanOrEqual(1);

      // Assert NO secrets (password, token, cookie) in draft JSON, report JSON or console output
      const draftJson = JSON.stringify(outcome.draft);
      const reportJson = JSON.stringify(report);
      const allLogs = consoleLogs.join('\n');

      expect(draftJson).not.toContain(sentinelPassword);
      expect(draftJson).not.toContain(sentinelToken);
      expect(draftJson).not.toContain('fixture_session=manager');

      expect(reportJson).not.toContain(sentinelPassword);
      expect(reportJson).not.toContain(sentinelToken);
      expect(reportJson).not.toContain('fixture_session=manager');

      expect(allLogs).not.toContain(sentinelPassword);
      expect(allLogs).not.toContain(sentinelToken);
      expect(allLogs).not.toContain('fixture_session=manager');
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errSpy.mockRestore();
    }
  }, 120000);

  // Regression test 1: Login against /lab/spa-login (late-rendered form)
  it('regression: sign-in succeeds against late-rendered /lab/spa-login', async () => {
    const browserManager = new BrowserManager();
    const authDir = path.join(tmpDir, 'spa-login-auth');
    await fs.mkdir(authDir, { recursive: true });

    try {
      const checker = new PreFlightChecker();
      const profile: ProductProfile = {
        name: 'Manager',
        productId: 'spa-login-test',
        roles: [
          {
            role: 'manager',
            username: 'manager@example.com',
            password: 'manager-password',
            loginPath: '/lab/spa-login',
          },
        ],
      };

      const result = await checker.runPreFlight(base, profile, undefined, {
        browserManager,
        authDir,
      });

      expect(result.roleAuthResults['manager']).toBe(true);
      expect(result.roleStorageStates?.['manager']).toBeTruthy();
    } finally {
      await browserManager.close();
    }
  }, 60000);

  // Regression test 2: Zero-link SPA
  it('regression: zero-link SPA does not stall or crash crawl', async () => {
    const browserManager = new BrowserManager();
    const context = await browserManager.createContext({ baseUrl: base });

    try {
      const spider = new DeterministicSpider([], 5);
      const result = await spider.crawl(context, `${base}/lab/hash`, {
        maxPages: 5,
        exploreClicks: false,
      });

      expect(result.pages.length).toBeGreaterThanOrEqual(1);
      expect(result.pages[0]?.urlPath).toBe('/lab/hash');
    } finally {
      await context.close();
      await browserManager.close();
    }
  }, 30000);

  // Regression test 3: Dead-link budget
  it('regression: dead links (500/403/broken) are bounded and recorded under skipped', async () => {
    const browserManager = new BrowserManager();
    const context = await browserManager.createContext({ baseUrl: base });

    try {
      const spider = new DeterministicSpider([], 20);
      const result = await spider.crawl(context, `${base}/lab/index`, {
        maxPages: 20,
        exploreClicks: false,
      });

      const err500 = result.skipped.find((s) => s.urlPath === '/lab/always-500');
      const err403 = result.skipped.find((s) => s.urlPath === '/lab/forbidden');
      expect(err500).toBeTruthy();
      expect(err500?.why).toBe('http-error');
      expect(err500?.status).toBe(500);
      expect(err403).toBeTruthy();
      expect(err403?.why).toBe('http-error');
      expect(err403?.status).toBe(403);
    } finally {
      await context.close();
      await browserManager.close();
    }
  }, 30000);

  // Regression test 4: Session expiry mid-crawl and mid-run
  it('regression: session expiry mid-run reports session-expired and skips with fixed wording', async () => {
    const outputDir = path.join(tmpDir, 'expiry-run');
    const authDir = path.join(outputDir, 'auth');
    await fs.mkdir(outputDir, { recursive: true });

    // Pre-flight gets valid manager session
    const profile: ProductProfile = {
      name: 'Manager',
      productId: 'expiry-test',
      roles: [
        {
          role: 'manager',
          username: 'manager@example.com',
          password: 'manager-password',
          loginPath: '/signin',
        },
      ],
    };

    const browserManager = new BrowserManager();
    let preflight;
    try {
      preflight = await new PreFlightChecker().runPreFlight(base, profile, undefined, {
        browserManager,
        authDir,
      });
      expect(preflight.roleAuthResults['manager']).toBe(true);
    } finally {
      await browserManager.close();
    }

    // Expire the session on server immediately before test execution
    await fetch(`${base}/lab/expire-session`, { method: 'POST' });

    const prevRelogin = process.env.QA_RELOGIN;
    process.env.QA_RELOGIN = '0';

    try {
      const testCase: TestCase = {
        id: 'TC-EXPIRY-1',
        flowId: 'expiring-flow',
        name: 'Access Expiring Page',
        role: 'manager',
        startPage: '/lab/expiring',
        steps: [{ action: 'wait', name: 'Wait on expiring area' }],
        expectations: {},
      };

      const orchestrator = new FlowTestOrchestrator();
      const report = await orchestrator.run({
        targetUrl: base,
        productId: 'expiry-test',
        specTestCases: [testCase],
        outputDir,
        authDir,
        profile,
        preflight,
        suppliedSessions: preflight.roleStorageStates,
        enableSecurity: false,
        enablePerformance: false,
        enableSeo: false,
        enableA11y: false,
      });

      const result = report.results[0];
      expect(result).toBeTruthy();
      expect(result?.status).toBe('Skipped');
      expect(result?.skipReason).toBe('Signed out part-way: the session stopped working');
      expect(report.notes?.some((n) => n.includes('stopped working part-way through testing'))).toBe(true);
    } finally {
      process.env.QA_RELOGIN = prevRelogin;
    }
  }, 60000);

  // LC-001 (T-304): the crawl asks the robots policy about the route's path, so a path the site asked
  // crawlers to leave alone is left alone and reported. The politeness note is written by the Discovery
  // Agent, which only sends a policy on a host that is not private — the fixture is localhost — so the
  // gate is asserted here, where the policy is actually passed to the Spider.
  it('end-to-end: a path robots.txt disallows is left alone and reported (LC-001)', async () => {
    const robotsText = await (await fetch(`${base}/robots.txt`)).text();
    expect(robotsText).toContain('Disallow: /private/');

    const browserManager = new BrowserManager();
    const crawlOnce = async (robots: RobotsPolicy) => {
      const context = await browserManager.createContext({ baseUrl: base });
      try {
        return await new DeterministicSpider([], 40).crawl(context, `${base}/`, {
          concurrency: 2,
          exploreClicks: false,
          seedSitemap: false,
          robots,
        });
      } finally {
        await context.close();
      }
    };

    try {
      const gated = await crawlOnce(RobotsPolicy.parse(robotsText, 'qa-crawler'));
      const recorded = gated.pages.map((p) => p.urlPath);
      expect(recorded).not.toContain('/private/');
      expect(recorded).not.toContain('/private/reports');
      expect(gated.skippedByRobots).toEqual(expect.arrayContaining(['/private/', '/private/reports']));
      expect(gated.skipped?.find((s) => s.urlPath === '/private/')?.why).toBe('robots');

      // The same crawl with no rules reaches them: the gate is what changed, not the fixture.
      const openCrawl = await crawlOnce(RobotsPolicy.allowAll());
      expect(openCrawl.pages.map((p) => p.urlPath)).toEqual(expect.arrayContaining(['/private/', '/private/reports']));
    } finally {
      await browserManager.close();
    }
  }, 180000);

  // LC-002 (T-301): an ordinary page that shows a password field is recorded, keeps the fact, and is never
  // named as a page that asks for a sign-in.
  it('end-to-end: an ordinary page with a password field is recorded, not called a sign-in wall (LC-002)', async () => {
    const outputDir = path.join(tmpDir, 'security-page');
    const outcome = await DiscoveryAgent.discoverWithSession({
      targetUrl: `${base}/account`,
      productId: 'security-page',
      outputDir,
      authDir: path.join(outputDir, 'auth'),
      maxPages: 25,
      profile: {
        name: 'Manager',
        productId: 'security-page',
        roles: [
          { role: 'manager', username: 'manager@example.com', password: 'manager-password', loginPath: '/signin' },
        ],
      },
    });

    const security = outcome.draft.pages.find((p) => p.urlPath === '/account/security');
    expect(security).toBeTruthy();
    expect(security?.formsCount).toBeGreaterThan(0);
    // It keeps the fact that a password field was on it...
    expect(security?.hasSignInForm).toBe(true);
    // ...and is never named as a page that asks for a sign-in.
    expect((outcome.draft.exploration?.notes || []).join('\n')).not.toContain('/account/security');

    // LC-003: every route a crawl attempted has exactly one row, so a recovery cannot leave a hole.
    const routes = outcome.draft.exploration?.pageCoverage?.routes || [];
    expect(routes.length).toBeGreaterThan(0);
    expect(new Set(routes.map((r) => `${r.who ?? ''} ${r.requestedPath}`)).size).toBe(routes.length);
  }, 180000);

  // LC-001 (T-304, T-309): the politeness note is written by the Discovery Agent, and the Agent only passes a
  // robots policy on a host that is not private (discovery-agent.ts:469) — the fixture runs on localhost. The
  // host check is therefore the one thing stubbed here; the robots fetch, the parse, the gate and the note are
  // the code that ships. The contrast with no rules at all is asserted in the same run.
  it('end-to-end: the politeness note names the pages robots.txt asks crawlers to leave alone (LC-001)', async () => {
    vi.resetModules();
    vi.doMock('../src/competitive/safe-crawler.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/competitive/safe-crawler.js')>()),
      isPrivateHost: () => false,
    }));

    try {
      const { DiscoveryAgent: HonouringAgent } = await import('../src/discovery/discovery-agent.js');
      const { RobotsPolicy: FreshRobots } = await import('../src/competitive/robots.js');
      const outputDir = path.join(tmpDir, 'robots-note');

      const crawl = (name: string) =>
        HonouringAgent.discoverWithSession({
          targetUrl: `${base}/`,
          productId: 'robots-note',
          outputDir: path.join(outputDir, name),
          authDir: path.join(outputDir, name, 'auth'),
          maxPages: 12,
          crawlDelayMs: 0,
        });

      const gated = await crawl('gated');
      const gatedPaths = gated.draft.pages.map((p) => p.urlPath);
      expect(gatedPaths).not.toContain('/private/');
      expect(gatedPaths).not.toContain('/private/reports');

      const skipped = gated.draft.exploration?.pageCoverage?.skipped || [];
      expect(skipped.find((s) => s.urlPath === '/private/')?.why).toBe('robots');
      expect(skipped.find((s) => s.urlPath === '/private/reports')?.why).toBe('robots');

      // The note the person reads, including the paths: the rule is visible, not silent.
      const notes = (gated.draft.exploration?.notes || []).join('\n');
      expect(notes).toContain('robots.txt asks crawlers to leave alone');
      expect(notes).toContain('/private/');
      expect(notes).toContain('/private/reports');

      // The rules are the gate, not the fixture: the same crawl with an empty policy reaches those pages,
      // and then there is nothing to be polite about.
      const fetchSpy = vi.spyOn(FreshRobots, 'fetch').mockResolvedValue(FreshRobots.allowAll());
      try {
        const open = await crawl('open');
        expect(open.draft.pages.map((p) => p.urlPath)).toEqual(
          expect.arrayContaining(['/private/', '/private/reports'])
        );
        expect((open.draft.exploration?.notes || []).join('\n')).not.toContain('robots.txt asks crawlers');
      } finally {
        fetchSpy.mockRestore();
      }
    } finally {
      vi.doUnmock('../src/competitive/safe-crawler.js');
      vi.resetModules();
    }
  }, 180000);

  // LC-003 / LC-004 (T-305, T-309): when the Role's session dies part-way the crawl asks for a fresh one and
  // carries on: the route it had reached is retried, gets its single row marked `session-recovered`, and the
  // Role is not reported as lost (no "stopped working" note).
  // The fixture's own `/lab/expire-session` invalidates every session for good, so a fresh sign-in could never
  // restore it; the ticket allows a small server of this test's own instead (T-309 implementation notes).
  it('end-to-end: a Role whose session dies mid-crawl is restored and the crawl continues (LC-003, LC-004)', async () => {
    const account = { email: 'manager@example.com', password: 'manager-password' };
    const behindSignIn = ['/orders', '/invoices', '/reports', '/settings', '/team', '/billing', '/exports'];
    const validTokens = new Set<string>();
    let tokens = 0;

    const signInForm = `<form method="post" action="/signin">
        <label for="signin-email">Email</label><input id="signin-email" name="email" type="email">
        <label for="signin-password">Password</label><input id="signin-password" name="password" type="password">
        <button type="submit" data-testid="signin-btn">Sign in</button>
      </form>`;
    const page = (title: string, extra = '') =>
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${title} of the session recovery test app."></head><body><h1>${title}</h1>${extra}</body></html>`;
    const links = (paths: string[]) => `<nav>${paths.map((h) => `<a href="${h}">${h}</a>`).join(' ')}</nav>`;

    const recoveryServer = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const send = (html: string, status = 200, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
        res.end(html);
      };

      if (url.pathname === '/signin' && req.method === 'POST') {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          const form = new URLSearchParams(raw);
          if (form.get('email') === account.email && form.get('password') === account.password) {
            const fresh = `s${++tokens}`;
            validTokens.add(fresh);
            send('', 302, { 'Set-Cookie': `recovery_session=${fresh}; Path=/; HttpOnly`, Location: '/account' });
            return;
          }
          send(page('Sign in', signInForm));
        });
        return;
      }
      if (url.pathname === '/invalidate' && req.method === 'POST') {
        // Every session handed out so far stops working; a new sign-in works again.
        validTokens.clear();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === '/') return send(page('Recovery app', links(['/account', ...behindSignIn])));
      if (url.pathname === '/signin') return send(page('Sign in', signInForm));

      const token = (req.headers.cookie || '').match(/recovery_session=([\w-]+)/)?.[1];
      if (!token || !validTokens.has(token)) {
        // What the fixture does for its signed-in area: the sign-in page, by redirect.
        return send('', 302, { Location: '/signin' });
      }
      send(page(url.pathname, links(behindSignIn.filter((p) => p !== url.pathname))));
    });

    let recoveryBase = '';
    await new Promise<void>((resolve) =>
      recoveryServer.listen(0, () => {
        const addr = recoveryServer.address();
        if (addr && typeof addr === 'object') recoveryBase = `http://localhost:${addr.port}`;
        resolve();
      })
    );

    const outputDir = path.join(tmpDir, 'session-recovery');
    // Pages the Role had reached when the session died: what it reaches after that is the crawl carrying on.
    const reachedBeforeDeath = new Set<string>();
    let died = false;

    try {
      const outcome = await DiscoveryAgent.discoverWithSession({
        targetUrl: recoveryBase,
        productId: 'session-recovery',
        outputDir,
        authDir: path.join(outputDir, 'auth'),
        maxPages: 20,
        crawlDelayMs: 0,
        profile: {
          name: 'Manager',
          productId: 'session-recovery',
          roles: [{ role: 'manager', username: account.email, password: account.password, loginPath: '/signin' }],
        },
        onProgress: (progress) => {
          if (progress.stage !== 'crawling' || !progress.signedInAs) return;
          if (died) return;
          reachedBeforeDeath.add(progress.urlPath);
          died = true;
          // The Role's session stops working while its crawl is still running.
          void fetch(`${recoveryBase}/invalidate`, { method: 'POST' });
        },
      });

      expect(died).toBe(true);
      const exploration = outcome.draft.exploration;
      const notes = (exploration?.notes || []).join('\n');

      // LC-004: the Role is not reported as lost, so the crawl is not written off and no note says it stopped.
      expect(notes).not.toContain('stopped working');
      expect(exploration?.signInFailures?.manager).toBeUndefined();

      const routes = exploration?.pageCoverage?.routes || [];
      const roleRoutes = routes.filter((r) => r.who === 'manager');
      // LC-003: one row per attempted route, and the recovered one is on record as recovered.
      expect(roleRoutes.length).toBeGreaterThan(0);
      expect(new Set(roleRoutes.map((r) => r.requestedPath)).size).toBe(roleRoutes.length);
      expect(roleRoutes.some((r) => r.detail === 'session-recovered')).toBe(true);

      // LC-003: the crawl kept exploring instead of stopping at the wall.
      const rolePages = outcome.draft.pages.filter((p) => p.reachedBy?.includes('manager')).map((p) => p.urlPath);
      expect(rolePages.some((p) => !reachedBeforeDeath.has(p))).toBe(true);
      expect((exploration?.pageCoverage?.skipped || []).some((s) => s.why === 'session-lost')).toBe(false);
    } finally {
      await new Promise<void>((resolve) => recoveryServer.close(() => resolve()));
    }
  }, 180000);

  // Regression test 5: Custom headers propagation on test run
  it('regression: custom headers propagate to every request during test run', async () => {
    const outputDir = path.join(tmpDir, 'header-run');
    await fs.mkdir(outputDir, { recursive: true });

    const testCase: TestCase = {
      id: 'TC-HEADER-1',
      flowId: 'header-flow',
      name: 'Header verification flow',
      role: 'anonymous',
      startPage: '/lab/headers',
      steps: [{ action: 'wait', name: 'Wait on lab headers page' }],
      expectations: {},
    };

    const orchestrator = new FlowTestOrchestrator();
    await orchestrator.run({
      targetUrl: base,
      productId: 'header-test',
      specTestCases: [testCase],
      outputDir,
      enableSecurity: false,
      enablePerformance: false,
      enableSeo: false,
      enableA11y: false,
      customHeaders: {
        'x-qa-bypass-token': 'token-run-verify-123',
      },
    });

    const statsRes = await fetch(`${base}/lab/stats`);
    const stats = await statsRes.json();
    expect(stats.headerHits['/lab/headers']).toBeGreaterThanOrEqual(1);
  }, 45000);
});
