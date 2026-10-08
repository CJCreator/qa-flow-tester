import { promises as fs } from 'fs';
import path from 'path';
import type { BrowserContext, Locator, Page } from 'playwright';
import type { PreFlightResult, ProductProfile, RoleCredential, SignInFailureReason } from '@qa/types';
import type { BrowserManager } from './browser.js';

const USERNAME_SELECTOR =
  'input[type="email"], input[type="text"], input:not([type]), [data-testid="username-input"], [data-testid="email-input"]';
const PASSWORD_SELECTOR = 'input[type="password"], [data-testid="password-input"]';
const SUBMIT_SELECTOR =
  'button[type="submit"], input[type="submit"], [data-testid="login-btn"], [data-testid="submit-btn"], button:not([type])';
const CAPTCHA_SELECTOR = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha, [data-sitekey]';
const OTP_SELECTOR = 'input[autocomplete="one-time-code"], input[name*="otp" i]';
const ALERT_SELECTOR = '[role="alert"]';
const OPENER_NAME = /^(log ?in|sign ?in)$/i;
const NEXT_NAME = /^(next|continue)$/i;
const SSO_NAME = /(continue|sign in|log in) with (google|microsoft|apple|github|sso)/i;
const SEARCH_FIELD = /search/i;

/** The first match that is on screen, or null. */
async function firstVisible(locator: Locator): Promise<Locator | null> {
  const count = Math.min(await locator.count().catch(() => 0), 10);
  for (let i = 0; i < count; i++) {
    const item = locator.nth(i);
    if (await item.isVisible().catch(() => false)) return item;
  }
  return null;
}

async function anyVisible(locator: Locator): Promise<boolean> {
  return (await firstVisible(locator)) !== null;
}

/** The first visible field inside scope that is not a search box. */
async function findField(scope: Locator, selector: string): Promise<Locator | null> {
  const fields = scope.locator(selector);
  const count = Math.min(await fields.count().catch(() => 0), 10);
  for (let i = 0; i < count; i++) {
    const field = fields.nth(i);
    if (!(await field.isVisible().catch(() => false))) continue;
    const hint = await field
      .evaluate((el) =>
        [el.getAttribute('type'), el.getAttribute('name'), el.getAttribute('aria-label'), el.getAttribute('id')].join(
          ' '
        )
      )
      .catch(() => '');
    if (SEARCH_FIELD.test(hint)) continue;
    return field;
  }
  return null;
}

/** Where to look for the sign-in fields: an open dialog, else the form with a password, else any form, else the page. */
async function pickScope(page: Page): Promise<Locator> {
  const dialog = await firstVisible(
    page.locator('dialog[open], [role="dialog"], [aria-modal="true"]').filter({ has: page.locator('input') })
  );
  if (dialog) return dialog;
  const passwordForm = await firstVisible(page.locator('form:has(input[type="password"])'));
  if (passwordForm) return passwordForm;
  const anyForm = await firstVisible(page.locator('form').filter({ has: page.locator(USERNAME_SELECTOR) }));
  return anyForm ?? page.locator('body');
}

