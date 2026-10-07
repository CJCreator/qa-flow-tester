import type { NavigationCheck, PlanPage, ReviewPlan, TestCaseExpectations } from '@qa/types';

function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

const BY_FIXED_RULES = ' _(planned by fixed rules)_';

function expectationLine(expectations?: TestCaseExpectations): string | undefined {
  if (!expectations) return undefined;
  const guess = expectations.origin === 'ai-guess' ? ' (AI’s guess until confirmed)' : '';
  if (expectations.text?.contains) return `Expected: the page says “${expectations.text.contains}”${guess}`;
  if (expectations.url) return `Expected: ends on ${expectations.url.pattern}${guess}`;
  if (expectations.elementState)
    return `Expected: ${expectations.elementState.description || `${expectations.elementState.selector} shows`}${guess}`;
  if (expectations.validationError) return `Expected: an error about “${expectations.validationError.field}”${guess}`;
  if (expectations.successMessage) return `Expected: a success message${guess}`;
  if (expectations.navigatesAway) return `Expected: moves on from ${expectations.navigatesAway.fromPath}${guess}`;
  return undefined;
}

function pageSection(page: PlanPage): string[] {
  const out = [
    `### ${page.urlPath} — ${page.title || 'untitled'}${page.source === 'fallback' ? BY_FIXED_RULES : ''}${page.skipped ? ' _(switched off)_' : ''}`,
    '',
  ];
  if (page.coverage === 'sample') out.push('Sample Page for its Layout Group.  ');
  if (page.coverage === 'promoted') out.push('Tested on its own (promoted from its Layout Group).  ');
  if (page.clickPath)
    out.push(
      `Reached by: ${page.clickPath.length === 0 ? 'the start page' : ['Start', ...page.clickPath].join(' → ')}  `
    );
  if (page.unlinked) out.push('No link on the site leads here.  ');
  out.push(`Visited as: ${page.reachedBy.join(', ')}`, '');
  if (page.tests.length === 0) out.push('- Nothing to try beyond the page visit.');
  for (const test of page.tests) {
    const flags = [
      test.source === 'fallback' ? 'fixed rules' : '',
      test.needsTestCopy ? 'needs a test copy' : '',
      test.skipped ? 'switched off' : '',
    ]
      .filter(Boolean)
      .join(', ');
    out.push(`- ${test.name}${flags ? ` _(${flags})_` : ''}`);
    test.steps.forEach((s, i) => out.push(`  ${i + 1}. ${s.name}`));
    const expected = expectationLine(test.expectations);
    if (expected) out.push(`  - ${expected}`);
  }
  out.push('');
  return out;
}

function navigationLine(nav: NavigationCheck): string {
  const parts = [nav.name];
  if (nav.expectation) parts.push(`expected: ${nav.expectation}`);
  const menu = (nav.menuSteps || []).flatMap((s) => s.onlyAt || []);
  if (menu.length > 0) parts.push(`opens the menu first at ${menu.join(' and ')}`);
  if (nav.notAt?.length) parts.push(`not checked at ${nav.notAt.join(' and ')} (hidden, no menu button)`);
  if (nav.roles.some((r) => r !== 'visitor')) parts.push(`as ${nav.roles.join(', ')}`);
  return `- ${parts.join(' — ')}${nav.source === 'fallback' ? BY_FIXED_RULES : ''}${nav.skipped ? ' _(switched off)_' : ''}`;
}

