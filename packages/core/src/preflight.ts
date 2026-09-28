import { promises as fs } from 'fs';
import path from 'path';
import type { BrowserContext } from 'playwright';
import type { PreFlightResult, ProductProfile, RoleCredential } from '@qa/types';
import type { BrowserManager } from './browser.js';

export class PreFlightChecker {
  async checkUrlReachable(
    url: string,
    tunnelAuth?: string
  ): Promise<{ ok: boolean; status?: number; error?: string }> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'QA-Readiness-Checker/0.1.0',
        'X-Tunnel-Skip-AntiPhishing-Page': 'true',
      };
      if (tunnelAuth) {
        headers['X-Tunnel-Authorization'] = tunnelAuth;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      return {
        ok: res.status < 500,
        status: res.status,
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
   * Signs in on the role's sign-in page. Succeeds only when the sign-in form is gone afterwards
   * (a wrong password leaves it on screen), and reports the page the role landed on.
   */
  async signIn(
    context: BrowserContext,
    baseUrl: string,
    credential: RoleCredential,
    saveStorageStatePath?: string
  ): Promise<{ ok: boolean; landingPath?: string }> {
    try {
      const page = await context.newPage();
      const loginUrl = new URL(credential.loginPath || '/login', baseUrl).toString();

      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });

      // Fill the form that holds the password field, not a search box elsewhere on the page.
      const passwordInput = page.locator('input[type="password"], [data-testid="password-input"]').first();
      const signInForm = page.locator('form:has(input[type="password"])').first();
      const scope = (await signInForm.count()) > 0 ? signInForm : page.locator('body');
      const hadPasswordField = (await passwordInput.count()) > 0;

      const usernameInput = scope
        .locator('input[type="email"], input[type="text"], input:not([type]), [data-testid="username-input"], [data-testid="email-input"]')
        .first();

      if ((await usernameInput.count()) > 0 && credential.username) {
        await usernameInput.fill(credential.username);
      }

      if (hadPasswordField && credential.password) {
        await passwordInput.fill(credential.password);
      }

      const submitBtn = scope
        .locator('button[type="submit"], input[type="submit"], [data-testid="login-btn"], [data-testid="submit-btn"], button:not([type])')
        .first();

      if ((await submitBtn.count()) > 0) {
        await Promise.all([
          page.waitForURL((url) => url.toString() !== loginUrl, { timeout: 6000 }).catch(() => {}),
          submitBtn.click().catch(() => {}),
        ]);
      }

      await page.waitForTimeout(400);
      const stillOnSignInForm = hadPasswordField && (await passwordInput.isVisible().catch(() => false));
      const landed = new URL(page.url());

      if (!stillOnSignInForm && saveStorageStatePath) {
        await context.storageState({ path: saveStorageStatePath });
      }

      await page.close();
      return { ok: !stillOnSignInForm, landingPath: stillOnSignInForm ? undefined : landed.pathname + landed.search };
    } catch {
      return { ok: false };
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

