import { promises as fs } from 'fs';
import path from 'path';
import type { BrowserContext, Locator, Page } from 'playwright';
import type {
  PreFlightResult as BasePreFlightResult,
  ProductProfile,
  RoleCredential,
  SignInFailureReason,
  StorageStateData,
} from '@qa/types';
import { signInReasonText } from '@qa/types';
import type { SignInStep } from '@qa/types/src/signin.js';
import type { BrowserManager } from './browser.js';
import { debugLog } from './debug-log.js';
import { navigate } from './navigate.js';
import { GuardedFetchBlockedError, makeGuardedFetch } from './safe-net.js';
import { isSameSite } from './same-site.js';

/** The plain URL check's fetch: the browser guard's address rule on every hop (ADR 0031). */
const guardedFetch = makeGuardedFetch();

/** A required sign-in failed. The message is the fixed wording for the reason: never any typed detail. */
export class SignInFailedError extends Error {
  readonly code = 'ERR_SIGN_IN_FAILED';
  constructor(
    readonly reason: SignInFailureReason,
    readonly role: string
  ) {
    super(signInReasonText(reason));
    this.name = 'SignInFailedError';
  }
}

export type SignInResult =
  | { ok: true; landingPath: string; attempts?: number }
  | { ok: false; reason: SignInFailureReason; failedStep?: SignInStep; attempts?: number };