/** The whole Plan as a Markdown document, for reading, sharing and signing off. */
export function planToMarkdown(plan: ReviewPlan): string {
  const pages = plan.planPages || [];
  const navigation = plan.navigation || [];
  const out: string[] = [`# Test plan: ${hostOf(plan.targetUrl)}`, ''];
  out.push(`Address: ${plan.targetUrl}  `, `Planned: ${plan.discoveredAt}  `);
  if (plan.readOnlyReason) out.push(`Read-only: ${plan.readOnlyReason}  `);
  out.push('');

  out.push('## Summary', '');
  for (const line of plan.summary?.lines || []) out.push(`- ${line.text}`);
  if (plan.roles?.length) out.push(`- Tested as: ${plan.roles.join(', ')}`);
  if (plan.budget) {
    const left = plan.budget.left !== undefined ? `; ${plan.budget.left} free requests were left today` : '';
    out.push(`- AI requests: ${plan.budget.used} used, about ${plan.budget.needed} needed${left}`);
  }
  for (const note of plan.notes || []) out.push(`- ${note}`);
  out.push('');

  out.push(`## Pages (${pages.length})`, '');
  const grouped = new Set((plan.layoutGroups || []).flatMap((g) => g.pages));
  for (const page of pages.filter((p) => !grouped.has(p.urlPath))) out.push(...pageSection(page));
  for (const group of plan.layoutGroups || []) {
    const members = pages.filter((p) => group.pages.includes(p.urlPath));
    const samples = members.filter((p) => p.coverage !== 'covered');
    out.push(`### ${group.name} (${members.length} pages)`, '');
    for (const page of samples) out.push(...pageSection(page).map((l) => l.replace(/^### /, '#### ')));
    const covered = members.filter((p) => p.coverage === 'covered');
    if (covered.length > 0) {
      out.push(`Covered by the Sample Pages above, not visited:`, '');
      for (const page of covered) out.push(`- ${page.urlPath} — ${page.title || 'untitled'}`);
      out.push('');
    }
  }

  out.push(`## Navigation (${navigation.length} checks)`, '');
  const shared = navigation.filter((n) => n.shared);
  const inPage = navigation.filter((n) => !n.shared && !n.leavesSite);
  const leaving = navigation.filter((n) => n.leavesSite && !n.shared);
  if (shared.length > 0) {
    out.push('### Shared menus (checked once for the whole site)', '');
    for (const nav of shared) out.push(navigationLine(nav));
    out.push('');
  }
  const starts = [...new Set(inPage.map((n) => n.startPage))];
  for (const start of starts) {
    out.push(`### Links on ${start}`, '');
    for (const nav of inPage.filter((n) => n.startPage === start)) out.push(navigationLine(nav));
    out.push('');
  }
  if (leaving.length > 0) {
    out.push('### Links that leave the site (checked with one request each)', '');
    for (const nav of leaving) out.push(navigationLine(nav));
    out.push('');
  }

  out.push(`## Journeys (${plan.flows.length})`, '');
  for (const flow of plan.flows) {
    const flags = [
      flow.source === 'fallback' ? 'fixed rules' : '',
      flow.needsTestCopy ? 'needs a test copy' : '',
      flow.outOfScope ? 'switched off' : '',
    ]
      .filter(Boolean)
      .join(', ');
    out.push(
      `### ${flow.name}${flow.role && flow.role !== 'visitor' ? ` (as ${flow.role})` : ''}${flags ? ` _(${flags})_` : ''}`,
      ''
    );
    if (flow.description) out.push(`${flow.description}`, '');
    flow.steps.forEach((s, i) => out.push(`${i + 1}. ${s.name}`));
    const expected = expectationLine(flow.candidateExpectations);
    if (expected) out.push('', `${expected}`);
    out.push('');
  }

  out.push('## Checks on every tested page', '');
  const sizes = plan.screenSizes?.join(', ') || 'every screen size';
  out.push(`At ${sizes}, as ${plan.roles?.join(', ') || 'visitor'}:`, '');
  for (const check of plan.gradedChecks || []) out.push(`- **${check.name}**: ${check.description}`);
  out.push('');

  const wontRun = plan.wontRun || [];
  out.push(`## Won’t run (${wontRun.length})`, '');
  if (wontRun.length === 0) out.push('Everything in the plan runs.');
  for (const item of wontRun) out.push(`- ${item.what} — ${item.reason}`);
  out.push('');

  if (plan.questions.length > 0) {
    out.push('## Questions', '');
    for (const q of plan.questions) {
      out.push(
        `- ${q.question} — ${q.selectedAnswer ? `answer: ${q.selectedAnswer}` : `no answer yet; the safe answer is used: ${q.safeAnswer ?? q.options[0]}`}`
      );
    }
    out.push('');
  }
  return out.join('\n');
}
