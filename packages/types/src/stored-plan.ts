/**
 * Runtime guards for stored plans, run summaries, reports and benchmark jobs.
 * Kept browser-safe and dependency-free.
 */
import type { RunSummary } from './run-report.js';
import type { BenchmarkJob } from './hub.js';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function testsOk(pages: unknown): boolean {
  return Array.isArray(pages) && pages.every((p) => isRecord(p) && Array.isArray(p.tests));
}

export function isStoredPlanShape(x: unknown): boolean {
  if (!isRecord(x) || !isRecord(x.plan) || !isRecord(x.context)) return false;
  const { plan, context } = x;
  if (typeof plan.runId !== 'string' || typeof plan.targetUrl !== 'string') return false;
  if (!Array.isArray(plan.pages) || !Array.isArray(plan.flows) || !Array.isArray(plan.questions)) return false;
  if (plan.planPages != null && !testsOk(plan.planPages)) return false;
  if (typeof context.targetUrl !== 'string' || typeof context.runId !== 'string') return false;
  if (context.draft == null) return true;
  if (!isRecord(context.draft)) return false;
  const draftPlan = context.draft.plan;
  if (draftPlan == null) return true;
  return isRecord(draftPlan) && testsOk(draftPlan.pages);
}

export function isRunSummary(x: unknown): x is RunSummary {
  if (!isRecord(x)) return false;
  if (
    typeof x.runId !== 'string' ||
    typeof x.targetUrl !== 'string' ||
    typeof x.host !== 'string' ||
    typeof x.timestamp !== 'string' ||
    typeof x.stamp !== 'string' ||
    typeof x.durationMs !== 'number' ||
    typeof x.ready !== 'boolean'
  ) {
    return false;
  }
  if (!isRecord(x.counts)) return false;
  // Lenient: a severity may be absent (older runs), but one that is present must be a number.
  return Object.values(x.counts).every((n) => typeof n === 'number');
}

export function isBenchmarkJob(x: unknown): x is BenchmarkJob {
  if (!isRecord(x)) return false;
  return (
    typeof x.id === 'string' &&
    (x.status === 'running' || x.status === 'done' || x.status === 'failed') &&
    typeof x.stage === 'string' &&
    typeof x.startedAt === 'string'
  );
}

export function isReleaseReportShape(x: unknown): boolean {
  if (!isRecord(x)) return false;
  return typeof x.runId === 'string' && Array.isArray(x.findings);
}

export function planPatchProblem(body: unknown): string | null {
  if (!isRecord(body)) return 'Body must be an object';

  if ('flows' in body && body.flows !== undefined) {
    if (!Array.isArray(body.flows)) return 'flows must be an array';
    for (const f of body.flows) {
      if (!isRecord(f) || typeof f.id !== 'string' || !Array.isArray(f.steps)) {
        return 'Each flow must have an id and steps array';
      }
    }
  }

  if ('testCases' in body && body.testCases !== undefined) {
    if (!Array.isArray(body.testCases)) return 'testCases must be an array';
    for (const tc of body.testCases) {
      if (!isRecord(tc) || typeof tc.id !== 'string' || !Array.isArray(tc.steps)) {
        return 'Each test case must have an id and steps array';
      }
    }
  }

  if ('items' in body && body.items !== undefined) {
    if (!Array.isArray(body.items)) return 'items must be an array';
    for (const it of body.items) {
      if (!isRecord(it) || typeof it.id !== 'string' || typeof it.skipped !== 'boolean') {
        return 'Each item must have an id and a boolean skipped';
      }
    }
  }

  if ('screenSizes' in body && body.screenSizes !== undefined) {
    if (!Array.isArray(body.screenSizes)) return 'screenSizes must be an array';
    for (const s of body.screenSizes) {
      if (typeof s !== 'string') {
        return 'Each screenSize must be a string';
      }
    }
  }

  return null;
}
