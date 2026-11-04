/**
 * Every fixed piece of document wording, in English. Other languages copy this shape exactly (ta.ts);
 * the label test compares the keys and checks the wording against ADR 0018 and the CONTEXT.md _Avoid_ lists.
 *
 * `{n}` in a value is filled by `formatLabel` (index.ts).
 */

import type {
  AssessmentNotDoneReason,
  AuditArea,
  AuditFindingGroup,
  AuditScale,
  PageAction,
  RouteSkipReason,
  SpeedNotMeasuredReason,
} from '@qa/types';
import type { AuditDocKind } from '../model.js';

export interface DocumentLabels {
  documentTitles: Record<AuditDocKind, string>;
  headings: {
    summary: string;
    pageHierarchy: string;
    navigationLinks: string;
    leavingSite: string;
    technology: string;
    pagesNotChecked: string;
    whatThisDidNotCheck: string;
    topIssues: string;
    scope: string;
    notIncluded: string;
    price: string;
    paymentTerms: string;
    timeline: string;
    aboutUs: string;
    optOut: string;
  };
  columns: {
    page: string;
    section: string;
    title: string;
    issue: string;
    found: string;
    suggestedFix: string;
    impact: string;
    effort: string;
    priority: string;
    phase: string;
    area: string;
    grade: string;
    reason: string;
    work: string;
    linksIn: string;
    linkText: string;
    goesTo: string;
  };
  scale: Record<AuditScale, string>;
  status: {
    notChecked: string;
    needsHumanReview: string;
    notIdentified: string;
    noneFound: string;
    imageNotIncluded: string;
    aiNote: string;
    ruleBased: string;
    automaticChecksOnly: string;
    betaTranslation: string;
  };
  areas: Record<AuditArea, string>;
  groups: Record<AuditFindingGroup, string>;
  actions: Record<PageAction, string>;
  skipReasons: Record<RouteSkipReason, string>;
  aiNotDone: Record<AssessmentNotDoneReason, string>;
  speedNotMeasured: Record<SpeedNotMeasuredReason, string>;
  phases: {
    /** A phase without its own name: "Phase {n}". */
    numbered: string;
    first: string;
    second: string;
    third: string;
  };
}

export const en: DocumentLabels = {
  documentTitles: {
    structure: 'Structure',
    content: 'Content',
    findings: 'Findings',
    roadmap: 'Improvement Roadmap',
    proposal: 'Proposal',
    'pitch-glimpse': 'Top issues found on your website',
    'owner-audit': 'Website Audit',
  },
  headings: {
    summary: 'Summary',
    pageHierarchy: 'Page hierarchy',
    navigationLinks: 'Navigation links',
    leavingSite: 'Links that leave the site',
    technology: 'Built with',
    pagesNotChecked: 'Pages not checked',
    whatThisDidNotCheck: 'What this did not check',
    topIssues: 'Top issues',
    scope: 'Scope',
    notIncluded: 'Not included',
    price: 'Price',
    paymentTerms: 'Payment terms',
    timeline: 'Timeline',
    aboutUs: 'About us',
    optOut: 'Opt out',
  },
  columns: {
    page: 'Page',
    section: 'Section',
    title: 'Title',
    issue: 'Issue',
    found: 'What was found',
    suggestedFix: 'Suggested fix',
    impact: 'Impact',
    effort: 'Effort',
    priority: 'Priority',
    phase: 'Phase',
    area: 'Area',
    grade: 'Grade',
    reason: 'Reason',
    work: 'Work',
    linksIn: 'Links to this page',
    linkText: 'Link text',
    goesTo: 'Goes to',
  },
  scale: {
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  },
  status: {
    notChecked: 'Not checked',
    needsHumanReview: 'Needs human review',
    notIdentified: 'Not identified',
    noneFound: 'None found',
    imageNotIncluded: 'Image not included',
    aiNote: 'AI note: advice only, it does not change any grade',
    ruleBased: 'Decided by a fixed rule',
    automaticChecksOnly: 'WCAG 2.2 AA, automatic checks only',
    betaTranslation: 'Beta translation',
  },
  areas: {
    'search-ranking': 'Search ranking',
    marketing: 'Marketing',
    usability: 'Ease of use',
    content: 'Content',
    accessibility: 'Accessibility',
    speed: 'Speed',
  },
  groups: {
    technical: 'Technical',
    marketing: 'Marketing',
    content: 'Content',
  },
  actions: {
    redesign: 'Redesign',
    repair: 'Repair',
  },
  skipReasons: {
    'page-limit': 'Page limit reached',
    'depth-limit': 'Too many link steps from the start page',
    excluded: 'Left out by the path limits',
    payment: 'Payment page',
    'did-not-load': 'Did not load',
    robots: 'Disallowed by robots.txt',
    'sign-in': 'Needs sign-in',
    'http-error': 'The server returned an error',
    timeout: 'Took too long to load',
    'off-site-redirect': 'Redirected to another site',
    'time-limit': 'Time limit reached',
    'trap-limit': 'Too many similar addresses',
    'session-lost': 'Sign-in was lost',
    duplicate: 'Same page as another address',
  },
  aiNotDone: {
    'no-ai-key': 'AI notes need an AI key',
    'ai-failed': 'The AI did not answer',
    'budget-spent': 'The AI request budget was used up',
  },
  speedNotMeasured: {
    failed: 'The measurement failed',
    timeout: 'The measurement took too long',
    quota: 'The daily measurement limit was reached',
    'no-network': 'No network connection',
    'no-field-data': 'Not enough data from real visitors',
  },
  phases: {
    numbered: 'Phase {n}',
    first: 'Quick fixes',
    second: 'Main improvements',
    third: 'Larger changes',
  },
};
