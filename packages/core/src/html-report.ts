import { promises as fs } from 'fs';
import path from 'path';
import type { ReleaseReport, AspectType, FindingSeverity, RankedRecommendation } from '@qa/types';
import { groupIntoProblems, releaseVerdict } from '@qa/types';

export interface HtmlReportOptions {
  outputDir?: string;
  maxSizeBytes?: number;
}

const GRADE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: '#ECFDF5', text: '#065F46', border: '#059669' },
  B: { bg: '#F0F9FF', text: '#0369A1', border: '#0284C7' },
  C: { bg: '#FFFBEB', text: '#92400E', border: '#D97706' },
  D: { bg: '#FFF7ED', text: '#9A3412', border: '#EA580C' },
  F: { bg: '#FEF2F2', text: '#991B1B', border: '#DC2626' },
};

const SEVERITY_COLORS: Record<FindingSeverity, { bg: string; text: string }> = {
  Blocker: { bg: '#FEE2E2', text: '#991B1B' },
  Major: { bg: '#FFEDD5', text: '#9A3412' },
  Minor: { bg: '#FEF3C7', text: '#92400E' },
  Suggestion: { bg: '#E0E7FF', text: '#3730A3' },
};

/**
 * Generates a completely standalone, self-contained single-file HTML report.
 * Works 100% offline without any external network requests, fonts, or CDN assets.
 * Styled in the Direction B (Blueprint) architectural navy aesthetic.
 */
