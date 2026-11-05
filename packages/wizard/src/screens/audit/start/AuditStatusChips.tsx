import type { AuditAiStatus } from '@qa/types/src/browser.js';

export type AuditSpeedSource = 'pagespeed-insights' | 'this-tool' | 'not-measured';

export interface AuditStatusChipsProps {
  ai?: AuditAiStatus;
  speed?: AuditSpeedSource;
}

export function aiStatusText(ai?: AuditAiStatus): string | null {
  switch (ai) {
    case 'ready':
      return 'AI: ready';
    case 'key-expired':
      return 'AI: key expired: update in Audit settings';
    case 'no-key':
      return 'AI: no key: template text';
    case 'quota':
      return 'AI: quota reached: template text';
    case 'timeout':
      return 'AI: timeout: template text';
    case 'provider-error':
      return 'AI: provider error: template text';
    default:
      return null;
  }
}

export function speedStatusText(speed?: AuditSpeedSource): string | null {
  switch (speed) {
    case 'pagespeed-insights':
      return 'Speed: PageSpeed Insights';
    case 'this-tool':
      return 'Speed: measured by this tool';
    case 'not-measured':
      return 'Speed: not measured';
    default:
      return null;
  }
}

/**
 * Status chips for a Website Audit: AI availability and speed measurement source.
 * Never judges the site or uses banned words (ADR 0018, ADR 0042).
 */
export function AuditStatusChips({ ai, speed }: AuditStatusChipsProps) {
  const aiLabel = aiStatusText(ai);
  const speedLabel = speedStatusText(speed);

  if (!aiLabel && !speedLabel) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="audit-status-chips">
      {aiLabel && (
        <span
          className="inline-flex items-center rounded-full border border-rule bg-raised px-2.5 py-0.5 text-xs font-medium text-ink-soft"
          data-testid="ai-status-chip"
        >
          {aiLabel}
        </span>
      )}
      {speedLabel && (
        <span
          className="inline-flex items-center rounded-full border border-rule bg-raised px-2.5 py-0.5 text-xs font-medium text-ink-soft"
          data-testid="speed-status-chip"
        >
          {speedLabel}
        </span>
      )}
    </div>
  );
}
