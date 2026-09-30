import { promises as fs } from 'fs';
import path from 'path';
import type { Finding, ReleaseReport, RunCoverage } from '@qa/types';
import { releaseVerdict } from '@qa/types';

/**
 * A copy of the report whose file paths inside the report folder are relative to it
 * (evidence/TC-1-1440px/step-1.png rather than C:\Users\…), so the report still works when the
 * folder is shared, moved or opened on another machine.
 */
export function withPortablePaths<T>(value: T, reportDir: string): T {
  const root = path.resolve(reportDir);
  const portable = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (!path.isAbsolute(v)) return v;
      const rel = path.relative(root, v);
      return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : v;
    }
    if (Array.isArray(v)) return v.map(portable);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, portable(x)]));
    return v;
  };
  return portable(value) as T;
}

export class ReportGenerator {
  private outputDir: string;

  constructor(outputDir: string = path.join(process.cwd(), '.qa-report')) {
    this.outputDir = outputDir;
  }

  async generate(fullReport: ReleaseReport): Promise<{ jsonPath: string; mdPath: string }> {
    await fs.mkdir(this.outputDir, { recursive: true });
    const report = withPortablePaths(fullReport, this.outputDir);

    const jsonPath = path.join(this.outputDir, 'findings.json');
    const mdPath = path.join(this.outputDir, 'report.md');

    // 1. Write findings.json
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

    // 2. Generate and write report.md
    const mdContent = this.renderMarkdown(report);
    await fs.writeFile(mdPath, mdContent, 'utf8');

    return { jsonPath, mdPath };
  }