export async function generateSingleFileHtmlReport(
  report: ReleaseReport,
  options?: HtmlReportOptions
): Promise<string> {
  const outputDir = options?.outputDir || path.join(process.cwd(), '.qa-report');
  const targetFile = path.join(outputDir, 'report.html');

  // One verdict, the same as on screen: the stamp and its reason. There is no overall grade to
  // contradict it; the aspects are graded below.
  const verdict = releaseVerdict(report.findings);
  const gradeStyle = verdict.ready ? GRADE_COLORS.A : GRADE_COLORS.F;
  /** Problems among an area's findings, counted as the verdict counts them. */
  const problemsIn = (ids: string[]) =>
    groupIntoProblems(report.findings.filter((f) => ids.includes(f.id))).filter((p) => !p.toConfirm).length;

  const aspects: AspectType[] = [
    'Works',
    'Accessible',
    'Fast and mobile',
    'Findable',
    'Secure',
    'Looks and reads well',
  ];

  // Aspect Cards HTML
  const aspectCardsHtml = aspects
    .map((aspect) => {
      const data = report.grades?.aspects[aspect];
      if (!data || data.checked === false) {
        return `
        <div class="aspect-card" style="border-top: 4px solid #94A3B8;">
          <div class="aspect-header">
            <span class="aspect-title">${escapeHtml(aspect)}</span>
            <span class="aspect-grade" style="background: #F1F5F9; color: #475569; border: 1px solid #94A3B8;">Not checked</span>
          </div>
          <div class="aspect-footer"><span>Nothing in this run checked it, so it isn’t graded.</span></div>
        </div>
      `;
      }
      const style = GRADE_COLORS[data.grade] || GRADE_COLORS.A;
      return `
        <div class="aspect-card" style="border-top: 4px solid ${style.border};">
          <div class="aspect-header">
            <span class="aspect-title">${escapeHtml(aspect)}</span>
            <span class="aspect-grade" style="background: ${style.bg}; color: ${style.text}; border: 1px solid ${style.border};">
              Grade ${data.grade}
            </span>
          </div>
          <div class="aspect-score-bar">
            <div class="aspect-score-fill" style="width: ${data.score}%; background: ${style.border};"></div>
          </div>
          <div class="aspect-footer">
            <span>Score: ${data.score}/100</span>
            <span>${problemsIn(data.findings)} ${problemsIn(data.findings) === 1 ? 'problem' : 'problems'}</span>
          </div>
        </div>
      `;
    })
    .join('');

  // History Diff Banner HTML
  let historyBannerHtml = '';
  if (report.history) {
    const { newFindingFingerprints, fixedFindingFingerprints, openFindingFingerprints } = report.history;
    historyBannerHtml = `
      <section class="section card history-banner">
        <h2>Changes Since Last Run</h2>
        <div class="history-grid">
          <div class="history-stat fixed">
            <span class="history-num">${fixedFindingFingerprints.length}</span>
            <span class="history-label">Fixed Issues</span>
          </div>
          <div class="history-stat new">
            <span class="history-num">${newFindingFingerprints.length}</span>
            <span class="history-label">New Issues</span>
          </div>
          <div class="history-stat open">
            <span class="history-num">${openFindingFingerprints.length}</span>
            <span class="history-label">Still Open</span>
          </div>
        </div>
      </section>
    `;
  }

  // Recommendations HTML
  const marketingHtml = report.marketing
    ? `
      <section class="section card">
        <h2 class="section-title">Marketing basics</h2>
        <p class="section-desc">Read from ${report.marketing.readPages.map((pg) => `<code>${escapeHtml(pg)}</code>`).join(', ')}. A suggestion depends on what the site is for.</p>
        ${report.marketing.checks
          .map((c) => {
            const mark =
              c.status === 'ok'
                ? 'OK'
                : c.status === 'gap'
                  ? c.kind === 'opinion'
                    ? 'Worth adding'
                    : 'Missing'
                  : 'Not checked';
            return `<div class="finding-row"><span class="finding-label">${escapeHtml(c.label)}${c.kind === 'opinion' ? ' (suggestion)' : ''}:</span><span class="finding-val"><strong>${mark}.</strong> ${escapeHtml(c.detail)}</span></div>`;
          })
          .join('')}
      </section>`
    : '';

  let recommendationsHtml = '';
  if (report.recommendations && report.recommendations.length > 0) {
    const quickWins = report.recommendations.filter((r) => r.category === 'quick-win');
    const biggerChanges = report.recommendations.filter((r) => r.category === 'bigger-change');

    const renderRecList = (recs: RankedRecommendation[]) =>
      recs
        .map(
          (rec) => `
          <div class="rec-item">
            <div class="rec-top">
              <span class="badge ${rec.severity.toLowerCase()}">${rec.severity}</span>
              <span class="rec-aspect">${rec.aspect}</span>
              <span class="rec-effort">Effort: <strong>${rec.effort}</strong></span>
              <span class="rec-impact">Impact: <strong>${rec.impact}</strong></span>
            </div>
            <h4 class="rec-title">${escapeHtml(rec.title)}</h4>
            <p class="rec-summary">${escapeHtml(rec.summary)}</p>
            <div class="rec-fix">
              <strong>Suggested Fix:</strong> ${escapeHtml(rec.suggestedFix)}
            </div>
            <div class="rec-meta">
              <span>Affected: ${rec.affectedPages.map((p) => `<code>${escapeHtml(p)}</code>`).join(', ')}</span>
            </div>
          </div>
        `
        )
        .join('');

    recommendationsHtml = `
      <section class="section card">
        <h2 class="section-title">Prioritized Improvement Recommendations</h2>
        <p class="section-desc">Sorted deterministically by impact, severity, and implementation return on investment.</p>
        
        ${
          quickWins.length > 0
            ? `
          <h4 class="group-heading">⚡ Quick Wins (High Return, Low Effort)</h4>
          <div class="rec-list">${renderRecList(quickWins)}</div>
        `
            : ''
        }

        ${
          biggerChanges.length > 0
            ? `
          <h4 class="group-heading" style="margin-top: 1.5rem;">🏗️ Bigger Changes (Architectural / High Effort)</h4>
          <div class="rec-list">${renderRecList(biggerChanges)}</div>
        `
            : ''
        }
      </section>
    `;
  }

  // Findings List HTML
  const findingsHtml = report.findings
    .map((f) => {
      const sev = SEVERITY_COLORS[f.severity] || SEVERITY_COLORS.Minor;
      return `
        <details class="finding-card">
          <summary class="finding-summary">
            <div class="finding-summary-left">
              <span class="badge" style="background: ${sev.bg}; color: ${sev.text};">${f.severity}</span>
              <span class="finding-checker">${f.checker}</span>
              <span class="finding-title-text">${escapeHtml(f.title)}</span>
            </div>
            <span class="finding-route">${escapeHtml(f.where.urlPath)} (${f.where.breakpoint})</span>
          </summary>
          <div class="finding-details">
            <div class="finding-row">
              <span class="finding-label">Expected:</span>
              <span class="finding-val">${escapeHtml(f.expectedVsActual.expected)}</span>
            </div>
            <div class="finding-row">
              <span class="finding-label">Actual:</span>
              <span class="finding-val">${escapeHtml(f.expectedVsActual.actual)}</span>
            </div>
            <div class="finding-row">
              <span class="finding-label">Resolution:</span>
              <span class="finding-val resolve-text">${escapeHtml(f.resolution)}</span>
            </div>
            <div class="finding-row">
              <span class="finding-label">After you fix it:</span>
              <span class="finding-val">Run the check-up again on the same address. This finding should no longer appear.</span>
            </div>
            ${
              f.stepsToReproduce && f.stepsToReproduce.length > 0
                ? `
              <div class="finding-steps">
                <span class="finding-label">Steps to reproduce:</span>
                <ol>
                  ${f.stepsToReproduce.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
                </ol>
              </div>
            `
                : ''
            }
          </div>
        </details>
      `;
    })
    .join('');

  // Full Standalone HTML Document
  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QA Readiness Report — ${escapeHtml(report.productId)}</title>
  <style>
    :root {
      --bg: #0D1322;
      --card-bg: #FFFFFF;
      --navy-900: #0B1120;
      --navy-800: #1E293B;
      --navy-700: #334155;
      --text-main: #0F172A;
      --text-muted: #64748B;
      --blueprint-line: #1E3A8A;
      --blueprint-bg: #0D1322;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      padding: 2rem 1rem;
      background-image: radial-gradient(rgba(30, 58, 138, 0.25) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    .header-banner {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      border-left: 8px solid ${gradeStyle.border};
    }
    .header-left h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text-main);
    }
    .header-left p {
      color: var(--text-muted);
      margin-top: 0.25rem;
      font-size: 0.95rem;
    }
    .overall-badge {
      text-align: center;
      padding: 1rem 1.5rem;
      border-radius: 12px;
      background: ${gradeStyle.bg};
      border: 2px solid ${gradeStyle.border};
    }
    .overall-grade {
      font-size: 1.6rem;
      font-weight: 800;
      text-transform: uppercase;
      color: ${gradeStyle.text};
      line-height: 1.1;
      transform: rotate(-3deg);
    }
    .overall-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: ${gradeStyle.text};
      margin-top: 0.4rem;
      max-width: 16rem;
    }
    .card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 1.75rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2);
      margin-bottom: 1.5rem;
    }
    .section-title {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-main);
    }
    .section-desc {
      color: var(--text-muted);
      font-size: 0.9rem;
      margin-top: 0.25rem;
      margin-bottom: 1.25rem;
    }
    .aspects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .aspect-card {
      background: var(--card-bg);
      border-radius: 8px;
      padding: 1.25rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .aspect-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .aspect-title {
      font-weight: 600;
      font-size: 1rem;
    }
    .aspect-grade {
      font-weight: 700;
      font-size: 0.85rem;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }
    .aspect-score-bar {
      height: 6px;
      background: #E2E8F0;
      border-radius: 9999px;
      overflow: hidden;
      margin-bottom: 0.75rem;
    }
    .aspect-score-fill {
      height: 100%;
      border-radius: 9999px;
    }
    .aspect-footer {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .history-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      text-align: center;
      margin-top: 1rem;
    }
    .history-stat {
      padding: 1rem;
      border-radius: 8px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
    }
    .history-stat.fixed .history-num { color: #059669; }
    .history-stat.new .history-num { color: #DC2626; }
    .history-stat.open .history-num { color: #D97706; }
    .history-num { font-size: 2rem; font-weight: 800; display: block; }
    .history-label { font-size: 0.85rem; color: var(--text-muted); font-weight: 500; }
    .group-heading {
      font-size: 1rem;
      font-weight: 700;
      color: var(--navy-800);
      margin-bottom: 0.75rem;
    }
    .rec-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .rec-item {
      padding: 1rem;
      border-radius: 8px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
    }
    .rec-top {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.8rem;
      margin-bottom: 0.5rem;
    }
    .rec-aspect { font-weight: 600; color: #1E3A8A; }
    .rec-title { font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem; }
    .rec-summary { font-size: 0.9rem; color: #475569; margin-bottom: 0.5rem; }
    .rec-fix { font-size: 0.85rem; background: #EFF6FF; border-left: 3px solid #2563EB; padding: 0.5rem 0.75rem; border-radius: 0 4px 4px 0; margin-bottom: 0.5rem; }
    .rec-meta { font-size: 0.8rem; color: var(--text-muted); }
    .rec-meta code { color: #0F172A; background: #E2E8F0; padding: 0.1rem 0.3rem; border-radius: 3px; }
    .badge {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
    }
    .badge.blocker { background: #FEE2E2; color: #991B1B; }
    .badge.major { background: #FFEDD5; color: #9A3412; }
    .badge.minor { background: #FEF3C7; color: #92400E; }
    .badge.suggestion { background: #E0E7FF; color: #3730A3; }
    details.finding-card {
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      margin-bottom: 0.5rem;
      background: #FFFFFF;
      overflow: hidden;
    }
    summary.finding-summary {
      padding: 1rem;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.95rem;
      user-select: none;
      background: #FFFFFF;
    }
    summary.finding-summary:hover { background: #F8FAFC; }
    .finding-summary-left { display: flex; align-items: center; gap: 0.75rem; }
    .finding-checker { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .finding-title-text { font-weight: 600; }
    .finding-route { font-size: 0.8rem; color: var(--text-muted); font-family: monospace; }
    .finding-details {
      padding: 1rem;
      background: #F8FAFC;
      border-top: 1px solid #E2E8F0;
      font-size: 0.9rem;
    }
    .finding-row { margin-bottom: 0.5rem; }
    .finding-label { font-weight: 600; color: #334155; margin-right: 0.5rem; }
    .resolve-text { color: #059669; font-weight: 500; }
    .finding-steps { margin-top: 0.75rem; }
    .finding-steps ol { margin-left: 1.5rem; margin-top: 0.25rem; }
    .footer-note {
      text-align: center;
      color: #94A3B8;
      font-size: 0.8rem;
      margin-top: 2rem;
    }
    /* Printed or saved as PDF: plain paper, no dotted board, nothing cut across pages. */
    @media print {
      body { background: #FFFFFF; background-image: none; padding: 0; }
      .header-banner, section, .card { box-shadow: none !important; break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="container">
    <header class="header-banner">
      <div class="header-left">
        <h1>Release check-up</h1>
        <p>Site: <strong>${escapeHtml(report.targetUrl)}</strong> | Checked on: ${escapeHtml(new Date(report.timestamp).toLocaleString())}</p>
        <p style="margin-top: 0.25rem; font-size: 0.85rem;">Run ID: <code>${escapeHtml(report.runId)}</code> | Problems found: ${verdict.total}</p>
      </div>
      <div class="overall-badge">
        <div class="overall-grade">${escapeHtml(verdict.stamp)}</div>
        <div class="overall-label">${escapeHtml(verdict.reason)}</div>
      </div>
    </header>

    <div class="aspects-grid">
      ${aspectCardsHtml}
    </div>

    ${historyBannerHtml}
    ${marketingHtml}
    ${recommendationsHtml}

    <section class="section card">
      <h2 class="section-title">Every finding behind the ${verdict.total} ${verdict.total === 1 ? 'problem' : 'problems'} (${report.findings.length})</h2>
      <p class="section-desc">Click any finding to inspect expected vs actual behavior, steps to reproduce, and recommended fix.</p>
      <div class="findings-list">
        ${findingsHtml || '<p style="color: #059669; font-weight: 500;">No defects identified! All checked criteria passed.</p>'}
      </div>
    </section>

    <div class="footer-note">
      Made by Release check-up &bull; One file that works offline
    </div>
  </main>
</body>
</html>`;

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(targetFile, fullHtml, 'utf8');

  return targetFile;
}

function escapeHtml(text?: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