export class PreFlightChecker {
  async checkUrlReachable(
    url: string,
    tunnelAuth?: string,
    /** Shared machine: fetches with the address checks on every hop instead of plain fetch (ADR 0014). */
    get?: (url: string, headers: Record<string, string>) => Promise<{ status: number; headers: Record<string, string> }>
  ): Promise<{ ok: boolean; status?: number; error?: string; testCopyHeader?: boolean }> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'QA-Readiness-Checker/0.1.0',
        'X-Tunnel-Skip-AntiPhishing-Page': 'true',
      };
      if (tunnelAuth) {
        headers['X-Tunnel-Authorization'] = tunnelAuth;
      }

      let res: { status: number; headers: { get(name: string): string | null } };
      if (get) {
        const got = await get(url, headers);
        res = { status: got.status, headers: { get: (name) => got.headers[name.toLowerCase()] ?? null } };
      } else {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        res = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      }

      const isTestCopyHeader =
        res.headers.get('x-test-copy') === 'true' ||
        res.headers.get('x-staging') === 'true' ||
        ['staging', 'test', 'development', 'dev'].includes((res.headers.get('x-environment') || '').toLowerCase());

      return {
        ok: res.status < 500,
        status: res.status,
        testCopyHeader: isTestCopyHeader,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async verifyRoleLogin(
    context: BrowserContext,
    baseUrl: string,
    credential: RoleCredential,
    saveStorageStatePath?: string
  ): Promise<boolean> {
    return (await this.signIn(context, baseUrl, credential, saveStorageStatePath)).ok;
  }

  /**
   * Signs in on the role's sign-in page, in a fixed order with no AI: find the sign-in fields (inside a
   * dialog if one is open, after clicking a "Sign in" opener if none shows), fill the username, press Next
   * when the password comes on a second step, fill the password and submit. Succeeds only when the password
   * field is gone afterwards. A failure carries one reason; it is never built from the page, the typed
   * details or an error message, so no credential can reach a log, response or report through it.
   * Known blur: a slow site and wrong details can look alike; failed or 5xx page loads count as unreachable.
   */
  async signIn(
    context: BrowserContext,
    baseUrl: string,
    credential: RoleCredential,
    saveStorageStatePath?: string,
    options?: { gotoTimeoutMs?: number }
  ): Promise<{ ok: boolean; landingPath?: string; reason?: SignInFailureReason }> {
    let page: Page | undefined;
    try {
      page = await context.newPage();
      const live = page;
      const loginUrl = new URL(credential.loginPath || '/login', baseUrl).toString();

      let navigationFailed = false;
      live.on('requestfailed', (req) => {
        if (req.isNavigationRequest() && req.frame() === live.mainFrame()) navigationFailed = true;
      });
      live.on('response', (res) => {
        const req = res.request();
        if (req.isNavigationRequest() && req.frame() === live.mainFrame() && res.status() >= 500) {
          navigationFailed = true;
        }
      });

      const opened = await live.goto(loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: options?.gotoTimeoutMs ?? 12000,
      });
      if (opened && opened.status() >= 500) return { ok: false, reason: 'unreachable' };
      const origin = new URL(live.url()).origin;

      const needsMore = async (): Promise<boolean> =>
        (await anyVisible(live.locator(CAPTCHA_SELECTOR))) || (await anyVisible(live.locator(OTP_SELECTOR)));
      const anyField = `${USERNAME_SELECTOR}, ${PASSWORD_SELECTOR}`;

      let scope = await pickScope(live);
      let hasField = (await findField(scope, anyField)) !== null;

      if (!hasField) {
        // Some sites keep the form behind a "Sign in" button.
        const opener = await firstVisible(
          live.getByRole('button', { name: OPENER_NAME }).or(live.getByRole('link', { name: OPENER_NAME }))
        );
        if (opener) {
          await opener.click().catch(() => {});
          await live
            .locator(anyField)
            .first()
            .waitFor({ state: 'visible', timeout: 3000 })
            .catch(() => {});
          scope = await pickScope(live);
          hasField = (await findField(scope, anyField)) !== null;
        }
      }
      if (!hasField) {
        if (await needsMore()) return { ok: false, reason: 'needs-more' };
        const sso =
          (await anyVisible(live.getByRole('button', { name: SSO_NAME }))) ||
          (await anyVisible(live.getByRole('link', { name: SSO_NAME })));
        return { ok: false, reason: sso ? 'needs-more' : 'no-form' };
      }
      if (await needsMore()) return { ok: false, reason: 'needs-more' };

      const username = await findField(scope, USERNAME_SELECTOR);
      if (username && credential.username) await username.fill(credential.username);

      let password = await findField(scope, PASSWORD_SELECTOR);
      if (!password) {
        // Two-step sign-in: the password comes after the username.
        const next =
          (await firstVisible(scope.getByRole('button', { name: NEXT_NAME }))) ??
          (await firstVisible(scope.locator(SUBMIT_SELECTOR)));
        if (!next) return { ok: false, reason: 'no-form' };
        await next.click().catch(() => {});
        await scope
          .locator(PASSWORD_SELECTOR)
          .first()
          .waitFor({ state: 'visible', timeout: 6000 })
          .catch(() => {});
        password = await findField(scope, PASSWORD_SELECTOR);
        if (!password) {
          if (await needsMore()) return { ok: false, reason: 'needs-more' };
          if (navigationFailed) return { ok: false, reason: 'unreachable' };
          const alerted = await anyVisible(live.locator(ALERT_SELECTOR));
          return { ok: false, reason: alerted ? 'wrong-details' : 'no-form' };
        }
      }
      if (credential.password) await password.fill(credential.password);

      const submit = await firstVisible(scope.locator(SUBMIT_SELECTOR));
      if (!submit) return { ok: false, reason: 'no-form' };
      const urlBefore = live.url();
      const settled = Promise.race([
        live.waitForURL((url) => url.toString() !== urlBefore, { timeout: 8000 }),
        password.waitFor({ state: 'hidden', timeout: 8000 }),
      ]).catch(() => {});
      await submit.click().catch(() => {});
      await settled;
      await live.waitForLoadState('domcontentloaded').catch(() => {});
      await live.waitForTimeout(400);

      if (navigationFailed) return { ok: false, reason: 'unreachable' };
      const landed = new URL(live.url());
      if (landed.origin !== origin) return { ok: false, reason: 'needs-more' };

      const stillOnSignInForm = await live
        .locator(PASSWORD_SELECTOR)
        .first()
        .isVisible()
        .catch(() => false);
      if (stillOnSignInForm) {
        return { ok: false, reason: (await needsMore()) ? 'needs-more' : 'wrong-details' };
      }

      if (saveStorageStatePath) await context.storageState({ path: saveStorageStatePath });
      return { ok: true, landingPath: landed.pathname + landed.search };
    } catch (err: unknown) {
      // Only the kind of error is looked at; its text is never returned or logged.
      const kind = err instanceof Error ? `${err.name} ${err.message}` : '';
      return { ok: false, reason: /TimeoutError|net::ERR_/.test(kind) ? 'unreachable' : 'no-form' };
    } finally {
      await page?.close().catch(() => {});
    }
  }

  async runPreFlight(
    targetUrl: string,
    profile?: ProductProfile,
    tunnelAuth?: string,
    options?: {
      browserManager?: BrowserManager;
      authDir?: string;
    }
  ): Promise<PreFlightResult> {
    const urlCheck = await this.checkUrlReachable(targetUrl, tunnelAuth);
    if (!urlCheck.ok) {
      return {
        ok: false,
        url: targetUrl,
        statusCode: urlCheck.status,
        loginReachable: false,
        roleAuthResults: {},
        error: `Target URL is unreachable (${urlCheck.error || `HTTP ${urlCheck.status}`}). Verify the server or tunnel is running.`,
      };
    }

    const roleResults: Record<string, boolean> = {};
    const roleStorageStates: Record<string, string> = {};
    const roleLandingPaths: Record<string, string> = {};

    if (profile?.roles && profile.roles.length > 0) {
      if (options?.authDir) {
        await fs.mkdir(options.authDir, { recursive: true });
      }

      for (const role of profile.roles) {
        if (options?.browserManager && options?.authDir) {
          const statePath = path.join(options.authDir, `${role.role}.json`);
          try {
            const context = await options.browserManager.createContext({
              baseUrl: targetUrl,
              tunnelAuth,
            });
            const signedIn = await this.signIn(context, targetUrl, role, statePath);
            roleResults[role.role] = signedIn.ok;
            if (signedIn.ok) {
              roleStorageStates[role.role] = statePath;
              if (signedIn.landingPath) roleLandingPaths[role.role] = signedIn.landingPath;
            }
            await context.close();
          } catch {
            roleResults[role.role] = false;
          }
        } else {
          roleResults[role.role] = true;
        }
      }
    }

    return {
      ok: true,
      url: targetUrl,
      statusCode: urlCheck.status,
      loginReachable: true,
      roleAuthResults: roleResults,
      roleStorageStates,
      roleLandingPaths,
    };
  }
}
