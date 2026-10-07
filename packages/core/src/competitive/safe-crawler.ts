import { chromium, type Page } from 'playwright';
import path from 'path';
import { promises as fs } from 'fs';
import type { Finding, ReferenceFlow, ReferenceFlowStep, StepEvidence, VisitedPage } from '@qa/types';
import { BugDetectionChecker, UXQualityChecker } from '@qa/checkers';
import { EvidenceCollector } from '../evidence.js';
import { isSameSite } from '../same-site.js';
import { RobotsPolicy } from './robots.js';

export interface SafeCrawlerOptions {
  entryUrl: string;
  flowName?: string;
  maxSteps?: number;
  outputDir?: string;
  actionDelayMs?: number;
  headless?: boolean;
  /** Honor the site's robots.txt. Default true; disable only for our own staging targets. */
  respectRobots?: boolean;
  /** Called before each step is recorded (1-based), with a short description of what led to it. */
  onStepStarted?: (stepIndex: number, action: string) => void;
  /** Called after each step, with the findings collected so far (only when checks run). */
  onStepCompleted?: (stepIndex: number, findingsSoFar: number) => void;
  /** scan() only: pages to visit by following same-site links. Default 25, at most 60. */
  maxPages?: number;
  /** Minimum pause between page loads, to go easy on the site. Default 2000 ms. */
  pageDelayMs?: number;
  /** Called after each page is visited. */
  onPageVisited?: (page: VisitedPage, pagesSoFar: number) => void;
}

export interface SafeScanResult {
  flow: ReferenceFlow;
  findings: Finding[];
  stepEvidence: StepEvidence[];
  /** Mutating requests or off-site navigations the interceptor refused, as "METHOD url". */
  blockedRequests: string[];
  /** Every page visited, in order, with its layout group. */
  pages: VisitedPage[];
  /** Same-site pages robots.txt asked crawlers to leave alone. */
  skippedByRobots: string[];
}

const USER_AGENT_TOKEN = 'QA-Benchmarking-Bot';
/** Hard ceiling on in-page interaction hops for external sites. */
const MAX_CRAWL_STEPS = 5;
const DEFAULT_SCAN_PAGES = 25;
const MAX_SCAN_PAGES = 60;
const DEFAULT_PAGE_DELAY_MS = 2000;
const MUTATING_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];
/** Links to files rather than pages. */
const NOT_A_PAGE =
  /\.(pdf|zip|gz|rar|7z|jpe?g|png|gif|webp|svg|ico|mp4|webm|mp3|wav|docx?|xlsx?|pptx?|csv|exe|dmg|apk)$/i;
/** Links that would end a session, never followed. */
const SESSION_ENDING = /log-?out|sign-?out|logoff/i;

/** The folder a scan stays in: the start page's folder ("/" when it starts at the root). */
export function scanScope(entryUrl: string): string {
  const pathname = new URL(entryUrl).pathname;
  return pathname.slice(0, pathname.lastIndexOf('/') + 1) || '/';
}

/** This machine, a private network address, or Docker's name for the host. */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === 'host.docker.internal' ||
    h === '::1' ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/**
 * The shape of a path, with its variable parts replaced: /catalogue/a-light-in-the-attic_1000/index.html
 * and /catalogue/soumission_998/index.html share the shape /catalogue/*\/index.html.
 */
function pathShape(pathname: string): string {
  const segments = pathname.split('/');
  const last = segments.map((s) => s !== '').lastIndexOf(true);
  return segments
    .map((seg, i) =>
      // The last part names the item (/category/books, /category/games); numbers, long
      // strings and slugs vary too.
      i === last || /\d/.test(seg) || seg.length > 24 || /^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/i.test(seg) ? '*' : seg
    )
    .join('/');
}

/**
 * A fingerprint of the page's structure, ignoring text and class names, with repeated siblings
 * collapsed, so pages built from one template (every product page) share it.
 */
