import { promises as fs } from 'fs';
import path from 'path';
import type { ReleaseReport, AspectType, FindingSeverity, RankedRecommendation } from '@qa/types';
import { groupIntoProblems, releaseVerdict, ASPECTS } from '@qa/types';
import { notChecked } from './not-checked.js';

export interface HtmlReportOptions {
  outputDir?: string;
  maxSizeBytes?: number;
}

const GRADE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: '#E2F3E9', text: '#0B7547', border: '#0B7547' },
  B: { bg: '#E2F3E9', text: '#0B7547', border: '#0B7547' },
  C: { bg: '#FBEFD9', text: '#8A5000', border: '#8A5000' },
  D: { bg: '#FBEFD9', text: '#8A5000', border: '#8A5000' },
  F: { bg: '#FCE8E6', text: '#B42318', border: '#B42318' },
};

const SEVERITY_COLORS: Record<FindingSeverity, { bg: string; text: string }> = {
  Blocker: { bg: '#FCE8E6', text: '#B42318' },
  Major: { bg: '#FBEFD9', text: '#8A5000' },
  Minor: { bg: '#FBEFD9', text: '#8A5000' },
  Suggestion: { bg: '#ECEFEC', text: '#1D3FD0' },
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
  const verdict = releaseVerdict(report.findings, undefined, report.grades, report.coverage);
  const gradeStyle = verdict.ready ? GRADE_COLORS.A : GRADE_COLORS.F;
  /** Problems among an area's findings, counted as the verdict counts them. */
  const problemsIn = (ids: string[]) =>
    groupIntoProblems(report.findings.filter((f) => ids.includes(f.id))).filter((p) => !p.toConfirm).length;

  const aspects = ASPECTS;

  // Aspect Cards HTML
  const aspectCardsHtml = aspects
    .map((aspect) => {
      const data = report.grades?.aspects[aspect];
      if (!data || data.checked === false || data.grade === null) {
        return `
        <div class="aspect-card" style="border-top: 4px solid #7A8580;">
          <div class="aspect-header">
            <span class="aspect-title">${escapeHtml(aspect)}</span>
            <span class="aspect-grade" style="background: #ECEFEC; color: #4C5853; border: 1px solid #7A8580;">Not checked</span>
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

  // What this check-up did not look at (ADR 0018). Always present, so a clean run says so.
  const nc = notChecked(report);
  const notCheckedHtml = `
      <section class="section card not-checked-section">
        <h2 class="section-title">What this did not check</h2>
        ${
          nc.empty
            ? '<p>Everything in the plan ran, and every area was checked.</p>'
            : `${nc.areas.length > 0 ? `<p>Not checked at all: ${nc.areas.map(escapeHtml).join(', ')}.</p>` : ''}
        ${
          nc.tests.length > 0
            ? `<ul>${nc.tests.map((t) => `<li><strong>${escapeHtml(t.name)}</strong>: ${escapeHtml(t.reason)}</li>`).join('')}</ul>`
            : ''
        }`
        }
      </section>`;

  // Living Spec & Documented Requirements Coverage (FR-2.6)
  let documentedItemsHtml = '';
  if (report.documentedItems) {
    const d = report.documentedItems;
    documentedItemsHtml = `
      <section class="section card documented-items-section">
        <h2 class="section-title">Documented items</h2>
        <div class="doc-coverage-banner" style="display:flex; flex-wrap:wrap; gap:0.75rem; justify-content:space-between; align-items:center; background:#F4F6F4; border:1px solid #D8DDDA; border-radius:10px; padding:1rem 1.5rem; margin-bottom:1rem;">
          <div>
            <div style="font-size:1.15rem; font-weight:700; color:#121A17;">${d.reached} of ${d.total} documented items reached</div>
            <div style="font-size:0.875rem; color:#4C5853; margin-top:0.25rem;">Items from your Product Context, matched against the pages and controls found in the App.</div>
          </div>
          <div style="font-size:1.5rem; font-weight:800; color:${d.total > 0 && d.reached === d.total ? '#0B7547' : '#8A5000'};">
            ${d.total > 0 ? Math.round((d.reached / d.total) * 100) : 100}%
          </div>
        </div>
        ${
          d.notFound && d.notFound.length > 0
            ? `
          <h3 style="margin: 1rem 0 0.5rem; font-size:1rem; font-weight:600;">Not found in app (${d.notFound.length})</h3>
          <div class="gap-list" style="display:flex; flex-direction:column; gap:0.75rem;">
            ${d.notFound
              .map(
                (item) => `
              <div style="border: 1px solid #D8DDDA; border-left: 4px solid #B42318; border-radius: 10px; padding: 0.75rem 1rem; background: #FFFFFF;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <strong style="color:#121A17;">${escapeHtml(item.docSource?.section || item.docSource?.document || 'Documented item')}</strong>
                  <span style="font-size:0.875rem; font-weight:700; padding:2px 8px; border-radius:6px; background:#FCE8E6; color:#B42318; font-family:monospace;">${escapeHtml(item.code || 'SPEC_GAP_NO_PAGE')}</span>
                </div>
                <div style="font-size:0.875rem; color:#4C5853; margin-top:0.25rem;">${escapeHtml(item.reason)}</div>
                <div style="margin-top:0.5rem; font-size:0.875rem; color:#4C5853; font-style:italic;">
                  Did this feature change or move? Record an override in .qa-data/spec-overrides.json.
                </div>
              </div>`
              )
              .join('')}
          </div>`
            : '<p style="color:#0B7547; font-size:0.875rem; font-weight:500;">✓ Every documented item was reached in the App.</p>'
        }
      </section>
    `;
  }

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

  // Pages slower than the last check-up. A note, not a finding: grades ignore it.
  const slowerHtml =
    report.slowerThanLastTime && report.slowerThanLastTime.length > 0
      ? `
      <section class="section card slower-than-last-time">
        <h2>Slower than the last check-up</h2>
        <ul>${report.slowerThanLastTime
          .map(
            (s) =>
              `<li><code>${escapeHtml(s.urlPath)}</code> (${escapeHtml(s.role)}, ${escapeHtml(s.breakpoint)}): ${escapeHtml(s.summary)}</li>`
          )
          .join('')}</ul>
      </section>
    `
      : '';

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
          <h3 class="group-heading"><span aria-hidden="true">⚡</span> Quick Wins (High Return, Low Effort)</h3>
          <div class="rec-list">${renderRecList(quickWins)}</div>
        `
            : ''
        }

        ${
          biggerChanges.length > 0
            ? `
          <h3 class="group-heading" style="margin-top: 1.5rem;"><span aria-hidden="true">🏗️</span> Bigger Changes (Architectural / High Effort)</h3>
          <div class="rec-list">${renderRecList(biggerChanges)}</div>
        `
            : ''
        }
      </section>
    `;
  }

  // Old / new / difference images for Perceptual Visual Diff findings (async, so before the sync map).
  const imageBudget = { remaining: options?.maxSizeBytes ?? DEFAULT_IMAGE_BUDGET_BYTES };
  const visualBlocks: string[] = [];
  for (const f of report.findings) {
    visualBlocks.push(await renderVisualCompare(f, outputDir, imageBudget));
  }
  const hasVisual = visualBlocks.some((b) => b !== '');

  // Findings List HTML
  const findingsHtml = report.findings
    .map((f, idx) => {
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
            ${visualBlocks[idx]}
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
    /* Certificate: quiet paper, green-grey ink, cobalt for links. Flat cards with a hairline, no shadows. */
    :root {
      --paper: #F4F6F4;
      --canvas: #ECEFEC;
      --surface: #FFFFFF;
      --ink: #121A17;
      --ink-soft: #4C5853;
      --rule: #D8DDDA;
      --edge: #7A8580;
      --stamp: #1D3FD0;
      --pass: #0B7547;
      --pass-tint: #E2F3E9;
      --warn: #8A5000;
      --warn-tint: #FBEFD9;
      --fail: #B42318;
      --fail-tint: #FCE8E6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 1rem;
      line-height: 1.5;
      background: var(--paper);
      color: var(--ink);
      padding: 2rem 1rem;
      overflow-wrap: anywhere;
    }
    a { color: var(--stamp); text-decoration: underline; text-underline-offset: 2px; }
    a:focus-visible, summary:focus-visible { outline: 3px solid var(--stamp); outline-offset: 2px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; overflow-wrap: anywhere; }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    .header-banner {
      background: var(--surface);
      border: 1px solid var(--rule);
      border-left: 8px solid ${gradeStyle.border};
      border-radius: 10px;
      padding: 1.5rem;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 1rem 1.5rem;
      margin-bottom: 1.5rem;
    }
    .header-left { flex: 1 1 18rem; min-width: 0; }
    .header-left h1 {
      font-size: 1.75rem;
      line-height: 1.2;
      font-weight: 700;
      color: var(--ink);
    }
    .header-left p {
      color: var(--ink-soft);
      margin-top: 0.25rem;
      font-size: 0.95rem;
    }
    .header-left p[style] { font-size: 0.875rem !important; }
    .overall-badge {
      flex: 0 1 16rem;
      min-width: 0;
      max-width: 100%;
      text-align: left;
      padding: 1rem 1.25rem;
      border-radius: 10px;
      background: ${gradeStyle.bg};
      border: 2px solid ${gradeStyle.border};
    }
    .overall-grade {
      font-size: 1.75rem;
      font-weight: 800;
      color: ${gradeStyle.text};
      line-height: 1.1;
    }
    .overall-label {
      font-size: 0.9375rem;
      font-weight: 600;
      color: ${gradeStyle.text};
      margin-top: 0.4rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--rule);
      border-radius: 10px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .section-title {
      font-size: 1.25rem;
      line-height: 1.3;
      font-weight: 700;
      color: var(--ink);
    }
    .section-desc {
      color: var(--ink-soft);
      font-size: 0.9375rem;
      margin-top: 0.25rem;
      margin-bottom: 1.25rem;
    }
    .aspects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .aspect-card {
      background: var(--surface);
      border: 1px solid var(--rule);
      border-radius: 10px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 0;
    }
    .aspect-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .aspect-title {
      font-weight: 600;
      font-size: 1rem;
    }
    .aspect-grade {
      font-weight: 700;
      font-size: 0.875rem;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }
    .aspect-score-bar {
      height: 6px;
      background: var(--canvas);
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
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.25rem 0.75rem;
      font-size: 0.875rem;
      color: var(--ink-soft);
    }
    .history-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 9rem), 1fr));
      gap: 1rem;
      text-align: center;
      margin-top: 1rem;
    }
    .history-stat {
      padding: 1rem;
      border-radius: 10px;
      background: var(--paper);
      border: 1px solid var(--rule);
    }
    .history-stat.fixed .history-num { color: var(--pass); }
    .history-stat.new .history-num { color: var(--fail); }
    .history-stat.open .history-num { color: var(--warn); }
    .history-num { font-size: 2rem; font-weight: 700; display: block; line-height: 1.2; }
    .history-label { font-size: 0.9375rem; color: var(--ink-soft); font-weight: 500; }
    .group-heading {
      font-size: 1rem;
      font-weight: 700;
      color: var(--ink);
      margin-bottom: 0.75rem;
    }
    .rec-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .rec-item {
      padding: 1rem;
      border-radius: 10px;
      background: var(--paper);
      border: 1px solid var(--rule);
      min-width: 0;
    }
    .rec-top {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
    }
    .rec-aspect { font-weight: 600; color: var(--ink-soft); }
    .rec-title { font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem; }
    .rec-summary { font-size: 0.9375rem; color: var(--ink-soft); margin-bottom: 0.5rem; }
    .rec-fix { font-size: 0.9375rem; background: var(--surface); border: 1px solid var(--rule); border-left: 3px solid var(--stamp); padding: 0.5rem 0.75rem; border-radius: 6px; margin-bottom: 0.5rem; }
    .rec-meta { font-size: 0.875rem; color: var(--ink-soft); }
    .rec-meta code { color: var(--ink); background: var(--canvas); padding: 0.1rem 0.3rem; border-radius: 6px; }
    .badge {
      font-size: 0.875rem;
      font-weight: 700;
      padding: 0.15rem 0.5rem;
      border-radius: 6px;
      background: var(--canvas);
      color: var(--ink);
    }
    .badge.blocker { background: var(--fail-tint); color: var(--fail); }
    .badge.major { background: var(--warn-tint); color: var(--warn); }
    .badge.minor { background: var(--warn-tint); color: var(--warn); }
    .badge.suggestion { background: var(--canvas); color: var(--stamp); }
    details.finding-card {
      border: 1px solid var(--rule);
      border-radius: 10px;
      margin-bottom: 0.5rem;
      background: var(--surface);
      overflow: hidden;
    }
    summary.finding-summary {
      padding: 1rem;
      cursor: pointer;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem 1rem;
      font-size: 0.9375rem;
      user-select: none;
      background: var(--surface);
    }
    summary.finding-summary:hover { background: var(--paper); }
    .finding-summary-left { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; min-width: 0; }
    .finding-checker { font-size: 0.875rem; color: var(--ink-soft); font-weight: 600; }
    .finding-title-text { font-weight: 600; }
    .finding-route { font-size: 0.875rem; color: var(--ink-soft); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .finding-details {
      padding: 1rem;
      background: var(--paper);
      border-top: 1px solid var(--rule);
      font-size: 0.9375rem;
    }
    .finding-row { margin-bottom: 0.5rem; }
    .finding-label { font-weight: 600; color: var(--ink); margin-right: 0.5rem; }
    .resolve-text { color: var(--pass); font-weight: 500; }
    .finding-steps { margin-top: 0.75rem; }
    .finding-steps ol { margin-left: 1.5rem; margin-top: 0.25rem; }
    .footer-note {
      text-align: center;
      color: var(--ink-soft);
      font-size: 0.875rem;
      margin-top: 2rem;
    }
    @media (max-width: 480px) {
      body { padding: 1rem 0.75rem; }
      .header-banner, .card { padding: 1rem; }
      .header-banner { border-left-width: 6px; }
      .header-left h1 { font-size: 1.5rem; }
      .overall-badge { flex-basis: 100%; }
    }
    ${hasVisual ? VISUAL_COMPARE_CSS : ''}
    /* Printed or saved as PDF: plain paper, nothing cut across pages. */
    @media print {
      body { background: #FFFFFF; padding: 0; }
      .header-banner, section, .card { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <main class="container">
    <header class="header-banner">
      <div class="header-left">
        <h1>Release check-up</h1>
        <p>Site: <strong>${escapeHtml(report.targetUrl)}</strong> | Checked on: ${escapeHtml(new Date(report.timestamp).toLocaleString())}</p>
        <p style="margin-top: 0.25rem; font-size: 0.875rem;">Run ID: <code>${escapeHtml(report.runId)}</code> | Problems found: ${verdict.total}</p>
      </div>
      <div class="overall-badge">
        <div class="overall-grade">${escapeHtml(verdict.stamp)}</div>
        <div class="overall-label">${escapeHtml(verdict.reason)}</div>
      </div>
    </header>

    <div class="aspects-grid">
      ${aspectCardsHtml}
    </div>

    ${notCheckedHtml}
    ${documentedItemsHtml}
    ${historyBannerHtml}
    ${slowerHtml}
    ${marketingHtml}
    ${recommendationsHtml}

    <section class="section card">
      <h2 class="section-title">Every finding behind the ${verdict.total} ${verdict.total === 1 ? 'problem' : 'problems'} (${report.findings.length})</h2>
      <p class="section-desc">Click any finding to inspect expected vs actual behavior, steps to reproduce, and recommended fix.</p>
      <div class="findings-list">
        ${findingsHtml || '<p style="color: #0B7547; font-weight: 500;">No defects identified! All checked criteria passed.</p>'}
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

/** Total bytes of images embedded per report (base64 inflates by about a third); beyond it, relative links. */
export const DEFAULT_IMAGE_BUDGET_BYTES = 6 * 1024 * 1024;

const VISUAL_COMPARE_CSS = `
    .visual-compare { margin-top: 0.75rem; }
    .visual-compare h3 { margin: 0 0 0.5rem; font-size: 0.9rem; }
    .visual-compare .visual-row { display: flex; flex-wrap: wrap; gap: 0.75rem; }
    .visual-compare figure { margin: 0; flex: 1 1 220px; max-width: 100%; }
    .visual-compare img { max-width: 100%; height: auto; border: 1px solid #D8DDDA; }
    .visual-compare figcaption { font-size: 0.875rem; margin-top: 0.25rem; }
    .visual-compare .visual-note { font-size: 0.875rem; }`;

/**
 * Source for one evidence image: embedded as base64 while the budget lasts, else a relative link.
 * Only existing .png files inside the report folder qualify; anything else is not shown.
 */
export async function imageSrc(
  rel: string | undefined,
  outputDir: string,
  budget: { remaining: number }
): Promise<string | null> {
  if (!rel || !/\.png$/i.test(rel)) return null;
  const root = path.resolve(outputDir);
  const abs = path.resolve(root, rel);
  const within = path.relative(root, abs);
  if (!within || within.startsWith('..') || path.isAbsolute(within)) return null;
  try {
    const bytes = await fs.readFile(abs);
    if (bytes.length <= budget.remaining) {
      budget.remaining -= bytes.length;
      return `data:image/png;base64,${bytes.toString('base64')}`;
    }
    return within
      .split(/[\\/]/)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
  } catch {
    return null;
  }
}

async function renderVisualCompare(
  f: ReleaseReport['findings'][number],
  outputDir: string,
  budget: { remaining: number }
): Promise<string> {
  if (f.checker !== 'design-standards' || !f.evidence?.baselineScreenshotPath) return '';
  const figure = async (rel: string | undefined, caption: string) => {
    const src = await imageSrc(rel, outputDir, budget);
    return src
      ? `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`
      : `<figure><figcaption>${escapeHtml(caption)}: Image not available</figcaption></figure>`;
  };
  // Display order (old, new, difference) is also the order the image budget is spent in.
  const oldFigure = await figure(f.evidence.baselineScreenshotPath, 'Old (approved baseline)');
  const newFigure = await figure(f.evidence.currentScreenshotPath, 'New (this check-up)');
  const diffFigure = f.evidence.screenshotPath
    ? await figure(f.evidence.screenshotPath, 'Difference')
    : `<p class="visual-note">There is no difference image: the screen size changed, so the old and new images cannot be laid over each other.</p>`;
  return `
            <div class="visual-compare">
              <h3>Perceptual Visual Diff: old, new and difference</h3>
              <div class="visual-row">
                ${oldFigure}
                ${newFigure}
                ${diffFigure}
              </div>
            </div>`;
}

export function escapeHtml(text?: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
