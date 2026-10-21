import { promises as fs } from 'fs';
import path from 'path';
import type { Page, Response } from 'playwright';
import type { ConsoleEntry, NetworkEntry, StepEvidence } from '@qa/types';

/**
 * Sign-in fields painted over in every screenshot (a stated decision, not a setting): the password,
 * and the username or email box a sign-in form uses.
 */
export const SIGN_IN_FIELD_SELECTORS: readonly string[] = [
  'input[type="password"]',
  'input[autocomplete="username"]',
  'input[type="email"]',
];

export class EvidenceCollector {
  private consoleLogs: ConsoleEntry[] = [];
  private networkLogs: NetworkEntry[] = [];
  private stepEvidenceList: StepEvidence[] = [];
  private evidenceDir: string;
  /** How much of each log earlier steps already reported, so each step reports only its own. */
  private consoleReported = 0;
  private networkReported = 0;
  /** Hides secrets from text evidence as it is written, so a run that stops early leaves none. */
  private redact: (text: string) => string;

  constructor(evidenceDir: string, redact: (text: string) => string = (text) => text) {
    this.evidenceDir = evidenceDir;
    this.redact = redact;
  }

  attach(page: Page): void {
    this.consoleLogs = [];
    this.networkLogs = [];
    this.consoleReported = 0;
    this.networkReported = 0;

    page.on('console', (msg) => {
      const type = msg.type();
      const validTypes: Array<ConsoleEntry['type']> = ['error', 'warning', 'log', 'info'];
      this.consoleLogs.push({
        type: validTypes.includes(type as ConsoleEntry['type']) ? (type as ConsoleEntry['type']) : 'info',
        text: msg.text(),
        // For "Failed to load resource", this is the file that failed.
        url: msg.location()?.url || undefined,
        timestamp: Date.now(),
      });
    });

    page.on('pageerror', (err) => {
      this.consoleLogs.push({
        type: 'error',
        text: `Uncaught Exception: ${err.message}\n${err.stack || ''}`,
        timestamp: Date.now(),
      });
    });

    const requestStartTimes = new Map<object, number>();
    page.on('request', (req) => {
      requestStartTimes.set(req, Date.now());
    });

    page.on('requestfailed', (req) => {
      const startTime = requestStartTimes.get(req);
      const durationMs = startTime ? Date.now() - startTime : undefined;
      requestStartTimes.delete(req);
      // ERR_ABORTED: the page unloaded (a form submit that navigates away) before the response came back.
      // That is the action finishing, not the site failing.
      const aborted = req.failure()?.errorText === 'net::ERR_ABORTED';
      this.networkLogs.push({
        url: req.url(),
        method: req.method(),
        status: 0,
        ...(aborted ? { aborted: true } : {}),
        postData: req.postData() || undefined,
        durationMs,
        timestamp: Date.now(),
      });
    });

    page.on('response', (res: Response) => {
      const status = res.status();
      const req = res.request();
      const startTime = requestStartTimes.get(req);
      const durationMs = startTime ? Date.now() - startTime : undefined;
      requestStartTimes.delete(req);
      this.networkLogs.push({
        url: res.url(),
        method: res.request().method(),
        status,
        durationMs,
        timestamp: Date.now(),
      });
    });
  }

  async recordStep(
    page: Page,
    stepIndex: number,
    stepName: string,
    action: string,
    urlBefore: string,
    passed: boolean,
    error?: string
  ): Promise<StepEvidence> {
    await fs.mkdir(this.evidenceDir, { recursive: true });

    const safeName = stepName.replace(/[^a-zA-Z0-9_\-]/g, '_');

    // Screenshot and DOM dump only for a failed step: a passing step's evidence is rarely read, and taking it costs time.
    let screenshotPath: string | undefined;
    let domSnapshotPath: string | undefined;
    if (!passed) {
      const screenshotFilename = `step-${stepIndex}-${safeName}.png`;
      screenshotPath = path.join(this.evidenceDir, screenshotFilename);
      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
          mask: SIGN_IN_FIELD_SELECTORS.map((s) => page.locator(s)),
        });
      } catch {
        // If page is closed or unresponsive, ignore screenshot error
      }

      const domFilename = `step-${stepIndex}-${safeName}.html`;
      domSnapshotPath = path.join(this.evidenceDir, domFilename);
      try {
        const content = await page.content();
        await fs.writeFile(domSnapshotPath, this.redact(content), 'utf8');
      } catch {
        // Ignore content failure
      }
    }

    // Only what happened since the previous step: otherwise one console error is reported again
    // at every later step of the flow.
    const consoleErrors = this.consoleLogs.slice(this.consoleReported).filter((l) => l.type === 'error');
    const failedRequests = this.networkLogs
      .slice(this.networkReported)
      .filter((n) => n.status >= 400 || (n.status === 0 && !n.aborted));
    this.consoleReported = this.consoleLogs.length;
    this.networkReported = this.networkLogs.length;

    const stepEvidence: StepEvidence = {
      stepIndex,
      stepName,
      action,
      urlBefore,
      urlAfter: page.url(),
      screenshotPath,
      domSnapshotPath,
      consoleErrors: [...consoleErrors],
      failedRequests: [...failedRequests],
      durationMs: 0,
      passed,
      error,
    };

    this.stepEvidenceList.push(stepEvidence);
    return stepEvidence;
  }

  getConsoleLogs(): ConsoleEntry[] {
    return [...this.consoleLogs];
  }

  getNetworkLogs(): NetworkEntry[] {
    return [...this.networkLogs];
  }

  getStepEvidenceList(): StepEvidence[] {
    return [...this.stepEvidenceList];
  }

  clearLogs(): void {
    this.consoleLogs = [];
    this.networkLogs = [];
    this.consoleReported = 0;
    this.networkReported = 0;
  }
}