export async function readLayoutFingerprint(page: Page): Promise<string> {
  const outline = await page
    .evaluate(() => {
      const IGNORED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
      const walk = (el: Element, depth: number): string => {
        if (depth > 4) return '';
        const parts: string[] = [];
        for (const child of Array.from(el.children)) {
          if (IGNORED.has(child.tagName)) continue;
          const role = child.getAttribute('role');
          const part = `${child.tagName.toLowerCase()}${role ? `[${role}]` : ''}(${walk(child, depth + 1)})`;
          if (parts[parts.length - 1] !== part) parts.push(part);
        }
        return parts.join(',');
      };
      return walk(document.body, 0);
    })
    .catch(() => '');
  // djb2: short and stable, enough to tell templates apart.
  let hash = 5381;
  for (let i = 0; i < outline.length; i++) hash = ((hash << 5) + hash + outline.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/**
 * Runs in every document before site scripts: swallows submit events and turns the
 * programmatic submit APIs into no-ops, so no form can be sent by any path.
 */
const BLOCK_FORM_SUBMISSION_SCRIPT = `
  document.addEventListener('submit', (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
  HTMLFormElement.prototype.submit = function () {};
  HTMLFormElement.prototype.requestSubmit = function () {};
`;

export class SafePublicCrawler {
  /**
   * Crawls a public website in Safe Interaction Mode.
   * Interacts with non-destructive UI controls (tabs, accordions, toggles)
   * while deterministically blocking form submissions and mutating HTTP calls.
   */
  async crawl(options: SafeCrawlerOptions): Promise<ReferenceFlow> {
    return (await this.explore(options, false)).flow;
  }

  /**
   * Same read-only crawl, additionally running the bug-detection and accessibility checkers
   * at every step it reaches. Checkers only observe the page; they never interact with it.
   */
  async scan(options: SafeCrawlerOptions): Promise<SafeScanResult> {
    return this.explore(options, true);
  }

  private async explore(options: SafeCrawlerOptions, runChecks: boolean): Promise<SafeScanResult> {
    const entryUrl = options.entryUrl;
    const maxSteps = Math.min(Math.max(options.maxSteps ?? MAX_CRAWL_STEPS, 1), MAX_CRAWL_STEPS);
    // The reference flow (competitor comparison) stays on one page; a scan follows links.
    const maxPages = runChecks ? Math.min(Math.max(options.maxPages ?? DEFAULT_SCAN_PAGES, 1), MAX_SCAN_PAGES) : 1;
    const actionDelayMs = options.actionDelayMs ?? 400;
    const outputDir = path.resolve(options.outputDir || path.join(process.cwd(), '.qa-compare'));
    const evidenceDir = path.join(outputDir, 'evidence');
    await fs.mkdir(evidenceDir, { recursive: true });

    const targetUrlObj = new URL(entryUrl);
    const targetHost = targetUrlObj.hostname;
    // The pause between pages is courtesy to sites we don't own; a local build doesn't need it.
    const pageDelayMs = options.pageDelayMs ?? (isPrivateHost(targetHost) ? 0 : DEFAULT_PAGE_DELAY_MS);

    const robots =
      options.respectRobots === false
        ? RobotsPolicy.allowAll()
        : await RobotsPolicy.fetch(targetUrlObj.origin, USER_AGENT_TOKEN);
    if (!robots.isAllowed(targetUrlObj.pathname + targetUrlObj.search)) {
      throw new Error(`robots.txt on ${targetUrlObj.origin} disallows crawling ${targetUrlObj.pathname}`);
    }

    const browser = await chromium.launch({
      headless: options.headless !== false,
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ${USER_AGENT_TOKEN}/1.0`,
    });
    await context.addInitScript(BLOCK_FORM_SUBMISSION_SCRIPT);

    const page = await context.newPage();
    const blockedRequests: string[] = [];

    // 1. Strict Security Interceptor: Block mutating HTTP methods & external domain escapes
    await page.route('**/*', (route) => {
      const request = route.request();
      const method = request.method().toUpperCase();
      const reqUrl = request.url();
      const block = () => {
        blockedRequests.push(`${method} ${reqUrl}`);
        return route.abort();
      };

      // Block all mutating HTTP requests on external websites
      if (MUTATING_METHODS.includes(method)) {
        return block();
      }

      // Block third-party redirects / navigation outside target host
      try {
        const u = new URL(reqUrl);
        if (
          request.isNavigationRequest() &&
          !isSameSite(u.hostname, targetHost) &&
          !u.hostname.endsWith(`.${targetHost}`)
        ) {
          return block();
        }
        if (
          request.isNavigationRequest() &&
          isSameSite(u.hostname, targetHost) &&
          !robots.isAllowed(u.pathname + u.search)
        ) {
          return block();
        }
      } catch {
        // Continue
      }

      return route.continue();
    });

    const collector = new EvidenceCollector(evidenceDir);
    const bugChecker = new BugDetectionChecker();
    const uxChecker = new UXQualityChecker();
    if (runChecks) collector.attach(page);

    const steps: ReferenceFlowStep[] = [];
    const stepEvidence: StepEvidence[] = [];
    const pages: VisitedPage[] = [];
    const skippedByRobots: string[] = [];
    const layoutIds = new Map<string, string>();
    let findings: Finding[] = [];
    let stepIndex = 0;

    /** Records the page as it is now: screenshot, reference-flow step, and (when scanning) checks. */
    const recordStep = async (action: string, stepStartedAt: number): Promise<string> => {
      const currentUrl = page.url();
      const pageTitle = await page.title();
      const pageMetrics = await readPageMetrics(page);

      const screenshotFilePath = path.join(evidenceDir, `step-${stepIndex}-${Date.now()}.png`);
      try {
        await page.screenshot({ path: screenshotFilePath, fullPage: false });
      } catch {
        // If screenshot fails, continue
      }

      steps.push({
        stepIndex,
        action,
        url: currentUrl,
        title: pageTitle,
        screenshotPath: screenshotFilePath,
        interactiveControlsFound: pageMetrics.interactiveControls,
        fieldsCount: pageMetrics.fieldsCount,
        requiredFieldsCount: pageMetrics.requiredFieldsCount,
      });

      if (runChecks) {
        findings.push(
          ...(await this.checkStep(page, collector, bugChecker, uxChecker, blockedRequests, {
            stepIndex,
            action,
            urlBefore: steps[steps.length - 2]?.url ?? entryUrl,
            screenshotPath: screenshotFilePath,
            startedAt: stepStartedAt,
            stepEvidence,
            entryPath: targetUrlObj.pathname,
          }))
        );
        findings = uxChecker.deduplicateFindings(findings);
      }
      options.onStepCompleted?.(stepIndex, findings.length);
      return screenshotFilePath;
    };

    // A review started below the site root stays in that part of the site: a demo at
    // /WAI/demos/bad/before/home.html is reviewed, not the rest of w3.org.
    const scopePrefix = scanScope(entryUrl);

    // Pages to visit, told apart by path. Addresses of a shape not seen yet go first, so 25 pages
    // cover a shop's categories, products and pagination rather than 25 categories.
    const seenPaths = new Set<string>([targetUrlObj.pathname]);
    const seenShapes = new Set<string>([pathShape(targetUrlObj.pathname)]);
    const newShapes: string[] = [];
    const others: string[] = [];
    const enqueueLinks = (hrefs: string[]) => {
      for (const href of hrefs) {
        let u: URL;
        try {
          u = new URL(href, page.url());
        } catch {
          continue;
        }
        u.hash = '';
        if (!isSameSite(u.hostname, targetHost) || !/^https?:$/.test(u.protocol)) continue;
        if (!u.pathname.startsWith(scopePrefix)) continue;
        if (NOT_A_PAGE.test(u.pathname) || SESSION_ENDING.test(u.pathname) || seenPaths.has(u.pathname)) continue;
        seenPaths.add(u.pathname);
        if (!robots.isAllowed(u.pathname + u.search)) {
          skippedByRobots.push(u.pathname);
          continue;
        }
        const shape = pathShape(u.pathname);
        if (seenShapes.has(shape)) others.push(u.toString());
        else {
          seenShapes.add(shape);
          newShapes.push(u.toString());
        }
      }
    };

    try {
      let nextUrl: string | undefined = entryUrl;
      let lastLoadAt = 0;
      while (nextUrl && pages.length < maxPages) {
        const isEntry = pages.length === 0;
        const action = isEntry ? 'Navigate to entry page' : `Opened ${new URL(nextUrl).pathname}`;
        // Go easy on sites we don't own: a pause between page loads.
        if (!isEntry) await page.waitForTimeout(Math.max(0, lastLoadAt + pageDelayMs - Date.now()));

        stepIndex++;
        const stepStartedAt = Date.now();
        options.onStepStarted?.(stepIndex, action);
        try {
          await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (err) {
          if (isEntry) throw err;
          nextUrl = newShapes.shift() ?? others.shift();
          continue;
        }
        lastLoadAt = Date.now();
        await page.waitForTimeout(actionDelayMs);

        const screenshotPath = await recordStep(action, stepStartedAt);
        const landed = new URL(page.url());
        const fingerprint = await readLayoutFingerprint(page);
        if (!layoutIds.has(fingerprint)) layoutIds.set(fingerprint, `layout-${layoutIds.size + 1}`);
        pages.push({
          urlPath: landed.pathname,
          title: await page.title(),
          layoutGroup: layoutIds.get(fingerprint)!,
          screenshotPath,
        });
        options.onPageVisited?.(pages[pages.length - 1], pages.length);

        if (pages.length < maxPages) {
          enqueueLinks(await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href') || '')));
        }

        // Safe in-page exploration: tabs, pricing toggles, accordions. The entry page gets the
        // most attention (as the reference flow always did); later pages get one control each.
        const controlBudget = isEntry ? maxSteps - 1 : Math.min(1, maxSteps - 1);
        for (let c = 0; c < controlBudget; c++) {
          const clicked = await clickNextSafeControl(page);
          if (!clicked) break;
          stepIndex++;
          options.onStepStarted?.(stepIndex, clicked);
          await page.waitForTimeout(actionDelayMs);
          await recordStep(clicked, Date.now());
        }

        nextUrl = newShapes.shift() ?? others.shift();
      }
    } finally {
      await browser.close();
    }

    return {
      flow: {
        id: `ref_${targetHost}_${Date.now()}`,
        targetDomain: targetHost,
        entryUrl,
        name: options.flowName || 'reference-flow',
        steps,
        timestamp: new Date().toISOString(),
      },
      findings,
      stepEvidence,
      blockedRequests,
      pages,
      skippedByRobots: [...new Set(skippedByRobots)],
    };
  }

  private async checkStep(
    page: Page,
    collector: EvidenceCollector,
    bugChecker: BugDetectionChecker,
    uxChecker: UXQualityChecker,
    blockedRequests: string[],
    step: {
      stepIndex: number;
      action: string;
      urlBefore: string;
      screenshotPath: string;
      startedAt: number;
      stepEvidence: StepEvidence[];
      entryPath: string;
    }
  ): Promise<Finding[]> {
    // Requests our own interceptor aborted are not site defects.
    const blocked = new Set(blockedRequests);
    const evidence: StepEvidence = {
      stepIndex: step.stepIndex,
      stepName: step.action,
      action: step.stepIndex === 1 ? 'navigate' : 'click',
      urlBefore: step.urlBefore,
      urlAfter: page.url(),
      screenshotPath: step.screenshotPath,
      consoleErrors: collector.getConsoleLogs().filter((l) => l.type === 'error'),
      failedRequests: collector
        .getNetworkLogs()
        .filter((n) => (n.status >= 400 || n.status === 0) && !blocked.has(`${n.method.toUpperCase()} ${n.url}`)),
      durationMs: Date.now() - step.startedAt,
      passed: true,
    };
    // Each step reports only what happened since the previous one.
    collector.clearLogs();
    step.stepEvidence.push(evidence);

    const context = {
      testCaseId: `SAFE-${step.stepIndex}`,
      flowId: 'safe-website-scan',
      role: 'visitor',
      breakpoint: '1440px' as const,
      urlPath: new URL(page.url()).pathname,
    };
    const bugFindings = bugChecker.check([evidence], context);
    const uxFindings = await uxChecker.check(page, { ...context, enableAxe: true, entryPath: step.entryPath });
    for (const f of [...bugFindings, ...uxFindings]) {
      f.flowId = context.flowId;
      f.evidence.screenshotPath ??= step.screenshotPath;
    }
    return [...bugFindings, ...uxFindings];
  }
}

async function readPageMetrics(page: Page) {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'));
    const requiredCount = inputs.filter((el) => {
      return (
        el.hasAttribute('required') ||
        el.getAttribute('aria-required') === 'true' ||
        (el.getAttribute('placeholder') || '').includes('*')
      );
    }).length;

    const buttonTexts = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim());
    const controls: string[] = [];
    if (document.querySelector('[role="tab"]') || buttonTexts.some((t) => /^(monthly|annual|yearly)\b/i.test(t))) {
      controls.push('pricing-frequency-tabs');
    }
    if (document.querySelector('details, [aria-expanded]')) {
      controls.push('expandable-accordion');
    }
    if (document.querySelector('button[aria-label*="google" i], a[href*="google.com/o/oauth2" i]')) {
      controls.push('google-sso');
    }
    if (document.querySelector('button[aria-label*="github" i], a[href*="github.com/login" i]')) {
      controls.push('github-sso');
    }

    return {
      fieldsCount: inputs.length,
      requiredFieldsCount: requiredCount,
      interactiveControls: controls,
    };
  });
}

/** Clicks one not-yet-clicked tab, pricing toggle, or accordion. Returns a description, or null if none is left. */
async function clickNextSafeControl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const CLICKED = 'data-qa-safe-clicked';
    const forbiddenSubmitRegex = /submit|pay|place order|buy now|purchase|checkout|sign up|register|delete/i;

    // A <button> inside a form defaults to type=submit; never touch those.
    const wouldSubmit = (el: Element) =>
      (el instanceof HTMLButtonElement && el.type === 'submit' && !!el.form) ||
      (el instanceof HTMLInputElement && ['submit', 'image'].includes(el.type));
    const isVisible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const eligible = (el: Element) =>
      !el.hasAttribute(CLICKED) &&
      !wouldSubmit(el) &&
      isVisible(el) &&
      !forbiddenSubmitRegex.test((el.textContent || '').trim());
    const click = (el: Element, description: string) => {
      el.setAttribute(CLICKED, 'true');
      (el as HTMLElement).click();
      return description;
    };

    // 1. Unselected tab or pricing-frequency toggle (e.g. Monthly/Annual, Features)
    const tabs = Array.from(document.querySelectorAll('[role="tab"], button'));
    for (const tab of tabs) {
      if (!eligible(tab)) continue;
      const text = (tab.textContent || '').trim();
      const isTab = tab.getAttribute('role') === 'tab';
      const isToggle = /\b(annual|yearly|monthly|features)\b/i.test(text);
      if (tab.getAttribute('aria-selected') !== 'true' && (isTab || isToggle)) {
        return click(tab, `Switched to “${text.slice(0, 40)}”`);
      }
    }

    // 2. Collapsed accordion or disclosure
    const summaries = Array.from(document.querySelectorAll('summary, [aria-expanded="false"]'));
    const summary = summaries.find(eligible);
    if (summary) {
      const text = (summary.textContent || '').trim().slice(0, 40);
      return click(summary, text ? `Expanded “${text}”` : 'Expanded a collapsed section');
    }

    return null;
  });
}
