import { ISSUE_TYPES } from '@qa/types';
import { sanitizeInline } from './findings-contract.js';
import { DEFAULT_IMAGE_BUDGET_BYTES, escapeHtml, imageSrc } from './html-report.js';
import { documentedItemsLine, type Issue, type IssuesModel } from './issues-document.js';
import { describeSource } from './source-wording.js';

const CSS = `
  body { font-family: system-ui, sans-serif; color: #0F172A; max-width: 56rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1, h2, h3 { line-height: 1.25; }
  .issue { border: 1px solid #CBD5E1; border-radius: 6px; padding: 0.75rem 1rem; margin: 0.75rem 0; break-inside: avoid; }
  .sev { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }
  table { border-collapse: collapse; margin: 0.5rem 0; }
  th, td { border: 1px solid #CBD5E1; padding: 0.25rem 0.6rem; text-align: left; }
  img { max-width: 100%; height: auto; border: 1px solid #CBD5E1; }
  .note { color: #475569; font-size: 0.9rem; }
  @media print { body { margin: 0; max-width: none; } .issue { border-color: #000; } }`;

const t = (s: string, max = 300) => escapeHtml(sanitizeInline(s, max));

async function renderIssue(i: Issue, reportDir: string, budget: { remaining: number }): Promise<string> {
  const parts: string[] = [];
  parts.push(`<div class="issue">`);
  parts.push(`<h4>${t(i.title, 200)}</h4>`);
  parts.push(`<p><span class="sev">${escapeHtml(i.severity)}</span> &middot; <code>${t(i.page)}</code></p>`);
  if (i.docSource) parts.push(`<p>Source: ${t(describeSource(i.docSource), 200)}</p>`);
  if (i.steps.length > 0) {
    parts.push(`<p>Steps:</p><ol>${i.steps.map((s) => `<li>${t(s)}</li>`).join('')}</ol>`);
  }
  for (const rel of i.evidence) {
    const src = await imageSrc(rel, reportDir, budget);
    // Only an embedded image is shown; over budget or outside the folder is a note, never a link.
    if (src && src.startsWith('data:image/png;base64,')) {
      parts.push(`<p><img src="${src}" alt="Screenshot for ${t(i.title, 100)}"></p>`);
    } else {
      parts.push(`<p class="note">Screenshot not embedded: ${t(rel, 200)}</p>`);
    }
  }
  parts.push(`<p>Fix: ${t(i.fix, 400)}</p>`);
  parts.push(`</div>`);
  return parts.join('\n');
}

/** One self-contained file: inline CSS, images as data: URIs within the budget, no script, no outside links. */
export async function renderIssuesHtml(
  model: IssuesModel,
  reportDir: string,
  budgetBytes: number = DEFAULT_IMAGE_BUDGET_BYTES
): Promise<string> {
  const budget = { remaining: budgetBytes };
  const body: string[] = [`<h1>Issues</h1>`, `<h2>Roles not tested and why</h2>`];
  if (model.rolesNotTested.length === 0) body.push(`<p>All roles were tested.</p>`);
  else body.push(`<ul>${model.rolesNotTested.map((r) => `<li><code>${t(r.role)}</code>: ${t(r.text)}</li>`).join('')}</ul>`);
  const documented = documentedItemsLine(model.documentedItems);
  if (documented) body.push(`<p>${escapeHtml(documented)}</p>`);

  for (const { role, byType } of model.roles) {
    body.push(`<h2>Role: ${t(role)}</h2>`);
    for (const type of ISSUE_TYPES) {
      const group = byType[type];
      if (!group) continue;
      body.push(`<h3>${escapeHtml(type)}</h3>`);
      if (type === 'Access') {
        for (const table of model.accessTables) {
          body.push(`<p>Who can reach <code>${t(table.page)}</code>:</p>`);
          body.push(
            `<table><tr><th>Role</th><th>Result</th></tr>${table.rows
              .map((r) => `<tr><td>${t(r.role, 200)}</td><td>${escapeHtml(r.result)}</td></tr>`)
              .join('')}</table>`
          );
        }
      }
      for (const i of group) body.push(await renderIssue(i, reportDir, budget));
    }
  }
  if (model.roles.length === 0) body.push(`<p>No issues were found.</p>`);

  const judgementRoles = Object.keys(model.judgement).sort((a, b) => a.localeCompare(b));
  if (judgementRoles.length > 0) {
    body.push(`<h2>Needs your judgement</h2>`, `<p>These are not counted in the release verdict until you accept them.</p>`);
    for (const role of judgementRoles) {
      body.push(`<h3>Role: ${t(role)}</h3>`);
      for (const i of model.judgement[role]) body.push(await renderIssue(i, reportDir, budget));
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Issues</title>
<style>${CSS}</style>
</head>
<body>
${body.join('\n')}
</body>
</html>
`;
}
