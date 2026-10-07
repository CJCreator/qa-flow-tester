import { promises as fs } from 'fs';
import path from 'path';
import type { Finding, SuppressionRule, RunDelta, ReleaseReport } from '@qa/types';

export class SuppressionsManager {
  private suppressionsFilePath: string;
  private previousFindingsFilePath: string;

  constructor(reportDir: string) {
    this.suppressionsFilePath = path.join(reportDir, 'suppressions.json');
    this.previousFindingsFilePath = path.join(reportDir, 'findings.json');
  }

  async loadSuppressions(): Promise<SuppressionRule[]> {
    try {
      const data = await fs.readFile(this.suppressionsFilePath, 'utf8');
      return JSON.parse(data) as SuppressionRule[];
    } catch {
      return [];
    }
  }

  async saveSuppression(rule: SuppressionRule): Promise<void> {
    const list = await this.loadSuppressions();
    const existingIndex = list.findIndex(
      (r) => r.findingTitle === rule.findingTitle && r.urlPath === rule.urlPath && r.host === rule.host
    );
    if (existingIndex >= 0) {
      list[existingIndex] = rule;
    } else {
      list.push(rule);
    }
    await fs.mkdir(path.dirname(this.suppressionsFilePath), { recursive: true });
    await fs.writeFile(this.suppressionsFilePath, JSON.stringify(list, null, 2), 'utf8');
  }

  /** Forgets the rules for these titles on a site: the problems count again from the next check-up. */
  async removeSuppressions(titles: string[], host?: string): Promise<void> {
    const list = await this.loadSuppressions();
    const kept = list.filter((r) => !(titles.includes(r.findingTitle) && r.host === host));
    if (kept.length === list.length) return;
    await fs.mkdir(path.dirname(this.suppressionsFilePath), { recursive: true });
    await fs.writeFile(this.suppressionsFilePath, JSON.stringify(kept, null, 2), 'utf8');
  }

  /** Marks the findings a rule covers. `host`: only that site's rules (and rules for every site) apply. */
  async applySuppressions(
    findings: Finding[],
    host?: string
  ): Promise<{
    activeFindings: Finding[];
    suppressedFindings: Finding[];
  }> {
    const rules = await this.loadSuppressions();
    const activeFindings: Finding[] = [];
    const suppressedFindings: Finding[] = [];

    for (const finding of findings) {
      const matchedRule = rules.find((r) => {
        if (r.host && host && r.host !== host) return false;
        const titleMatch = r.findingTitle === finding.title;
        const urlMatch = !r.urlPath || r.urlPath === finding.where.urlPath;
        const checkerMatch = !r.checker || r.checker === finding.checker;
        return titleMatch && urlMatch && checkerMatch;
      });

      if (matchedRule) {
        finding.triageStatus = matchedRule.triageStatus;
        finding.triageReason = matchedRule.reason;
        suppressedFindings.push(finding);
      } else {
        if (!finding.triageStatus) {
          finding.triageStatus = 'Pending';
        }
        activeFindings.push(finding);
      }
    }

    return { activeFindings, suppressedFindings };
  }

  async computeDelta(currentFindings: Finding[]): Promise<RunDelta> {
    let previousFindings: Finding[] = [];
    try {
      const data = await fs.readFile(this.previousFindingsFilePath, 'utf8');
      const prevReport = JSON.parse(data) as ReleaseReport;
      previousFindings = prevReport.findings || [];
    } catch {
      // First run, no previous findings
    }

    const prevTitles = new Set(previousFindings.map((f) => `${f.checker}:${f.title}:${f.where.urlPath}`));
    const currTitles = new Set(currentFindings.map((f) => `${f.checker}:${f.title}:${f.where.urlPath}`));

    let newCount = 0;
    let openCount = 0;
    let suppressedCount = 0;

    for (const f of currentFindings) {
      const key = `${f.checker}:${f.title}:${f.where.urlPath}`;
      if (f.triageStatus === 'Intended' || f.triageStatus === 'False Positive') {
        suppressedCount++;
      } else if (prevTitles.has(key)) {
        openCount++;
      } else {
        newCount++;
      }
    }

    let fixedCount = 0;
    for (const prev of previousFindings) {
      const key = `${prev.checker}:${prev.title}:${prev.where.urlPath}`;
      if (!currTitles.has(key)) {
        fixedCount++;
      }
    }

    return {
      newFindings: newCount,
      fixedFindings: fixedCount,
      openFindings: openCount,
      suppressedFindings: suppressedCount,
    };
  }
}
