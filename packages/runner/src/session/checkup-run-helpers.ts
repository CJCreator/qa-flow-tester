import path from 'path';
import type { Breakpoint, DiscoveryDraft, ReleaseReport, RoleCredential } from '@qa/types';
import { Redactor, redactUrl, runSecrets, type MemorySummary, type SiteMemory, type VisualReviewItemInput } from '@qa/core';

export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
export const ALL_SCREEN_SIZES: Breakpoint[] = ['375px', '768px', '1440px'];
/** Shown to the wizard when the plan could not be written to disk. */
export const PLAN_SAVE_FAILED = "Couldn't save the plan. Try again.";
/** Timing is on when QA_DEBUG is set: the same switch core uses, so the report gets `timing` only then. */
export const timingRequested = (): boolean => !!process.env.QA_DEBUG?.trim();

/**
 * "Test again" may skip the review only when the scan found nothing the approved plan doesn't
 * already cover: no new page, link, journey or question, and every page as it was when planned.
 */
export function nothingNew(draft: DiscoveryDraft, since: MemorySummary, memory: SiteMemory): boolean {
  if (!since.seenBefore || since.newPages > 0 || since.newJourneys > 0 || since.newQuestions > 0) return false;
  if (draft.plan?.navigation.some((n) => n.isNew)) return false;
  const planned = memory.plan?.pages || {};
  return draft.pages.every((p) => planned[p.urlPath] !== undefined && planned[p.urlPath].contentKey === p.contentKey);
}

/**
 * The address to connect to: a host alias, or localhost mapped to the host machine when the
 * runner itself runs in a container. Everything else is used as typed.
 */
export function resolveTargetUrl(
  targetUrl: string,
  hostAliases: Record<string, string> = {},
  localhostAlias?: string
): string {
  try {
    const u = new URL(targetUrl);
    const alias = hostAliases[u.hostname.toLowerCase()];
    if (alias) u.hostname = alias;
    else if (localhostAlias && LOOPBACK_HOSTS.includes(u.hostname)) u.hostname = localhostAlias;
    else return targetUrl;
    return u.toString();
  } catch {
    return targetUrl;
  }
}

/** "30 September 2026", for sentences in the report. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Redacts secrets from error messages: passwords, tokens, email usernames, custom header values,
 * tunnel authorization, and session cookies. Also strips URL query strings so query secrets never leak.
 */
export function redactedMessage(
  err: unknown,
  extra?: {
    roles?: Array<Partial<RoleCredential>>;
    customHeaders?: Record<string, string>;
    tunnelAuth?: string;
    cookies?: Array<{ name?: string; value?: string }>;
    targetUrl?: string;
  }
): string {
  const raw = err instanceof Error ? err.message : String(err);
  const redactor = new Redactor(runSecrets(extra ?? {}));
  let out = redactor.text(raw);
  out = redactUrl(out);
  out = out.replace(/(https?:\/\/[^\s"'<>)]+)\?[^\s"'<>)]*/gi, '$1');
  return out;
}

/**
 * One screen per Layout Group (its first page visited), with its screenshot at each size: what the
 * AI's visual review looks at.
 */
export function screensForReview(
  report: ReleaseReport,
  draft?: DiscoveryDraft,
  runDir?: string
): VisualReviewItemInput[] {
  const groupOf = new Map((draft?.plan?.pages ?? []).map((p) => [p.urlPath, p.layoutGroup || p.urlPath]));
  const byGroup = new Map<string, VisualReviewItemInput>();
  for (const result of report.results) {
    if (result.flowId !== 'page-visit' || !result.breakpoint) continue;
    const shot = [...result.stepEvidence].reverse().find((s) => s.screenshotPath);
    if (!shot?.screenshotPath) continue;
    let urlPath: string;
    try {
      urlPath = new URL(shot.urlAfter || shot.urlBefore).pathname;
    } catch {
      continue;
    }
    const group = groupOf.get(urlPath) ?? urlPath;
    const screen = byGroup.get(group) ?? { layoutGroup: group, urlPath, screenshots: [] };
    byGroup.set(group, screen);
    if (
      screen.urlPath === urlPath &&
      !screen.screenshots.some((s: { breakpoint: string }) => s.breakpoint === result.breakpoint)
    ) {
      screen.screenshots.push({
        breakpoint: result.breakpoint,
        imagePath: runDir ? path.resolve(runDir, shot.screenshotPath) : shot.screenshotPath,
      });
    }
  }
  return [...byGroup.values()];
}
