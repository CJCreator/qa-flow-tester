import type { BrowserContext } from 'playwright';
import { MUTATING_METHODS } from './live-site.js';

/**
 * Remembers whether a Test already sent a change (POST/PUT/PATCH/DELETE) to the checked site after
 * a click. Used to decline the Clean Flow Retry so a retry cannot create a duplicate record.
 */
export class SendGuard {
  private currentClick: number | undefined;
  private readonly steps = new Set<number>();

  constructor(private readonly siteHostname: string) {}

  /** For a site address; one that does not parse matches no request (never throws). */
  static forUrl(siteUrl: string): SendGuard {
    try {
      return new SendGuard(new URL(siteUrl).hostname);
    } catch {
      return new SendGuard('');
    }
  }

  clickStarted(stepIndex: number): void {
    this.currentClick = stepIndex;
  }

  noteRequest(r: { method: string; url: string; resourceType?: string }): void {
    if (this.currentClick === undefined) return;
    if (!MUTATING_METHODS.includes(r.method.toUpperCase())) return;
    if (r.resourceType === 'ping') return;
    let host: string;
    try {
      host = new URL(r.url).hostname;
    } catch {
      return;
    }
    if (host !== this.siteHostname) return;
    this.steps.add(this.currentClick);
  }

  hasSentAny(): boolean {
    return this.steps.size > 0;
  }

  sentBySteps(): number[] {
    return [...this.steps].sort((a, b) => a - b);
  }
}

/** Passive listener only: never routes or blocks anything. */
export function watchSends(context: BrowserContext, guard: SendGuard): void {
  context.on('request', (r) => guard.noteRequest({ method: r.method(), url: r.url(), resourceType: r.resourceType() }));
}