  private renderMarkdown(report: ReleaseReport): string {
    const { coverage, findings, targetUrl, productId, timestamp } = report;

    // Group findings by severity
    const blockers = findings.filter((f) => f.severity === 'Blocker');
    const majors = findings.filter((f) => f.severity === 'Major');
    const minors = findings.filter((f) => f.severity === 'Minor');
    const suggestions = findings.filter((f) => f.severity === 'Suggestion' && !f.needsConfirmation);
    const unconfirmed = findings.filter((f) => f.needsConfirmation);

    const lines: string[] = [];

    lines.push(`# Pre-Release Readiness Report`);
    lines.push(`**Product:** \`${productId}\` | **Target:** \`${targetUrl}\` | **Date:** ${timestamp}`);
    if (report.aiModels?.text) {
      lines.push(
        `**AI model:** \`${report.aiModels.text}\`${report.aiModels.vision ? ` (screenshots: \`${report.aiModels.vision}\`)` : ''}`
      );
    }
    lines.push(``);

    // Summary banner: the same verdict as the screen and report.html.
    const verdict = releaseVerdict(findings);
    lines.push(verdict.ready ? `> [!TIP]` : verdict.counts.Blocker > 0 ? `> [!CAUTION]` : `> [!WARNING]`);
    lines.push(
      `> **${verdict.stamp}**: ${verdict.reason}${
        verdict.ready ? '' : ` (${verdict.counts.Blocker} blocking, ${verdict.counts.Major} major)`
      }`
    );
    lines.push(``);
    if (report.testedWithApprovedPlan) {
      lines.push(`> [!NOTE]`);
      lines.push(`> Nothing on the site had changed, so this run used the plan approved on ${report.testedWithApprovedPlan.slice(0, 10)} without a new review.`);
      lines.push(``);
    }

    if (report.scanMode === 'read-only') {
      lines.push(`> [!NOTE]`);
      lines.push(
        `> **Read-only run.** This isn't a test copy of the site, so nothing that could change data was sent. Tests that need to send a form are listed as skipped ("needs a test copy").`
      );
      lines.push(``);
    }

    if (report.scanMode === 'safe-public') {
      lines.push(`> [!NOTE]`);
      lines.push(
        `> **Read-only website scan.** The site was only looked at: no sign-in, no form submissions and no data changes. Flows behind a login or a form were not tested, so this is not full product coverage.`
      );
      lines.push(``);
    }

    if (report.notes && report.notes.length > 0) {
      lines.push(`> [!NOTE]`);
      lines.push(`> **What this run couldn't cover**`);
      for (const note of report.notes) lines.push(`> - ${note}`);
      lines.push(``);
    }

    if (report.usedFallbackDiscovery) {
      lines.push(`> [!WARNING]`);
      lines.push(
        `> **AI discovery did not run for this release.** Test cases below came from the generic template fallback, not real AI-driven flow analysis. This verdict may not reflect the app's actual behavior — check your AI provider/API key and re-run.`
      );
      lines.push(``);
    }

    // Delta summary if available
    if (report.delta) {
      lines.push(`### 📈 Release Delta & Trend`);
      lines.push(`- **New Findings:** ${report.delta.newFindings}`);
      lines.push(`- **Fixed Findings:** ${report.delta.fixedFindings}`);
      lines.push(`- **Open Findings:** ${report.delta.openFindings}`);
      lines.push(`- **Suppressed:** ${report.delta.suppressedFindings}`);
      lines.push(``);
    }

    // Coverage statistics
    lines.push(`## 📊 Test Coverage & Execution Summary`);
    lines.push(``);
    lines.push(`| Total Test Points | Passed | Failed | Blocked | Skipped | Could not verify | Completion Rate |`);
    lines.push(`| :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);
    lines.push(
      `| **${coverage.totalTestPoints}** | ✅ ${coverage.passed} | ❌ ${coverage.failed} | ⛔ ${coverage.blocked} | ⏭️ ${coverage.skipped} | ❓ ${coverage.couldNotVerify} | **${coverage.completionRate.toFixed(1)}%** |`
    );
    lines.push(``);

    // Requirement Traceability Matrix
    if (report.traceability && report.traceability.length > 0) {
      lines.push(`## 📋 Requirement Traceability Matrix`);
      lines.push(``);
      lines.push(`| Requirement ID | Flow | Test Case | Status | Details | Evidence |`);
      lines.push(`| :--- | :--- | :--- | :---: | :--- | :--- |`);
      for (const entry of report.traceability) {
        const icon =
          entry.status === 'Passed'
            ? '✅ Passed'
            : entry.status === 'Failed'
            ? '❌ Failed'
            : entry.status === 'Blocked'
            ? '⛔ Blocked'
            : entry.status === 'Skipped'
            ? '⏭️ Skipped'
            : '❓ Could not verify';
        const evidenceLink = entry.evidencePath
          ? `[Evidence](${entry.evidencePath.replace(/\\/g, '/')})`
          : '—';
        lines.push(
          `| \`${entry.requirementId}\` | \`${entry.flowId}\` | \`${entry.testCaseId}\` | ${icon} | ${entry.description || entry.name || '—'} | ${evidenceLink} |`
        );
      }
      lines.push(``);
    }

    // Findings section
    const activeFindings = findings.filter(
      (f) => f.triageStatus !== 'Intended' && f.triageStatus !== 'False Positive'
    );
    const suppressedFindings = findings.filter(
      (f) => f.triageStatus === 'Intended' || f.triageStatus === 'False Positive'
    );

    lines.push(`## 🚨 Findings Overview`);
    lines.push(
      `Active Findings: **${activeFindings.length}** (🔴 ${blockers.length} Blockers, 🟠 ${majors.length} Majors, 🟡 ${minors.length} Minors, 💡 ${suggestions.length} Suggestions, ❓ ${unconfirmed.length} Could not verify)`
    );
    if (suppressedFindings.length > 0) {
      lines.push(`*(${suppressedFindings.length} findings suppressed via triage)*`);
    }
    lines.push(``);

    const renderFindingGroup = (title: string, group: Finding[]) => {
      if (group.length === 0) return;
      lines.push(`### ${title}`);
      lines.push(``);
      for (const f of group) {
        lines.push(`#### [${f.id}] ${f.title}`);
        lines.push(`- **Checker:** \`${f.checker}\` | **Role:** \`${f.where.role}\` | **Breakpoint:** \`${f.where.breakpoint}\``);
        lines.push(`- **Location:** \`${f.where.urlPath}\`${f.where.dataTestId ? ` (\`data-testid="${f.where.dataTestId}"\`)` : ''}`);
        if (f.sourceLocation) {
          lines.push(`- **Source Code:** \`${f.sourceLocation.file}:${f.sourceLocation.line || 1}\``);
          if (f.sourceLocation.matchSnippet) {
            lines.push(`  \`\`\`tsx\n  ${f.sourceLocation.matchSnippet}\n  \`\`\``);
          }
        }
        if (f.occurrences && f.seenAt) {
          const pages = f.seenAt.pages.length > 1 ? `${f.seenAt.pages.length} pages; ` : '';
          lines.push(
            `- **Seen:** ${f.occurrences} times (${pages}widths ${f.seenAt.breakpoints.join(', ')}; roles ${f.seenAt.roles.join(', ')})`
          );
        }
        lines.push(`- **Expected:** ${f.expectedVsActual.expected}`);
        lines.push(`- **Actual:** ${f.expectedVsActual.actual}`);
        lines.push(`- **Recommended Resolution:** ${f.resolution}`);
        lines.push(`- **Verify Command:** \`${f.verifyCommand}\``);
        if (f.reproScriptPath) {
          lines.push(`- **Repro Script:** \`${f.reproScriptPath}\``);
        }
        if (f.evidence.videoPath) {
          lines.push(`- **Video:** \`${f.evidence.videoPath.replace(/\\/g, '/')}\``);
        }
        lines.push(``);
      }
    };

    renderFindingGroup('🔴 Blocker Findings', blockers);
    renderFindingGroup('🟠 Major Findings', majors);
    renderFindingGroup('🟡 Minor Findings', minors);
    renderFindingGroup('💡 Suggestions', suggestions);
    renderFindingGroup('❓ Could not verify (AI guesses that need your confirmation)', unconfirmed);

    // Suppressed findings section
    if (suppressedFindings.length > 0) {
      lines.push(``);
      lines.push(`<details>`);
      lines.push(`<summary><b>📁 Suppressed Findings (${suppressedFindings.length})</b></summary>`);
      lines.push(``);
      for (const sf of suppressedFindings) {
        lines.push(`- **[${sf.id}] ${sf.title}** (\`${sf.triageStatus}\`): ${sf.where.urlPath}`);
      }
      lines.push(``);
      lines.push(`</details>`);
      lines.push(``);
    }

    return lines.join('\n');
  }
}