export interface PreFlightResult extends BasePreFlightResult {
  roleDiagnostics: Record<string, { ok: boolean; failedStep?: SignInStep; attempts: number; landedPath?: string }>;
}

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

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function originsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const uA = new URL(a);
    const uB = new URL(b);
    if (uA.protocol !== uB.protocol || uA.port !== uB.port) return false;
    const hA = uA.hostname.replace(/^www\./, '');
    const hB = uB.hostname.replace(/^www\./, '');
    return hA === hB;
  } catch {
    return false;
  }
}

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
    get?: (
      url: string,
      headers: Record<string, string>
    ) => Promise<{ status: number; headers: Record<string, string> }>,
    customHeaders?: Record<string, string>,
    headerHosts?: string[]
  ): Promise<{ ok: boolean; status?: number; error?: string; testCopyHeader?: boolean; startWarning?: 'start-4xx' }> {
    const headers: Record<string, string> = {
      'User-Agent': 'QA-Readiness-Checker/0.1.0',
      'X-Tunnel-Skip-AntiPhishing-Page': 'true',
    };
    if (tunnelAuth) {
      headers['X-Tunnel-Authorization'] = tunnelAuth;
    }

    try {
      const parsed = new URL(url);
      const targetHost = parsed.host;
      const targetHostname = parsed.hostname;
      const allowedHosts = headerHosts?.length ? headerHosts : [targetHost, targetHostname];
      const isAllowed = allowedHosts.some((h) => {
        const lowerH = h.toLowerCase();
        return lowerH === targetHost.toLowerCase() || lowerH === targetHostname.toLowerCase();
      });
      if (customHeaders && isAllowed) {
        Object.assign(headers, customHeaders);
      }
    } catch {
      // invalid URL format handled by fetch
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const timeoutMs = attempt === 1 ? 25000 : 10000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        let res: { status: number; headers: { get(name: string): string | null } };
        if (get) {
          const got = await get(url, headers);
          res = { status: got.status, headers: { get: (name) => got.headers[name.toLowerCase()] ?? null } };
        } else {
          res = await guardedFetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
        }

        const isTestCopyHeader =
          res.headers.get('x-test-copy') === 'true' ||
          res.headers.get('x-staging') === 'true' ||
          ['staging', 'test', 'development', 'dev'].includes((res.headers.get('x-environment') || '').toLowerCase());

        const isOk = res.status < 400 || res.status === 401 || res.status === 403;
        const startWarning = !isOk && res.status >= 400 && res.status < 500 ? 'start-4xx' : undefined;

        return {
          ok: isOk,
          status: res.status,
          testCopyHeader: isTestCopyHeader,
          ...(startWarning ? { startWarning } : {}),
        };
      } catch (err: unknown) {
        if (err instanceof GuardedFetchBlockedError) return { ok: false, error: err.message };
        lastErr = err;
        if (attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    return {
      ok: false,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    };
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
   * when the password comes on a second step, fill the password and submit. Succeeds only when all success
   * conditions are met (origin matches, not on login path, no visible password, storageState not empty).
   * A failure carries one reason and failedStep; it is never built from page text, typed details or error messages.
   */
  async signIn(
    context: BrowserContext,
    baseUrl: string,
    credential: RoleCredential,
    saveStorageStatePath?: string,
    options?: { gotoTimeoutMs?: number }
  ): Promise<SignInResult> {
    const targetOrigin = new URL(baseUrl).origin;
    let resolvedLoginUrl: URL;
    try {
      resolvedLoginUrl = new URL(credential.loginPath || '/login', baseUrl);
    } catch {
      debugLog('auth', 'failed to parse loginUrl', { role: credential.role, step: 'goto' });
      return { ok: false, reason: 'unreachable', failedStep: 'goto', attempts: 1 };
    }

    // Origin guard: block cross-origin loginPath before any network request
    if (!originsMatch(resolvedLoginUrl.origin, targetOrigin)) {
      debugLog('auth', 'cross-origin loginPath blocked before request', {
        role: credential.role,
        step: 'goto',
      });
      return { ok: false, reason: 'needs-more', failedStep: 'goto', attempts: 1 };
    }

    // Apply per-role headers and localStorage initialization if specified
    const roleHeaders = {
      ...credential.headers,
      ...(credential.token ? { Authorization: `Bearer ${credential.token}` } : {}),
    };
    if (Object.keys(roleHeaders).length > 0) {
      // Only the checked site gets the Role's headers: never a CDN, analytics or font host.
      const siteHost = new URL(baseUrl).host.toLowerCase();
      await context
        .route('**/*', async (route) => {
          let onSite = false;
          try {
            const host = new URL(route.request().url()).host.toLowerCase();
            onSite = host === siteHost || isSameSite(host, siteHost);
          } catch {
            onSite = false;
          }
          if (!onSite) return route.fallback();
          return route.fallback({ headers: { ...route.request().headers(), ...roleHeaders } });
        })
        .catch(() => {});
    }
    if (credential.localStorageEntries && Object.keys(credential.localStorageEntries).length > 0) {
      await context
        .addInitScript((entries) => {
          for (const [k, v] of Object.entries(entries)) {
            try {
              localStorage.setItem(k, v);
            } catch {}
          }
        }, credential.localStorageEntries)
        .catch(() => {});
    }

    // Direct token/header/localStorage session verification (when no password given)
    if (
      !credential.password &&
      (credential.token || Object.keys(roleHeaders).length > 0 || credential.localStorageEntries)
    ) {
      let page: Page | undefined;
      try {
        page = await context.newPage();
        const testPath = credential.postLoginUrl || credential.loginPath || '/';
        const verifyUrl = new URL(testPath, baseUrl).toString();
        const navRes = await navigate(page, verifyUrl, { timeoutMs: options?.gotoTimeoutMs ?? 12000, retries: 0 });
        if (navRes.ok && (!navRes.status || navRes.status < 400)) {
          const hasLogin = await anyVisible(page.locator(PASSWORD_SELECTOR));
          if (!hasLogin) {
            if (saveStorageStatePath) {
              await context.storageState({ path: saveStorageStatePath });
              await fs.chmod(saveStorageStatePath, 0o600).catch(() => {});
            }
            const landed = new URL(page.url());
            const landingPath = landed.pathname + landed.search;
            await page.close().catch(() => {});
            return { ok: true, landingPath, attempts: 1 };
          }
        }
      } catch (err) {
        debugLog('auth', 'direct header/token session verification failed', {
          role: credential.role,
          error: String(err),
        });
      } finally {
        if (page) await page.close().catch(() => {});
      }
    }

    let lastFailure: { reason: SignInFailureReason; failedStep: SignInStep } = {
      reason: 'unreachable',
      failedStep: 'goto',
    };

    let page: Page | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let currentStep: SignInStep = 'goto';
      try {
        page = await context.newPage();
        const live = page;
        debugLog('auth', 'signIn attempt', { role: credential.role, attempt });

        // Step 1: goto
        currentStep = 'goto';
        let navRes;
        try {
          navRes = await navigate(live, resolvedLoginUrl.toString(), {
            timeoutMs: options?.gotoTimeoutMs ?? 12000,
            retries: 0,
          });
        } catch {
          lastFailure = { reason: 'unreachable', failedStep: 'goto' };
          debugLog('auth', 'navigation error, will retry if attempt 1', {
            role: credential.role,
            attempt,
            step: 'goto',
          });
          await page.close().catch(() => {});
          page = undefined;
          continue;
        }

        if (!navRes.ok || (navRes.status && navRes.status >= 500)) {
          lastFailure = { reason: 'unreachable', failedStep: 'goto' };
          debugLog('auth', 'navigation failed or returned 5xx status', {
            role: credential.role,
            attempt,
            status: navRes.status,
          });
          await page.close().catch(() => {});
          page = undefined;
          continue;
        }

        // Origin guard: check origin after navigation (redirects)
        const currentOrigin = new URL(live.url()).origin;
        if (!originsMatch(currentOrigin, targetOrigin)) {
          debugLog('auth', 'landed on cross-origin page, aborting before fill', {
            role: credential.role,
            step: 'goto',
          });
          await page.close().catch(() => {});
          return { ok: false, reason: 'needs-more', failedStep: 'goto', attempts: attempt };
        }

        // Step 2: find-fields
        currentStep = 'find-fields';
        const anyField = `${USERNAME_SELECTOR}, ${PASSWORD_SELECTOR}`;

        // Wait for form readiness (cap 6s for SPAs / hydration)
        if (credential.usernameSelector) {
          await live
            .locator(credential.usernameSelector)
            .first()
            .waitFor({ state: 'visible', timeout: 6000 })
            .catch(() => {});
        } else {
          await live
            .locator(anyField)
            .first()
            .waitFor({ state: 'visible', timeout: 6000 })
            .catch(() => {});
        }

        const needsMore = async (): Promise<boolean> =>
          (await anyVisible(live.locator(CAPTCHA_SELECTOR))) || (await anyVisible(live.locator(OTP_SELECTOR)));

        let scope = await pickScope(live);
        let hasField = (await findField(scope, anyField)) !== null;

        if (!hasField && !credential.usernameSelector) {
          // Some sites keep the form behind a "Sign in" button.
          const opener = await firstVisible(
            live.getByRole('button', { name: OPENER_NAME }).or(live.getByRole('link', { name: OPENER_NAME }))
          );
          if (opener) {
            currentStep = 'opener';
            await opener.click().catch(() => {});
            await live
              .locator(anyField)
              .first()
              .waitFor({ state: 'visible', timeout: 3000 })
              .catch(() => {});
            scope = await pickScope(live);
            hasField = (await findField(scope, anyField)) !== null;
            currentStep = 'find-fields';
          }
        }

        if (!hasField && !credential.usernameSelector) {
          if (await needsMore()) {
            await page.close().catch(() => {});
            return { ok: false, reason: 'needs-more', failedStep: 'find-fields', attempts: attempt };
          }
          const sso =
            (await anyVisible(live.getByRole('button', { name: SSO_NAME }))) ||
            (await anyVisible(live.getByRole('link', { name: SSO_NAME })));
          await page.close().catch(() => {});
          return { ok: false, reason: sso ? 'needs-more' : 'no-form', failedStep: 'find-fields', attempts: attempt };
        }
        if (await needsMore()) {
          await page.close().catch(() => {});
          return { ok: false, reason: 'needs-more', failedStep: 'find-fields', attempts: attempt };
        }

        // Step 3: username
        currentStep = 'username';
        const username = credential.usernameSelector
          ? await firstVisible(live.locator(credential.usernameSelector))
          : await findField(scope, USERNAME_SELECTOR);
        if (username && credential.username) {
          await username.fill(credential.username);
        }

        // Step 4: password
        currentStep = 'password';
        let password = credential.passwordSelector
          ? await firstVisible(live.locator(credential.passwordSelector))
          : await findField(scope, PASSWORD_SELECTOR);
        if (!password) {
          // Two-step sign-in: password comes after username
          const next =
            (await firstVisible(scope.getByRole('button', { name: NEXT_NAME }))) ??
            (await firstVisible(scope.locator(SUBMIT_SELECTOR)));
          if (!next) {
            await page.close().catch(() => {});
            return { ok: false, reason: 'no-form', failedStep: 'next', attempts: attempt };
          }
          currentStep = 'next';
          await next.click().catch(() => {});
          await scope
            .locator(PASSWORD_SELECTOR)
            .first()
            .waitFor({ state: 'visible', timeout: 6000 })
            .catch(() => {});
          currentStep = 'password';
          password = credential.passwordSelector
            ? await firstVisible(live.locator(credential.passwordSelector))
            : await findField(scope, PASSWORD_SELECTOR);
          if (!password) {
            if (await needsMore()) {
              await page.close().catch(() => {});
              return { ok: false, reason: 'needs-more', failedStep: 'password', attempts: attempt };
            }
            const alerted = await anyVisible(live.locator(ALERT_SELECTOR));
            await page.close().catch(() => {});
            return {
              ok: false,
              reason: alerted ? 'wrong-details' : 'no-form',
              failedStep: 'password',
              attempts: attempt,
            };
          }
        }
        if (credential.password) {
          await password.fill(credential.password);
        }

        // Step 5: submit
        currentStep = 'submit';
        const submit = credential.submitSelector
          ? await firstVisible(live.locator(credential.submitSelector))
          : await firstVisible(scope.locator(SUBMIT_SELECTOR));
        if (!submit) {
          await page.close().catch(() => {});
          return { ok: false, reason: 'no-form', failedStep: 'submit', attempts: attempt };
        }

        const urlBefore = live.url();
        const settled = Promise.race([
          live.waitForURL((url) => url.toString() !== urlBefore, { timeout: 10000 }),
          password.waitFor({ state: 'hidden', timeout: 10000 }),
          live.waitForFunction(() => document.cookie.length > 0 || localStorage.length > 0, undefined, {
            timeout: 10000,
          }),
        ]).catch(() => {});

        await submit.click().catch(() => {});
        await settled;
        await live.waitForLoadState('domcontentloaded').catch(() => {});

        // Step 6: post-submit-check
        currentStep = 'post-submit-check';

        // Check for visible alert first -> wrong-details immediately (no retry)
        const hasAlert = await anyVisible(live.locator(ALERT_SELECTOR));
        if (hasAlert) {
          debugLog('auth', 'visible alert detected after submit', {
            role: credential.role,
            step: 'post-submit-check',
          });
          await page.close().catch(() => {});
          return { ok: false, reason: 'wrong-details', failedStep: 'post-submit-check', attempts: attempt };
        }

        const landed = new URL(live.url());
        if (!originsMatch(landed.origin, targetOrigin)) {
          debugLog('auth', 'redirected to foreign origin after submit', {
            role: credential.role,
            step: 'post-submit-check',
          });
          await page.close().catch(() => {});
          return { ok: false, reason: 'needs-more', failedStep: 'post-submit-check', attempts: attempt };
        }

        const stillOnSignInForm = await live
          .locator(PASSWORD_SELECTOR)
          .first()
          .isVisible()
          .catch(() => false);
        if (stillOnSignInForm) {
          const more = await needsMore();
          debugLog('auth', 'password field still visible after submit', {
            role: credential.role,
            step: 'post-submit-check',
          });
          await page.close().catch(() => {});
          return {
            ok: false,
            reason: more ? 'needs-more' : 'wrong-details',
            failedStep: 'post-submit-check',
            attempts: attempt,
          };
        }

        // Verify storageState has cookies or localStorage entries
        const state = await context.storageState();
        const hasSession =
          (state.cookies?.length ?? 0) > 0 || (state.origins?.some((o) => (o.localStorage?.length ?? 0) > 0) ?? false);

        const isSamePathAsLogin = landed.pathname === resolvedLoginUrl.pathname;

        let postLoginOk = true;
        if (credential.postLoginSelector) {
          const visible = await live
            .locator(credential.postLoginSelector)
            .first()
            .isVisible()
            .catch(() => false);
          if (!visible) postLoginOk = false;
        }
        if (credential.postLoginUrl) {
          if (!landed.pathname.startsWith(credential.postLoginUrl)) postLoginOk = false;
        }

        if (!hasSession || (isSamePathAsLogin && !credential.postLoginUrl) || !postLoginOk) {
          debugLog('auth', 'session criteria not met after submit', {
            role: credential.role,
            hasSession,
            isSamePathAsLogin,
            postLoginOk,
          });
          await page.close().catch(() => {});
          return { ok: false, reason: 'wrong-details', failedStep: 'post-submit-check', attempts: attempt };
        }

        // Step 7: save storage state if requested
        if (saveStorageStatePath) {
          await context.storageState({ path: saveStorageStatePath });
          await fs.chmod(saveStorageStatePath, 0o600).catch(() => {});
        }

        const landingPath = landed.pathname + landed.search;
        debugLog('auth', 'sign-in success', {
          role: credential.role,
          landingPath,
          attempts: attempt,
        });
        await page.close().catch(() => {});
        return { ok: true, landingPath, attempts: attempt };
      } catch (err: unknown) {
        const kind = err instanceof Error ? `${err.name} ${err.message}` : '';
        debugLog('auth', 'sign-in unexpected error caught', {
          role: credential.role,
          attempt,
          step: currentStep,
        });
        await page?.close().catch(() => {});
        page = undefined;

        if (/TimeoutError|net::ERR_/.test(kind)) {
          lastFailure = { reason: 'unreachable', failedStep: currentStep };
          continue;
        }

        return { ok: false, reason: 'unreachable', failedStep: currentStep, attempts: attempt };
      }
    }

    return { ok: false, reason: lastFailure.reason, failedStep: lastFailure.failedStep, attempts: 2 };
  }

  async runPreFlight(
    targetUrl: string,
    profile?: ProductProfile,
    tunnelAuth?: string,
    options?: {
      browserManager?: BrowserManager;
      authDir?: string;
      /** Sessions the person saved, by role. Held in memory only: never written to disk or logged. */
      suppliedSessions?: Record<string, StorageStateData>;
      customHeaders?: Record<string, string>;
      userAgent?: string;
      headerHosts?: string[];
    }
  ): Promise<PreFlightResult> {
    const urlCheck = await this.checkUrlReachable(
      targetUrl,
      tunnelAuth,
      undefined,
      options?.customHeaders,
      options?.headerHosts
    );
    if (!urlCheck.ok) {
      return {
        ok: false,
        url: targetUrl,
        statusCode: urlCheck.status,
        loginReachable: false,
        roleAuthResults: {},
        error: `Target URL is unreachable (${urlCheck.error || `HTTP ${urlCheck.status}`}). Verify the server or tunnel is running.`,
        roleDiagnostics: {},
        startWarning: urlCheck.startWarning,
      };
    }

    const roleResults: Record<string, boolean> = {};
    const roleStorageStates: Record<string, string | StorageStateData> = {};
    const roleLandingPaths: Record<string, string> = {};
    const roleFailures: Record<string, SignInFailureReason> = {};
    const roleDiagnostics: Record<
      string,
      { ok: boolean; failedStep?: SignInStep; attempts: number; landedPath?: string }
    > = {};
    // Set when a Role was left unverified because there was no browser to sign in with.
    let unverified = false;

    if (profile?.roles && profile.roles.length > 0) {
      if (options?.authDir) {
        await fs.mkdir(options.authDir, { recursive: true, mode: 0o700 });
      }

      for (const role of profile.roles) {
        if (options?.browserManager && options?.authDir) {
          const slug = role.role.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
          const statePath = path.join(options.authDir, `${slug}.json`);
          if (!isInside(statePath, options.authDir)) {
            throw new Error(`State path is outside authDir: ${statePath}`);
          }

          const supplied = options.suppliedSessions?.[role.role];
          if (supplied) {
            try {
              const checked = await this.checkSuppliedSession(
                options.browserManager,
                targetUrl,
                tunnelAuth,
                supplied,
                options
              );
              roleResults[role.role] = checked.ok;
              if (checked.ok) {
                roleStorageStates[role.role] = supplied;
                if (checked.landingPath) roleLandingPaths[role.role] = checked.landingPath;
                roleDiagnostics[role.role] = { ok: true, attempts: 1, landedPath: checked.landingPath };
              } else {
                roleFailures[role.role] = checked.reason;
                roleDiagnostics[role.role] = { ok: false, failedStep: 'goto', attempts: 1 };
              }
            } catch {
              roleResults[role.role] = false;
              roleFailures[role.role] = 'unreachable';
              roleDiagnostics[role.role] = { ok: false, failedStep: 'goto', attempts: 1 };
            }
            continue;
          }

          let context: BrowserContext | undefined;
          try {
            const roleHeaders = {
              ...options.customHeaders,
              ...role.headers,
              ...(role.token ? { Authorization: `Bearer ${role.token}` } : {}),
            };
            context = await options.browserManager.createContext({
              baseUrl: targetUrl,
              tunnelAuth,
              customHeaders: roleHeaders,
              userAgent: options.userAgent,
              headerHosts: options.headerHosts,
            });
            const signedIn = await this.signIn(context, targetUrl, role, statePath);
            roleResults[role.role] = signedIn.ok;
            roleDiagnostics[role.role] = {
              ok: signedIn.ok,
              failedStep: signedIn.ok ? undefined : signedIn.failedStep,
              attempts: signedIn.attempts ?? 1,
              landedPath: signedIn.ok ? signedIn.landingPath : undefined,
            };

            if (signedIn.ok) {
              roleStorageStates[role.role] = statePath;
              if (signedIn.landingPath) roleLandingPaths[role.role] = signedIn.landingPath;
            } else {
              roleFailures[role.role] = signedIn.reason ?? 'no-form';
            }
          } catch {
            roleResults[role.role] = false;
            roleFailures[role.role] = 'unreachable';
            roleDiagnostics[role.role] = { ok: false, failedStep: 'goto', attempts: 1 };
          } finally {
            await context?.close().catch(() => {});
          }
        } else {
          // No browser to sign in with: nothing was verified, so nothing may be reported as signed in.
          // The reachability check above still ran; only the Role results fail closed (LC-005).
          roleResults[role.role] = false;
          roleFailures[role.role] = 'unreachable';
          roleDiagnostics[role.role] = { ok: false, failedStep: 'goto', attempts: 0 };
          unverified = true;
        }
      }
    }

    // The sign-in page, asked once per distinct path (not once per Role): a Role is signed in only after a
    // sign-in ran, so this says whether the page a person signs in on answered at all (LC-006). Every distinct
    // path is asked, so a Role whose own page does not answer can be told apart from one whose page answered.
    const loginPathReachable = new Map<string, boolean>();
    let loginReachable: boolean = urlCheck.ok;
    for (const loginPath of [...new Set((profile?.roles ?? []).map((role) => role.loginPath || '/login'))]) {
      try {
        const loginUrl = new URL(loginPath, targetUrl).toString();
        const check = await this.checkUrlReachable(
          loginUrl,
          tunnelAuth,
          undefined,
          options?.customHeaders,
          options?.headerHosts
        );
        loginPathReachable.set(loginPath, check.ok);
      } catch {
        loginPathReachable.set(loginPath, false);
      }
      loginReachable = loginReachable && loginPathReachable.get(loginPath) === true;
    }

    // A browser was available but the Role's own sign-in page never answered, so it cannot have signed in:
    // report `unreachable` rather than a reason that suggests the page was read (LC-006).
    for (const role of profile?.roles ?? []) {
      if (roleResults[role.role] === true) continue;
      if (loginPathReachable.get(role.loginPath || '/login') !== false) continue;
      roleResults[role.role] = false;
      roleFailures[role.role] = 'unreachable';
      const previous = roleDiagnostics[role.role];
      roleDiagnostics[role.role] = {
        ok: false,
        failedStep: 'goto',
        attempts: previous?.attempts ?? 0,
      };
    }

    return {
      ok: !unverified,
      url: targetUrl,
      statusCode: urlCheck.status,
      loginReachable,
      roleAuthResults: roleResults,
      roleStorageStates,
      ...(Object.keys(roleFailures).length > 0 ? { roleFailures } : {}),
      roleLandingPaths,
      roleDiagnostics,
      ...(urlCheck.startWarning ? { startWarning: urlCheck.startWarning } : {}),
      ...(unverified ? { error: 'No browser was available to sign in, so no Role could be verified.' } : {}),
    };
  }

  /**
   * Opens the site with a saved session and looks at where it lands. A password field on screen means the
   * site did not accept it (`session-expired`). The session object is only handed to the browser; nothing
   * about it is logged or written.
   */
  private async checkSuppliedSession(
    browserManager: BrowserManager,
    targetUrl: string,
    tunnelAuth: string | undefined,
    session: StorageStateData,
    options?: {
      customHeaders?: Record<string, string>;
      userAgent?: string;
      headerHosts?: string[];
    }
  ): Promise<{ ok: true; landingPath: string } | { ok: false; reason: SignInFailureReason }> {
    let context: BrowserContext | undefined;
    try {
      context = await browserManager.createContext({
        baseUrl: targetUrl,
        tunnelAuth,
        storageState: session,
        customHeaders: options?.customHeaders,
        userAgent: options?.userAgent,
        headerHosts: options?.headerHosts,
      });
      const page = await context.newPage();
      const navRes = await navigate(page, targetUrl, { timeoutMs: 12000 });
      if (!navRes.ok || (navRes.status && navRes.status >= 500)) return { ok: false, reason: 'unreachable' };

      const targetOrigin = new URL(targetUrl).origin;
      if (!originsMatch(new URL(page.url()).origin, targetOrigin)) {
        return { ok: false, reason: 'session-expired' };
      }
      if (await anyVisible(page.locator(PASSWORD_SELECTOR))) {
        return { ok: false, reason: 'session-expired' };
      }
      const landed = new URL(page.url());
      return { ok: true, landingPath: landed.pathname + landed.search };
    } catch (err: unknown) {
      const kind = err instanceof Error ? `${err.name} ${err.message}` : '';
      return { ok: false, reason: /TimeoutError|net::ERR_/.test(kind) ? 'unreachable' : 'session-expired' };
    } finally {
      await context?.close().catch(() => {});
    }
  }
}
