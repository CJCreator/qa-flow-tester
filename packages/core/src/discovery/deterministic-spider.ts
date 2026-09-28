import type { BrowserContext } from 'playwright';
import type { PageInventoryItem, SensitiveAction, AmbiguityQuestion, ElementInventoryItem } from '@qa/types';
import { SafetyFilter } from './safety-filter.js';
import { collectElementInventory, TEST_ID_ATTRIBUTES } from './element-inventory.js';
import { redactUrl } from '../redact.js';

export interface FormInputInfo {
  /** The HTML name attribute (may be empty). */
  name: string;
  /** What a person would call the field: its label, then placeholder, then id, then name attribute. */
  label: string;
  type: string;
  selector: string;
  defaultValue?: string;
  required?: boolean;
}

export interface DiscoveredFormInfo {
  id?: string;
  action: string;
  method: string;
  urlPath: string;
  inputs: FormInputInfo[];
  submitButtonSelector?: string;
}

export interface SpiderResult {
  pages: PageInventoryItem[];
  forms: DiscoveredFormInfo[];
  sensitiveActions: SensitiveAction[];
  ambiguityQuestions: AmbiguityQuestion[];
  /** Pages that sent the crawler to a sign-in form instead of opening. */
  signInWalls: string[];
}

export interface CrawlOptions {
  /** Where to start besides the target URL, e.g. the page a role landed on after signing in. */
  startPaths?: string[];
  /** Click script-driven links and navigation buttons to find pages links alone don't reach. Default true. */
  exploreClicks?: boolean;
}

/** Links and buttons that would end a signed-in session. */
export const SESSION_ENDING = /log\s*-?\s*out|sign\s*-?\s*out|log\s*off|signoff/i;
/** Never clicked while exploring: they change or send things. */
export const RISKY_TO_CLICK =
  /reset|delete|remove|destroy|clear|cancel|pay|purchase|buy|place order|subscribe|send|submit|finish|confirm|save|apply|upload|download|print|share|invite|deactivate|close/i;
/** Buttons whose name suggests they only move to another screen. */
const NAVIGATION_WORDS =
  /checkout|cart|basket|bag|view|details|more|next|continue|back|browse|shop|start|explore|profile|account|settings|dashboard|home|open/i;
const MAX_CLICKS_PER_PAGE = 8;
const MAX_EXPLORATION_CLICKS = 40;

export class DeterministicSpider {
  private safetyFilter: SafetyFilter;
  private maxPages: number;

  constructor(forbiddenActions: string[] = [], maxPages = 30) {
    this.safetyFilter = new SafetyFilter(forbiddenActions);
    this.maxPages = maxPages;
  }

  async crawl(context: BrowserContext, targetUrl: string, options: CrawlOptions = {}): Promise<SpiderResult> {
    const baseUrlObj = new URL(targetUrl);
    const targetHost = baseUrlObj.host;
    const exploreClicks = options.exploreClicks ?? true;

    // Pages are told apart by path; the first query string seen for a path is kept so the page
    // can be reopened (e.g. /item?id=4 in a single-page app).
    const visited = new Set<string>();
    const queued = new Set<string>();
    const queue: string[] = [];
    const enqueue = (pathAndSearch: string) => {
      const key = new URL(pathAndSearch, targetUrl).pathname;
      if (visited.has(key) || queued.has(key)) return;
      queued.add(key);
      queue.push(pathAndSearch);
    };
    for (const start of [...(options.startPaths || []), baseUrlObj.pathname + baseUrlObj.search || '/']) enqueue(start);

    const pages: PageInventoryItem[] = [];
    const forms: DiscoveredFormInfo[] = [];
    const sensitiveActions: SensitiveAction[] = [];
    const ambiguityQuestions: AmbiguityQuestion[] = [];
    const signInWalls: string[] = [];
    let questionCounter = 1;
    let clickBudget = MAX_EXPLORATION_CLICKS;

    const page = await context.newPage();

    while (queue.length > 0 && visited.size < this.maxPages) {
      const requested = queue.shift()!;
      const requestedPath = new URL(requested, targetUrl).pathname;
      if (visited.has(requestedPath)) continue;
      visited.add(requestedPath);

      const fullUrl = new URL(requested, targetUrl).toString();

      try {
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        const landed = new URL(page.url());
        const hasSignInForm = (await page.locator('input[type="password"]').count()) > 0;

        // Sent somewhere else to sign in: the requested page is behind a sign-in.
        if (landed.pathname !== requestedPath && hasSignInForm) {
          signInWalls.push(requestedPath);
          if (landed.host === targetHost) enqueue(landed.pathname + landed.search);
          continue;
        }
        // Recorded without secrets: some sign-in forms put the password in the address.
        const currentPath = redactUrl(requestedPath + (landed.pathname === requestedPath ? landed.search : ''));
        const title = await page.title().catch(() => currentPath);

        // 1. Discover links (never the ones that would end a signed-in session)
        const hrefs = await page.$$eval('a[href]', (anchors) =>
          anchors.map((a) => ({ href: a.getAttribute('href') || '', text: (a.textContent || '').trim() }))
        );

        for (const { href, text } of hrefs) {
          try {
            if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
            if (SESSION_ENDING.test(href) || SESSION_ENDING.test(text)) continue;
            const resolved = new URL(href, fullUrl);
            if (resolved.host === targetHost) enqueue(resolved.pathname + resolved.search);
          } catch {
            // invalid URL ignored
          }
        }

        // 2. Discover interactive elements and check safety
        const elements = await collectElementInventory(page);

        for (const el of elements) {
          if (el.role !== 'button' && el.role !== 'link' && el.inputType !== 'submit') continue;
          const sensitive = this.safetyFilter.isSensitive(el.name, el.selector);
          if (sensitive) {
            sensitive.urlPath = currentPath;
            sensitiveActions.push(sensitive);
            const q = this.safetyFilter.createAmbiguityQuestion(sensitive, questionCounter++);
            ambiguityQuestions.push(q);
          }
        }

        // 3. Discover Forms
        const pageForms = await page.$$eval(
          'form',
          (formEls, testIdAttributes) =>
          formEls.map((f) => {
            const action = f.getAttribute('action') || '';
            const method = (f.getAttribute('method') || 'GET').toUpperCase();
            const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
            const testIdSelector = (el: Element) => {
              const attr = testIdAttributes.find((a) => el.hasAttribute(a));
              return attr ? `[${attr}="${el.getAttribute(attr)}"]` : null;
            };
            const inputs = Array.from(f.querySelectorAll('input:not([type="hidden"]), select, textarea')).map((inp) => {
              const name = inp.getAttribute('name') || '';
              const type = inp.getAttribute('type') || inp.tagName.toLowerCase();
              const id = inp.getAttribute('id');
              const selector = testIdSelector(inp) || (id ? `#${id}` : `[name="${name}"]`);
              const required = inp.hasAttribute('required');
              const forLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
              const wrapping = inp.closest('label')?.cloneNode(true) as Element | undefined;
              wrapping?.querySelectorAll('input, select, textarea').forEach((c) => c.remove());
              // What a person would call the field: its label, then placeholder, then id, then name.
              const label =
                clean(inp.getAttribute('aria-label')) ||
                clean(forLabel?.textContent) ||
                clean(wrapping?.textContent) ||
                clean(inp.getAttribute('placeholder')) ||
                clean(id) ||
                name;
              return { name, label, type, selector, required };
            });

            const submitBtn = f.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
            let submitSelector: string | undefined;
            if (submitBtn) {
              const sTestId = testIdSelector(submitBtn);
              const sId = submitBtn.getAttribute('id');
              submitSelector = sTestId
                ? sTestId
                : sId
                ? `#${sId}`
                : submitBtn.tagName.toLowerCase() === 'input'
                ? 'input[type="submit"]'
                : 'button[type="submit"]';
            }

            return { action, method, inputs, submitButtonSelector: submitSelector };
          }),
          TEST_ID_ATTRIBUTES
        );

        for (const f of pageForms) {
          forms.push({
            action: f.action,
            method: f.method,
            urlPath: currentPath,
            inputs: f.inputs,
            submitButtonSelector: f.submitButtonSelector,
          });
        }

        pages.push({
          urlPath: currentPath,
          title,
          interactiveElementsCount: elements.length,
          formsCount: pageForms.length,
          elements,
          hasSignInForm: hasSignInForm || undefined,
        });

        // 4. Single-page apps navigate by script: try the controls that look like navigation.
        if (exploreClicks && clickBudget > 0) {
          const tried = new Set<string>();
          const candidates = elements.filter((el) => {
            const key = el.name.toLowerCase();
            if (tried.has(key) || !this.isSafeToExplore(el)) return false;
            tried.add(key);
            return true;
          });
          for (const el of candidates.slice(0, MAX_CLICKS_PER_PAGE)) {
            if (clickBudget-- <= 0) break;
            try {
              if (page.url() !== fullUrl) await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
              await page.locator(el.selector).first().click({ timeout: 3000 });
              await page.waitForTimeout(600);
              const after = new URL(page.url());
              if (after.host === targetHost && after.pathname !== requestedPath) enqueue(after.pathname + after.search);
            } catch {
              // Not clickable after all; move on.
            }
          }
        }
      } catch {
        // Skip page on navigation failure
      }
    }

    await page.close();

    return {
      pages,
      forms,
      sensitiveActions,
      ambiguityQuestions,
      signInWalls,
    };
  }

  /** Controls worth clicking to find script-driven pages: navigation-like, never risky. */
  private isSafeToExplore(el: ElementInventoryItem): boolean {
    if (!el.visible || !el.enabled || el.insideForm) return false;
    if (RISKY_TO_CLICK.test(el.name) || SESSION_ENDING.test(el.name)) return false;
    if (this.safetyFilter.isSensitive(el.name, el.selector)) return false;
    const scriptLink = el.role === 'link' && (!el.href || el.href === '#' || el.href.startsWith('javascript:'));
    const navButton = el.role === 'button' && NAVIGATION_WORDS.test(el.name);
    return scriptLink || navButton;
  }
}
