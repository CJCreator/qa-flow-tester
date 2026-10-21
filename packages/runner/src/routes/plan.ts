import type http from 'http';
import path from 'path';
import fs from 'fs/promises';
import {
  type ReviewPlan,
  type TestCase,
  type DiscoveredFlow,
  type Breakpoint,
  type PlanIntent,
  type RoleCredential,
  type ProductProfile,
  type RunCap,
  type DiscoveryDraft,
  type PageInventoryItem,
  type StorageStateData,
  type SignInFailureReason,
  type PlanPatchBody,
  type ProviderLimits,
  type AIStage,
  type AIStageUsage,
  signInReasonText,
} from '@qa/types';
import {
  PlanValidator,
  replaceCredentialsWithPlaceholders,
  markJourneysNeedingTestCopy,
  planToMarkdown,
  planToPlaywrightProject,
  zipFiles,
  Redactor,
  redactUrl,
  PacedAI,
  replanAll,
  replanJourneys,
  replanPage,
  replanMenus,
  addPagesToPlan,
  onOtherHost,
  pathOf,
  isSameSite,
  isPrivateHost,
  BrowserManager,
  PreFlightChecker,
  DeterministicSpider,
  RobotsPolicy,
  blockChanges,
  interpretRule,
  interpretTest,
  needsTestCopy,
  applySafeAnswers,
  loadSiteMemory,
  saveSiteMemory,
  rememberRun,
  emptyPlan,
  buildPlan,
  testsFor,
  screenSizesOf,
  gradedChecksFor,
  siteMapOf,
  handCheckNotes,
  defaultTestCase,
  type PlanBuildContext,
  type ReplanOptions,
  type AIProvider,
  type RunOptions,
  type ModelRecord,
  type MemorySummary,
} from '@qa/core';
import type { Route, RouteContext } from './route.js';
import { readJsonBody, sendJson } from './body.js';
import type { CheckupSession, StoredPlanRecord } from '../session/checkup-session.js';
import { checkIntentsOff, checkCustomHeaders, checkSavedSessions } from '../run-inputs.js';

export interface PlanRouteContext {
  readonly session: CheckupSession;
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  readonly url: URL;
  readonly broadcastRunnerEvent?: (event: Record<string, unknown>) => void;
  readonly isMine?: (runId: string | null | undefined) => boolean;
  readonly isBeta?: boolean;
  readonly aiFor?: (context: StoredPlanRecord['context']) => Promise<AIProvider | undefined>;
  readonly aiBudgetFor?: (
    settings: StoredPlanRecord['context']['ai'],
    key?: string,
    cap?: RunCap
  ) => Promise<{
    left?: number;
    limit?: number;
    visualReview: number;
    pacing: { gapMs: number; concurrency: number; cap?: RunCap; price?: { prompt: number; completion: number } };
    limits: ProviderLimits | null;
  }>;
  readonly recordModelOutcomes?: (models?: ModelRecord) => Promise<void>;
  readonly refuseTarget?: (res: http.ServerResponse, target: string) => Promise<boolean>;
  readonly siteDir?: () => string;
  readonly testCopyOf?: (typed: URL, marked: boolean) => Promise<boolean>;
  readonly onApproved?: (
    record: StoredPlanRecord,
    specTestCases: TestCase[],
    notRun: RunOptions['notRun'],
    generation: number
  ) => void;
}

const INCLUDED_HOST_PAGES = 30;
const SIGNED_IN_PAGES = 60;
const CONSENT_NEEDS_SIGN_IN =
  'Full testing needs the test sign-in details you agreed to use, and they are missing, so nothing was sent to the site. Send them again, or start a new check-up that only looks at the site.';

function hasCompleteSignIn(roles?: Array<{ username?: string; password?: string }>): boolean {
  return (roles ?? []).some((r) => !!r.username && !!r.password);
}

function addTokens(
  a?: Partial<Record<AIStage, AIStageUsage>>,
  b?: Partial<Record<AIStage, AIStageUsage>>
): Partial<Record<AIStage, AIStageUsage>> | undefined {
  if (!a && !b) return undefined;
  const out: Partial<Record<AIStage, AIStageUsage>> = { ...(a || {}) };
  if (!b) return out;
  for (const [stage, usage] of Object.entries(b) as Array<[AIStage, AIStageUsage]>) {
    const existing = out[stage];
    if (!existing) {
      out[stage] = { ...usage };
    } else {
      out[stage] = {
        requests: existing.requests + usage.requests,
        promptTokens: existing.promptTokens + usage.promptTokens,
        completionTokens: existing.completionTokens + usage.completionTokens,
        reasoningTokens: existing.reasoningTokens + usage.reasoningTokens,
        truncated: existing.truncated + usage.truncated,
      };
    }
  }
  return out;
}

export function asFlow(testCase: TestCase): DiscoveredFlow {
  return {
    id: testCase.id,
    name: testCase.name || testCase.id,
    role: testCase.role,
    description: '',
    startPage: testCase.startPage,
    steps: testCase.steps || [],
  };
}

export function planDelta(plan: ReviewPlan, touched: Set<string>) {
  const pageTouched = (p: NonNullable<ReviewPlan['planPages']>[number]) =>
    touched.has(p.id) || p.tests.some((t) => touched.has(t.id));
  return {
    delta: true as const,
    summary: plan.summary,
    wontRun: plan.wontRun,
    screenSizes: plan.screenSizes,
    questions: plan.questions,
    planPages: (plan.planPages || []).filter(pageTouched),
    navigation: (plan.navigation || []).filter((n) => touched.has(n.id)),
    flows: plan.flows.filter((f) => touched.has(`journey:${f.id}`)),
  };
}

export {
  emptyPlan,
  buildPlan,
  testsFor,
  screenSizesOf,
  gradedChecksFor,
  siteMapOf,
  handCheckNotes,
  defaultTestCase,
  type PlanBuildContext,
};

export function refreshPlan(record: StoredPlanRecord, session: CheckupSession): void {
  const before = record.plan;
  const since: MemorySummary | undefined = before.sinceLastRun
    ? { seenBefore: true, ...before.sinceLastRun }
    : undefined;
  const custom = record.context.customTestCases ? before.testCases : undefined;
  record.plan = buildPlan({
    context: record.context,
    targetUrl: record.plan.targetUrl,
    discoveredAt: record.plan.discoveredAt,
    sinceLastRun: since,
    aiAvailable: before.aiAvailable ?? true,
    reason: before.readOnlyReason || '',
    relative: (file?: string) =>
      file
        ? session
          ? session.report.relativePath(record.context.runId, file)
          : `/api/evidence/runs/${record.context.runId}/${file}`
        : undefined,
  });
  if (custom) record.plan.testCases = custom;
}

const PLAN_SAVE_FAILED = "Couldn't save the plan. Try again.";

function redactError(err: unknown, record: StoredPlanRecord, session: CheckupSession): string {
  const raw = err instanceof Error ? err.message : String(err);
  const secrets: Array<Partial<RoleCredential>> = [...(record.context.profile?.roles || [])];
  const customHeaders = record.context.customHeaders || session.secrets.headers;
  if (customHeaders) {
    for (const val of Object.values(customHeaders)) {
      if (typeof val === 'string' && val.length >= 3) secrets.push({ token: val });
    }
  }
  const tunnelAuth = record.context.tunnelAuth || session.secrets.tunnelAuth;
  if (tunnelAuth && tunnelAuth.length >= 3) secrets.push({ token: tunnelAuth });
  const redactor = new Redactor(secrets);
  let out = redactor.text(raw);
  out = redactUrl(out);
  out = out.replace(/(https?:\/\/[^\s"'<>)]+)\?[^\s"'<>)]*/gi, '$1');
  return out;
}

export async function ensurePlanLoaded(session: CheckupSession): Promise<StoredPlanRecord | null> {
  const record = await session.plan.current();
  if (record && session.run.phase === 'idle') {
    session.run.begin(record.plan.runId, record.plan.targetUrl);
    session.run.setPhase('awaiting-review');
  }
  return record;
}

export async function getPlan(c: PlanRouteContext): Promise<void> {
  const { session, res } = c;
  const record = await ensurePlanLoaded(session);
  if (
    !record ||
    (session.run.phase !== 'awaiting-review' && session.run.phase !== 'scanning' && session.run.phase !== 'testing')
  ) {
    sendJson(res, 404, { error: 'No plan awaiting review' });
    return;
  }
  sendJson(res, 200, session.plan.forClient(record.plan));
}

/** Built once per Plan: the validator indexes the pages and forms, which change only when the Plan is rebuilt. */
const planValidators = new WeakMap<object, { forms: unknown; validator: PlanValidator }>();

function validatorFor(record: StoredPlanRecord): PlanValidator {
  const forms = record.context.draft?.forms;
  const cached = planValidators.get(record.plan);
  if (cached && cached.forms === forms) return cached.validator;
  const validator = new PlanValidator(record.plan.pages, forms);
  planValidators.set(record.plan, { forms, validator });
  return validator;
}

export async function patchPlan(c: PlanRouteContext): Promise<void> {
  const { session, req, res } = c;
  const record = await ensurePlanLoaded(session);
  if (!record || session.run.phase !== 'awaiting-review') {
    sendJson(res, 404, { error: 'No plan awaiting review' });
    return;
  }

  let body: PlanPatchBody;
  try {
    body = await readJsonBody<PlanPatchBody>(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  let intentsOff: PlanIntent[] | undefined;
  if (body.intentsOff !== undefined) {
    const checked = checkIntentsOff(body.intentsOff);
    if (!checked.ok) {
      sendJson(res, 400, { error: checked.problem.error, code: checked.problem.code });
      return;
    }
    intentsOff = checked.value;
  }

  const validator = validatorFor(record);
  if (Array.isArray(body.testCases)) {
    const issues = validator.check(body.testCases.map(asFlow));
    if (issues.length > 0) {
      sendJson(res, 422, { error: 'Some steps are aimed at things that aren’t on the page.', issues });
      return;
    }
  }

  const roles = record.context.profile?.roles || [];
  for (const item of [
    ...(Array.isArray(body.flows) ? body.flows : []),
    ...(Array.isArray(body.testCases) ? body.testCases : []),
  ]) {
    replaceCredentialsWithPlaceholders(item.steps || [], roles);
  }

  if (body.questions && Array.isArray(body.questions)) {
    for (const patchQ of body.questions) {
      const target = record.plan.questions.find((q) => q.id === patchQ.id);
      if (target) target.selectedAnswer = patchQ.selectedAnswer;
      const draftTarget = record.context.draft?.ambiguityQuestions?.find((q) => q.id === patchQ.id);
      if (draftTarget) draftTarget.selectedAnswer = patchQ.selectedAnswer;
    }
  }

  if (body.answers && typeof body.answers === 'object') {
    for (const [id, given] of Object.entries(body.answers)) {
      const answer = given || undefined;
      const target = record.plan.questions.find((q) => q.id === id);
      if (target) target.selectedAnswer = answer;
      const draftTarget = record.context.draft?.ambiguityQuestions?.find((q) => q.id === id);
      if (draftTarget) draftTarget.selectedAnswer = answer;
    }
  }

  if (body.flows && Array.isArray(body.flows)) {
    validator.markFlowsNeedingHelp(body.flows);
    record.plan.flows = body.flows;
    if (record.context.draft) {
      record.context.draft.flows = body.flows;
      markJourneysNeedingTestCopy(record.context.draft);
    }
  }

  if (body.testCases && Array.isArray(body.testCases)) {
    record.plan.testCases = body.testCases;
    record.context.customTestCases = true;
  } else if (record.context.draft) {
    record.plan.testCases = testsFor(record.context).specTestCases;
    record.context.customTestCases = undefined;
  }

  if (body.productContext !== undefined) {
    record.context.productContext = body.productContext;
    record.plan.productContext = body.productContext;
    if (body.productContext.trim()) {
      const filePath =
        record.context.contextFilePath || path.join(session.report.dirFor(record.plan.runId), 'product-context.md');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, body.productContext, 'utf8');
      record.context.contextFilePath = filePath;
    }
  }

  if (body.designNotes !== undefined) {
    record.context.designNotes = body.designNotes;
    record.plan.designNotes = body.designNotes;
  }

  const draft = record.context.draft;
  if (intentsOff && draft?.plan) draft.plan.intentsOff = intentsOff.length > 0 ? intentsOff : undefined;
  for (const item of Array.isArray(body.items) ? body.items : []) {
    const skipped = item.skipped ? true : undefined;
    if (item.id.startsWith('journey:')) {
      const flow = draft?.flows.find((f) => `journey:${f.id}` === item.id);
      if (flow) flow.outOfScope = skipped;
      continue;
    }
    const plan = draft?.plan;
    const found =
      plan?.pages.find((p) => p.id === item.id) ??
      plan?.navigation.find((n) => n.id === item.id) ??
      plan?.pages.flatMap((p) => p.tests).find((t) => t.id === item.id);
    if (found) found.skipped = skipped;
  }
  const sizes = (body.screenSizes || []).filter((s): s is Breakpoint => ['375px', '768px', '1440px'].includes(s));
  if (sizes.length > 0) record.context.breakpoints = sizes;

  const touched = new Set((body.items || []).map((i) => i.id));
  for (const change of Array.isArray(body.expectations) ? body.expectations : []) {
    touched.add(change.id);
    const text = change.text?.trim();
    if (change.id.startsWith('journey:')) {
      const flow = draft?.flows.find((f) => `journey:${f.id}` === change.id);
      if (!flow) continue;
      flow.candidateExpectations = text
        ? { text: { contains: text }, origin: 'user' }
        : { ...(flow.candidateExpectations || {}), origin: 'user' };
      continue;
    }
    const test = draft?.plan?.pages.flatMap((pg) => pg.tests).find((t) => t.id === change.id);
    if (test)
      test.expectations = text
        ? { text: { contains: text }, origin: 'user' }
        : { ...(test.expectations || {}), origin: 'user' };
  }

  for (const edit of Array.isArray(body.sourceEdits) ? body.sourceEdits : []) {
    const test = draft?.plan?.pages.flatMap((pg) => pg.tests).find((t) => t.id === edit.itemId);
    if (!test) continue;
    touched.add(edit.itemId);
    if (Array.isArray(edit.roles)) {
      test.proposedRoles = edit.roles.filter((r) => typeof r === 'string' && r.trim());
      test.rolesConfirmed = true;
    }
    if (edit.confirm) test.rolesConfirmed = true;
    if (edit.severity && ['Blocker', 'Major', 'Minor', 'Suggestion'].includes(edit.severity)) {
      test.docSeverity = edit.severity;
    }
    if (typeof edit.stale === 'boolean') test.docStale = edit.stale || undefined;
  }
  let notFoundChanged = false;
  if (draft?.plan?.notFound && Array.isArray(body.notFoundEdits)) {
    const gone = new Set(body.notFoundEdits.filter((e) => e.remove).map((e) => e.id));
    if (gone.size > 0) {
      draft.plan.notFound = draft.plan.notFound.filter((n) => !gone.has(n.id));
      notFoundChanged = true;
    }
  }

  if (body.preset === 'quick' && draft?.plan) {
    record.context.breakpoints = ['1440px'];
    for (const nav of draft.plan.navigation) {
      if (!nav.shared && !nav.leavesSite) {
        nav.skipped = true;
        touched.add(nav.id);
      }
    }
  }

  if (draft) refreshPlan(record, session);
  try {
    await session.plan.save(record);
  } catch {
    sendJson(res, 500, { error: PLAN_SAVE_FAILED });
    return;
  }
  const small =
    body.intentsOff === undefined &&
    !body.flows &&
    !body.testCases &&
    body.productContext === undefined &&
    body.designNotes === undefined &&
    !notFoundChanged;
  sendJson(res, 200, small ? planDelta(record.plan, touched) : session.plan.forClient(record.plan));
}

export async function planMarkdown(c: PlanRouteContext): Promise<void> {
  const { session, res } = c;
  const record = await ensurePlanLoaded(session);
  if (!record || session.run.phase !== 'awaiting-review') {
    sendJson(res, 404, { error: 'No plan awaiting review' });
    return;
  }
  let host = 'site';
  try {
    host = new URL(record.plan.targetUrl).host.replace(/[^a-z0-9.-]/gi, '_');
  } catch {
    // keep "site"
  }
  res.writeHead(200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="test-plan-${host}.md"`,
  });
  res.end(planToMarkdown(record.plan));
}

export async function planExport(c: PlanRouteContext): Promise<void> {
  const { session, res } = c;
  const record = await ensurePlanLoaded(session);
  if (!record || session.run.phase !== 'awaiting-review') {
    sendJson(res, 404, { error: 'No plan awaiting review' });
    return;
  }
  let zip: Buffer;
  try {
    zip = zipFiles(planToPlaywrightProject(record.plan));
  } catch {
    sendJson(res, 409, { error: 'The plan has no tests to export yet' });
    return;
  }
  let host = 'site';
  try {
    host = new URL(record.plan.targetUrl).host.replace(/[^a-z0-9.-]/gi, '_');
  } catch {
    // keep "site"
  }
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="playwright-export-${host}.zip"`,
    'Content-Length': zip.length,
  });
  res.end(zip);
}

export function replanOptions(
  record: StoredPlanRecord,
  instructions: string | undefined,
  report: (what: string) => void
): ReplanOptions {
  const roles = record.context.profile?.roles || [];
  const redactor = new Redactor(roles);
  return {
    readOnly: !!record.context.readOnly,
    productContext: record.context.productContext,
    instructions: instructions?.trim() || undefined,
    roles,
    forbiddenActions: record.context.profile?.forbiddenActions,
    redact: (text) => redactor.text(text),
    onProgress: report,
  };
}

export async function startPlanUpdate(
  c: PlanRouteContext,
  what: string,
  work: (record: StoredPlanRecord, ai: PacedAI | undefined, report: (step: string) => void) => Promise<string[]>
): Promise<void> {
  const { session, res } = c;
  const record = await ensurePlanLoaded(session);
  if (!record || session.run.phase !== 'awaiting-review' || !record.context.draft?.plan) {
    sendJson(res, 404, { error: 'No plan awaiting review' });
    return;
  }
  if (session.plan.update()) {
    sendJson(res, 409, {
      error: 'The plan is already being updated. Wait for it to finish.',
      code: 'ERR_PLAN_UPDATING',
    });
    return;
  }
  const runId = record.plan.runId;
  sendJson(res, 202, { updating: true, what });
  const broadcast = c.broadcastRunnerEvent ?? ((event) => session.events.publish(event));
  broadcast({ type: 'PLAN_UPDATE_STARTED', runId, what, timestamp: Date.now() });
  session.plan.setUpdate(
    (async () => {
      try {
        const provider = c.aiFor ? await c.aiFor(record.context) : undefined;
        const budget =
          provider && c.aiBudgetFor
            ? await c.aiBudgetFor(record.context.ai, undefined, record.context.aiCap)
            : undefined;
        const paced = provider
          ? new PacedAI(provider, budget?.left ?? Infinity, { model: record.context.ai?.model, ...budget?.pacing })
          : undefined;
        const notes = await work(record, paced, (step) =>
          broadcast({
            type: 'PLAN_UPDATE_PROGRESS',
            runId,
            what: step,
            requestsUsed: paced?.used ?? 0,
            timestamp: Date.now(),
          })
        );
        const draft = record.context.draft;
        const plan = draft.plan!;
        const used = paced?.used ?? 0;
        plan.budget = {
          needed: plan.budget?.needed ?? 0,
          ...plan.budget,
          used: (plan.budget?.used ?? 0) + used,
          tokens: addTokens(plan.budget?.tokens, paced?.tokens),
          left: budget?.left !== undefined ? Math.max(0, budget.left - used) : plan.budget?.left,
          limit: budget?.limit ?? plan.budget?.limit,
        };
        if (draft.exploration) draft.exploration.notes = [...new Set([...draft.exploration.notes, ...notes])];
        if (c.recordModelOutcomes) await c.recordModelOutcomes(paced?.models);
        refreshPlan(record, session);
        // The response was sent before this ran, so a failed save reaches the wizard as PLAN_UPDATE_FAILED.
        await session.plan.save(record).catch(() => {
          throw new Error(PLAN_SAVE_FAILED);
        });
        broadcast({ type: 'PLAN_UPDATED', runId, what, timestamp: Date.now() });
      } catch (err) {
        broadcast({
          type: 'PLAN_UPDATE_FAILED',
          runId,
          what,
          error: redactError(err, record, session),
          timestamp: Date.now(),
        });
      } finally {
        session.plan.setUpdate(null);
      }
    })()
  );
}

export async function replan(c: PlanRouteContext): Promise<void> {
  const { req, res } = c;
  let body: { itemId?: string; all?: boolean; instructions?: string; productContext?: string; promote?: boolean };
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  const id = body.itemId || '';
  const what = body.all
    ? 'Re-planning everything'
    : body.promote
      ? `Testing ${id.replace(/^page:/, '')} on its own`
      : 'Re-planning with the AI';
  await startPlanUpdate(c, what, async (record, ai, report) => {
    const draft = record.context.draft;
    if (body.productContext !== undefined) {
      record.context.productContext = body.productContext;
      record.plan.productContext = body.productContext;
    }
    const options = replanOptions(record, body.instructions, report);
    const productId = record.context.productId;
    if (body.all) return replanAll(draft, ai, { ...options, productId });
    if (id.startsWith('journey:')) {
      const flow = draft.flows.find((f) => `journey:${f.id}` === id);
      const asked = `Re-plan the journey “${flow?.name ?? id}”${options.instructions ? `: ${options.instructions}` : ''}. Keep the other journeys as they are.`;
      return replanJourneys(draft, ai, { ...options, productId, instructions: asked });
    }
    if (id.startsWith('page:'))
      return replanPage(draft, id.slice('page:'.length), ai, { ...options, promote: body.promote });
    if (id.startsWith('pagetest:'))
      return replanPage(draft, id.slice('pagetest:'.length, id.lastIndexOf(':')), ai, options);
    const nav = draft.plan!.navigation.find((n) => n.id === id);
    if (nav?.shared) return replanMenus(draft, ai, options);
    if (nav) return replanPage(draft, nav.startPage, ai, options);
    throw new Error('That item isn’t in the plan any more.');
  });
}

async function crawlMore(
  c: PlanRouteContext,
  record: StoredPlanRecord,
  target: string,
  options: {
    startPaths?: string[];
    maxPages: number;
    exploreClicks: boolean;
    onPage?: (page: PageInventoryItem, n: number) => void;
    storageState?: string | StorageStateData;
    who?: string;
  }
): Promise<{ pages: PageInventoryItem[]; forms: NonNullable<DiscoveryDraft['forms']> }> {
  const browser = new BrowserManager();
  const origin = new URL(target);
  const ownMachine = isPrivateHost(origin.hostname);
  const who = options.who ?? 'visitor';
  try {
    const context = await browser.createContext({
      baseUrl: target,
      storageState: options.storageState,
      customHeaders: record.context.customHeaders || c.session.secrets.headers,
      userAgent: record.context.userAgent || c.session.secrets.userAgent,
      tunnelAuth: record.context.tunnelAuth || c.session.secrets.tunnelAuth,
      headerHosts: record.context.headerHosts || c.session.secrets.headerHosts,
    });
    if (record.context.readOnly) await blockChanges(context);
    const result = await new DeterministicSpider(
      record.context.profile?.forbiddenActions || [],
      options.maxPages
    ).crawl(context, target, {
      startPaths: options.startPaths,
      exploreClicks: options.exploreClicks,
      robots: ownMachine ? undefined : await RobotsPolicy.fetch(origin.origin, 'QA-Benchmarking-Bot'),
      pageDelayMs: ownMachine ? 0 : 2000,
      screenshotDir: path.join(c.session.report.dirFor(record.context.runId), 'plan-pages'),
      screenshotPrefix: `more-${Date.now()}`,
      onPage: options.onPage,
    });
    return {
      pages: result.pages.map((p) => ({
        ...p,
        reachedBy: [who],
        links: p.links?.map((l) => ({ ...l, seenBy: [who] })),
      })),
      forms: result.forms.map((f) => ({
        urlPath: f.urlPath,
        inputs: f.inputs.map((i) => ({
          selector: i.selector,
          type: i.type,
          label: i.label,
          required: i.required,
          pattern: i.pattern,
          min: i.min,
          max: i.max,
          minLength: i.minLength,
          maxLength: i.maxLength,
        })),
        submitButtonSelector: f.submitButtonSelector,
        method: f.method,
        ...(f.opening?.length ? { opening: f.opening } : {}),
      })),
    };
  } finally {
    await browser.close();
  }
}

export async function addPage(c: PlanRouteContext): Promise<void> {
  const { session, req, res } = c;
  const record = await ensurePlanLoaded(session);
  let body: { address?: string };
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  if (!record?.context.draft) {
    sendJson(res, 404, { error: 'No plan awaiting review' });
    return;
  }
  let target: URL;
  try {
    target = new URL((body.address || '').trim(), record.context.targetUrl);
  } catch {
    sendJson(res, 400, { error: 'That doesn’t look like an address on this site.' });
    return;
  }
  if (!isSameSite(target.host, new URL(record.context.targetUrl).host)) {
    sendJson(res, 400, {
      error: 'That address isn’t on this site. Links to other sites are listed under Navigation.',
    });
    return;
  }
  const address = target.pathname + target.search;
  if (record.context.draft.pages.some((p) => pathOf(p.urlPath) === target.pathname)) {
    sendJson(res, 400, { error: 'That page is already in the plan.' });
    return;
  }
  await startPlanUpdate(c, `Adding ${address}`, async (rec, ai, report) => {
    report(`Opening ${address}`);
    const found = await crawlMore(c, rec, rec.context.targetUrl, {
      startPaths: [address],
      maxPages: 1,
      exploreClicks: false,
    });
    if (found.pages.length === 0) throw new Error(`${address} couldn’t be opened, or it asks for a sign-in.`);
    return (
      await addPagesToPlan(rec.context.draft, found, ai, {
        ...replanOptions(rec, undefined, report),
        added: true,
      })
    ).notes;
  });
}

export async function includeHost(c: PlanRouteContext): Promise<void> {
  const { session, req, res } = c;
  const record = await ensurePlanLoaded(session);
  let body: { host?: string };
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  const draft = record?.context.draft;
  const other = draft?.plan?.otherHosts.find((h) => h.host === body.host);
  const link = draft?.pages.flatMap((p) => p.links || []).find((l) => l.leavesSite && new URL(l.to).host === body.host);
  if (!record || !draft || !other || !link) {
    sendJson(res, 400, { error: 'That host isn’t linked from this site.' });
    return;
  }
  if (other.included) {
    sendJson(res, 400, { error: 'That host is already in the plan.' });
    return;
  }
  const origin = new URL(link.to).origin;
  if (c.refuseTarget && (await c.refuseTarget(res, origin))) return;
  await startPlanUpdate(c, `Adding ${other.host}`, async (rec, ai, report) => {
    report(`Exploring ${other.host}`);
    const crawled = await crawlMore(c, rec, `${origin}/`, {
      maxPages: INCLUDED_HOST_PAGES,
      exploreClicks: true,
      onPage: (_page, n) => report(`Exploring ${other.host}: ${n} ${n === 1 ? 'page' : 'pages'} found`),
    });
    if (crawled.pages.length === 0) throw new Error(`${other.host} couldn’t be explored.`);
    const out = await addPagesToPlan(
      rec.context.draft,
      onOtherHost(crawled, origin),
      ai,
      replanOptions(rec, undefined, report)
    );
    const included = rec.context.draft.plan!.otherHosts.find((h) => h.host === other.host);
    if (included) included.included = true;
    return out.notes;
  });
}

export async function addSignIn(c: PlanRouteContext): Promise<void> {
  const { session, req, res } = c;
  const record = await ensurePlanLoaded(session);
  let body: Partial<RoleCredential>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  const role =
    (body.role || 'member')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9 _-]/g, '')
      .slice(0, 40) || 'member';
  if (!body.username?.trim() || !body.password) {
    sendJson(res, 400, { error: 'Enter the username and password to sign in with.' });
    return;
  }
  if (!record?.context.draft?.plan) {
    sendJson(res, 404, { error: 'No plan awaiting review' });
    return;
  }
  if (record.context.profile?.roles.some((r) => r.role === role)) {
    sendJson(res, 400, { error: `There’s already a sign-in called “${role}”. Give this one another name.` });
    return;
  }
  const credential: RoleCredential = {
    role,
    username: body.username.trim(),
    password: body.password,
    loginPath: body.loginPath?.trim() || undefined,
  };
  await startPlanUpdate(c, `Adding the sign-in “${role}”`, async (rec, ai, report) => {
    report(`Signing in as ${role}`);
    const profile: ProductProfile = {
      name: rec.context.productId,
      productId: rec.context.productId,
      roles: [credential],
    };
    const browser = new BrowserManager();
    let found: Awaited<ReturnType<typeof crawlMore>>;
    try {
      const runAuthDir = session.secrets.authDirFor(rec.context.runId);
      await fs.mkdir(runAuthDir, { recursive: true, mode: 0o700 });
      const signedIn = await new PreFlightChecker().runPreFlight(
        rec.context.targetUrl,
        profile,
        rec.context.tunnelAuth || session.secrets.tunnelAuth,
        {
          browserManager: browser,
          authDir: runAuthDir,
          customHeaders: rec.context.customHeaders || session.secrets.headers,
          userAgent: rec.context.userAgent || session.secrets.userAgent,
          headerHosts: rec.context.headerHosts || session.secrets.headerHosts,
        }
      );
      const storageState = signedIn.roleStorageStates?.[role];
      if (!storageState)
        throw new Error(`Signing in as “${role}” didn’t work. Check the username, password and sign-in page.`);
      const landing = signedIn.roleLandingPaths?.[role];
      found = await crawlMore(c, rec, rec.context.targetUrl, {
        startPaths: landing ? [landing] : [],
        maxPages: SIGNED_IN_PAGES,
        exploreClicks: true,
        storageState,
        who: role,
        onPage: (_page, n) => report(`Exploring as ${role}: ${n} ${n === 1 ? 'page' : 'pages'} found`),
      });
    } finally {
      await browser.close();
    }
    const draft = rec.context.draft;
    rec.context.profile = {
      ...(rec.context.profile ?? { name: rec.context.productId, productId: rec.context.productId, roles: [] }),
    };
    rec.context.profile.roles = [...rec.context.profile.roles, credential];
    const known = new Map<string, PageInventoryItem>(draft.pages.map((p) => [pathOf(p.urlPath), p]));
    for (const page of found.pages) {
      const before = known.get(pathOf(page.urlPath));
      if (!before) continue;
      before.reachedBy = [...new Set([...(before.reachedBy?.length ? before.reachedBy : ['visitor']), role])];
      const planned = draft.plan!.pages.find((p) => p.urlPath === before.urlPath);
      if (planned) planned.reachedBy = [...new Set([...planned.reachedBy, role])];
    }
    const out = await addPagesToPlan(draft, found, ai, replanOptions(rec, undefined, report));
    if (draft.exploration) {
      const reached = new Set(found.pages.map((p) => pathOf(p.urlPath)));
      draft.exploration.notReached = draft.exploration.notReached?.filter((p) => !reached.has(pathOf(p)));
      draft.exploration.signedInAs = [...new Set([...(draft.exploration.signedInAs || []), role])];
      draft.exploration.notes = draft.exploration.notes.filter(
        (n) => !/not reached|Add a sign-in/i.test(n) || (draft.exploration!.notReached?.length ?? 0) > 0
      );
    }
    return [
      `Signed in as “${role}”: ${out.pages.length} new ${out.pages.length === 1 ? 'page' : 'pages'} added to the plan.`,
      ...out.notes,
    ];
  });
}

export async function interpret(c: PlanRouteContext): Promise<void> {
  const { session, req, res } = c;
  const record = await ensurePlanLoaded(session);
  if (!record || session.run.phase !== 'awaiting-review' || !record.context.draft) {
    sendJson(res, 404, { error: 'No plan awaiting review' });
    return;
  }
  let body: { sentence?: string; urlPath?: string; role?: string; kind?: 'test' | 'rule'; flowId?: string };
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  const ai = c.aiFor ? await c.aiFor(record.context) : undefined;
  const draft = record.context.draft;
  if (body.kind === 'rule') {
    const flow = draft.flows.find((f) => f.id === body.flowId);
    if (!flow) {
      sendJson(res, 404, { ok: false, message: 'That journey isn’t in the plan any more.' });
      return;
    }
    sendJson(res, 200, await interpretRule({ sentence: body.sentence || '', flow, draft, ai }));
    return;
  }
  const interpretation = await interpretTest({
    sentence: body.sentence || '',
    urlPath: body.urlPath || '/',
    role: body.role,
    draft,
    ai,
  });
  if (interpretation.ok) {
    replaceCredentialsWithPlaceholders(interpretation.flow.steps, record.context.profile?.roles || []);
    if (needsTestCopy(interpretation.flow, draft.pages, draft.forms)) interpretation.flow.needsTestCopy = true;
  }
  sendJson(res, 200, interpretation);
}

const NO_TESTS_FALLBACK =
  'Nothing to test: the scan found no page or journey to check. Add a page or a journey, or choose another address.';

/** Sessions with an approval in flight: a second approve while one is running is refused, key or not. */
const approving = new WeakSet<CheckupSession>();

export async function approvePlan(c: PlanRouteContext): Promise<void> {
  const { session, req, res } = c;
  const idempotencyKey = (req.headers['idempotency-key'] as string | undefined)?.trim();
  if (idempotencyKey) {
    const existing = session.plan.recentApproval(idempotencyKey);
    if (existing && Date.now() - existing.timestamp < 60 * 60 * 1000) {
      // The same approval again: it ran once, so answer with the first result.
      sendJson(res, 200, {
        status: 'approved',
        runId: existing.runId || session.run.runId || '',
        repeated: true,
      });
      return;
    }
  }
  if (approving.has(session)) {
    sendJson(res, 409, {
      error: 'This plan is already being approved. Wait a moment.',
      code: 'ERR_DUPLICATE_APPROVAL',
      runId: session.run.runId ?? undefined,
    });
    return;
  }
  // Both are set before any await, so a second request that arrives next sees them.
  approving.add(session);
  if (idempotencyKey) session.plan.rememberApproval(idempotencyKey, session.run.runId ?? '');
  try {
    await approveOnce(c, idempotencyKey);
  } catch (err) {
    if (idempotencyKey) session.plan.forgetApproval(idempotencyKey);
    throw err;
  } finally {
    approving.delete(session);
  }
  if (idempotencyKey && res.statusCode !== 200) session.plan.forgetApproval(idempotencyKey);
}

async function approveOnce(c: PlanRouteContext, idempotencyKey: string | undefined): Promise<void> {
  const { session, req, res } = c;
  const record = await ensurePlanLoaded(session);
  if (!record || session.run.phase !== 'awaiting-review') {
    sendJson(res, 404, { error: 'No plan awaiting review' });
    return;
  }
  if (idempotencyKey) session.plan.rememberApproval(idempotencyKey, record.plan.runId);
  if (session.plan.update()) {
    sendJson(res, 409, {
      error: 'The plan is still being updated. Approve it when that’s done.',
      code: 'ERR_PLAN_UPDATING',
    });
    return;
  }

  const body: {
    breakpoints?: string[];
    roles?: RoleCredential[];
    savedSessions?: unknown;
    customHeaders?: unknown;
  } = await readJsonBody<{
    breakpoints?: string[];
    roles?: RoleCredential[];
    savedSessions?: unknown;
    customHeaders?: unknown;
  }>(req).catch(() => ({}));
  if (body?.breakpoints) {
    record.context.breakpoints = body.breakpoints as Breakpoint[];
  }

  if (body?.customHeaders !== undefined) {
    const checked = checkCustomHeaders(body.customHeaders);
    if (!checked.ok) {
      sendJson(res, 400, { error: checked.problem.error, code: checked.problem.code });
      return;
    }
    if (checked.value) {
      record.context.customHeaders = { ...(record.context.customHeaders || {}), ...checked.value };
      session.secrets.set({
        headers: { ...(session.secrets.headers || {}), ...checked.value },
        tunnelAuth: session.secrets.tunnelAuth,
        headerHosts: session.secrets.headerHosts,
        userAgent: session.secrets.userAgent,
      });
    }
  }
  const headersMissing = (record.context.customHeaderNames || []).filter(
    (h) => !record.context.customHeaders?.[h] && !session.secrets.headers?.[h]
  );
  if (headersMissing.length > 0) {
    sendJson(res, 409, {
      error: `Release check-up restarted since this plan was made, and custom headers are never saved to disk. Send them again for: ${headersMissing.join(', ')}.`,
      code: 'ERR_HEADERS_NOT_SAVED',
      needsHeaders: headersMissing,
    });
    return;
  }

  if (body?.savedSessions !== undefined) {
    let hostname = '';
    try {
      hostname = new URL(record.context.targetUrl).hostname;
    } catch {
      // checked by the session rules
    }
    const checked = checkSavedSessions(body.savedSessions, hostname);
    if (!checked.ok) {
      sendJson(res, 400, { error: checked.problem.error, code: checked.problem.code });
      return;
    }
    if (checked.value) {
      const runId = record.plan.runId;
      session.secrets.savedSessions.set(runId, {
        ...(session.secrets.savedSessions.get(runId) ?? {}),
        ...checked.value,
      });
      const sentRoles = new Set(Object.keys(checked.value));
      record.context.sessionNotSaved = (record.context.sessionNotSaved || []).filter((r) => !sentRoles.has(r));
      record.context.signInNotSaved = (record.context.signInNotSaved || []).filter((r) => !sentRoles.has(r));
    }
  }
  const sessionsMissing = (record.context.sessionNotSaved || []).filter(
    (r) => !session.secrets.savedSessions.get(record.plan.runId)?.[r]
  );
  if (sessionsMissing.length > 0) {
    sendJson(res, 409, {
      error: `Release check-up restarted since this plan was made, and saved sessions are never saved to disk. Send them again for: ${sessionsMissing.join(', ')}.`,
      code: 'ERR_SESSION_NOT_SAVED',
      needsSession: sessionsMissing,
    });
    return;
  }

  const notSaved = record.context.signInNotSaved || [];
  if (!record.context.profile && notSaved.length > 0) {
    record.context.profile = {
      name: record.context.productId || 'default',
      productId: record.context.productId || 'default',
      roles: notSaved.map((r) => ({ role: r, username: '' })),
    };
  }

  if (Array.isArray(body?.roles) && record.context.profile) {
    const knownRoleNames = new Set(record.context.profile.roles.map((r) => r.role));
    const validSent = body.roles.filter((r) => r && typeof r.role === 'string' && knownRoleNames.has(r.role));
    const sentMap = new Map(validSent.map((r) => [r.role, r]));

    record.context.profile.roles = record.context.profile.roles.map((saved) => {
      const sent = sentMap.get(saved.role);
      if (!sent) return saved;
      return {
        ...saved,
        username: sent.username !== undefined ? sent.username : saved.username,
        password: sent.password !== undefined ? sent.password : saved.password,
        loginPath: sent.loginPath || saved.loginPath,
        usernameSelector: sent.usernameSelector || saved.usernameSelector,
        passwordSelector: sent.passwordSelector || saved.passwordSelector,
        submitSelector: sent.submitSelector || saved.submitSelector,
        postLoginSelector: sent.postLoginSelector || saved.postLoginSelector,
        postLoginUrl: sent.postLoginUrl || saved.postLoginUrl,
      };
    });

    if (notSaved.length > 0) {
      record.context.signInNotSaved = notSaved.filter((role) => {
        const sent = sentMap.get(role);
        return !(sent && sent.password);
      });
    }
  }

  const stillMissing = record.context.signInNotSaved || [];
  if (stillMissing.length > 0) {
    sendJson(res, 409, {
      error: `Release check-up restarted since this plan was made, and sign-in details are never saved to disk. Send them again for: ${stillMissing.join(', ')}.`,
      code: 'ERR_SIGN_IN_REQUIRED',
      needsSignIn: stillMissing,
      needsSignInDetails: stillMissing.map((r) => {
        const saved = record.context.profile?.roles.find((x) => x.role === r);
        return { role: r, loginPath: saved?.loginPath };
      }),
    });
    return;
  }

  if (record.context.signInConsent && !hasCompleteSignIn(record.context.profile?.roles)) {
    const missing = (record.context.profile?.roles || []).filter((r) => !r.username || !r.password).map((r) => r.role);
    sendJson(res, 409, {
      error: CONSENT_NEEDS_SIGN_IN,
      code: 'ERR_SIGN_IN_REQUIRED',
      needsSignIn: missing.length > 0 ? missing : undefined,
      needsSignInDetails: missing.map((r) => ({
        role: r,
        loginPath: record.context.profile?.roles.find((x) => x.role === r)?.loginPath,
      })),
    });
    return;
  }

  // Beta: the read-only decision is made here, before the tests are chosen. When it flips, the
  // reviewed list is stale (it was made with writes allowed), so it is derived again once.
  let flippedReadOnly = false;
  if (c.isBeta && !record.context.readOnly && c.siteDir && c.testCopyOf) {
    try {
      const typed = new URL(record.context.targetUrl);
      const memory = record.context.siteHost
        ? await loadSiteMemory(c.siteDir(), record.context.siteHost).catch(() => null)
        : null;
      if (!(await c.testCopyOf(typed, !!memory?.staging))) {
        record.context.readOnly = true;
        flippedReadOnly = true;
      }
    } catch {
      record.context.readOnly = true;
      flippedReadOnly = true;
    }
  }

  const draft = record.context.draft;
  const answeredByOwner = Object.fromEntries(
    (draft?.ambiguityQuestions || []).filter((q) => q.key && q.selectedAnswer).map((q) => [q.key!, q.selectedAnswer!])
  );
  applySafeAnswers(record.plan.questions);
  if (draft?.ambiguityQuestions) applySafeAnswers(draft.ambiguityQuestions);

  // The tests that run are the ones the review showed (record.plan.testCases). They are derived
  // again only when there is no reviewed list, or the read-only flip above changed what may run.
  let specTestCases: TestCase[] = [];
  let notRun: RunOptions['notRun'] = [];
  let noTests: string | undefined;
  const reviewed = record.plan.testCases?.length ? record.plan.testCases : undefined;
  if (draft) {
    const fresh = testsFor(record.context);
    notRun = fresh.notRun;
    noTests = fresh.noTests;
    if (reviewed && !flippedReadOnly) {
      specTestCases = reviewed;
      noTests = undefined;
    } else if (reviewed && record.context.customTestCases) {
      specTestCases = reviewed;
      noTests = undefined;
    } else {
      specTestCases = fresh.specTestCases;
      record.plan.testCases = specTestCases;
    }
  } else if (reviewed) {
    specTestCases = reviewed;
  }
  if (specTestCases.length === 0) {
    sendJson(res, 409, {
      error: noTests ?? NO_TESTS_FALLBACK,
      code: 'ERR_NO_TESTS',
      noTests: noTests ?? NO_TESTS_FALLBACK,
    });
    return;
  }
  if (draft) {
    record.context.reportNotes = [...(record.context.reportNotes || []), ...handCheckNotes(draft)];
    if (record.context.siteHost && c.siteDir) {
      const memory = await loadSiteMemory(c.siteDir(), record.context.siteHost);
      await saveSiteMemory(
        c.siteDir(),
        rememberRun(memory, record.context.siteHost, draft, {
          reviewed: true,
          answeredByOwner,
          screenSizes: screenSizesOf(record.context),
        })
      );
    }
  }

  record.status = 'approved';
  // The run claims the slot before the save is awaited, so a start with replacePlan cannot take the plan in between.
  const waitingPhase = session.run.phase;
  session.run.setPhase('testing');
  try {
    await session.plan.save(record);
  } catch {
    session.run.setPhase(waitingPhase);
    sendJson(res, 500, { error: PLAN_SAVE_FAILED });
    return;
  }

  sendJson(res, 200, {
    status: 'approved',
    runId: record.plan.runId,
    tests: specTestCases.map((t) => ({ id: t.id, name: t.name })),
  });

  const generation = session.run.generation + 1;
  session.run.setGeneration(generation);
  session.run.setAbortController(new AbortController());
  session.run.setFinishController(new AbortController());
  session.report.setError(null, null);
  session.events.clear();

  if (c.onApproved) {
    c.onApproved(record, specTestCases, notRun, generation);
  }
}

export async function waitingPlans(c: PlanRouteContext): Promise<void> {
  const { session, req, res } = c;
  if (req.method === 'GET') {
    const waiting = await session.plan.waiting();
    const list = waiting.map(({ host, record }) => ({
      host,
      targetUrl: record.plan.targetUrl,
      runId: record.plan.runId,
      discoveredAt: record.plan.discoveredAt,
      pages: record.plan.planPages?.length ?? record.plan.pages.length,
    }));
    sendJson(res, 200, { plans: list.filter((p) => (c.isMine ? c.isMine(p.runId) : true)) });
    return;
  }
  let body: { host?: string } = {};
  try {
    body = await readJsonBody(req);
  } catch {
    // checked below
  }
  if (session.run.phase === 'scanning' || session.run.phase === 'testing') {
    sendJson(res, 409, {
      error: 'A check-up is running. Wait for it to finish, or stop it first.',
      code: 'ERR_RUN_IN_PROGRESS',
    });
    return;
  }
  if (c.isBeta && body.host && c.isMine && !c.isMine(session.plan.parked.get(body.host)?.plan.runId)) {
    sendJson(res, 404, { error: 'There’s no plan kept for that site.' });
    return;
  }
  // The plan now waiting is set aside for the new one. On the shared copy that is only ever the
  // asker's own: someone else's plan is never moved, and nothing is taken out of the kept-aside
  // list until this is known.
  const current = await ensurePlanLoaded(session);
  const waitingNow = current && session.run.phase === 'awaiting-review' ? current : null;
  if (c.isBeta && waitingNow && c.isMine && !c.isMine(waitingNow.plan.runId)) {
    sendJson(res, 409, {
      error: 'Someone else is reviewing a plan on this shared copy. Try again in a few minutes.',
      code: 'ERR_RUN_IN_PROGRESS',
    });
    return;
  }
  const record = body.host ? await session.plan.unpark(body.host) : null;
  if (!record) {
    sendJson(res, 404, { error: 'There’s no plan kept for that site.' });
    return;
  }
  if (waitingNow) await session.plan.park(waitingNow);
  try {
    await session.plan.save(record);
  } catch {
    sendJson(res, 500, { error: PLAN_SAVE_FAILED });
    return;
  }
  session.run.setPhase('awaiting-review');
  session.run.setIsRunning(true);
  session.run.setRunId(record.plan.runId);
  session.run.setTargetUrl(record.plan.targetUrl);
  session.events.clear();
  session.run.setGeneration(session.run.generation + 1);
  const broadcast = c.broadcastRunnerEvent ?? ((event) => session.events.publish(event));
  broadcast({ type: 'PLAN_READY', runId: record.plan.runId, resumed: true, timestamp: Date.now() });
  sendJson(res, 200, { resumed: true, runId: record.plan.runId, targetUrl: record.plan.targetUrl });
}

function toPlanContext(c: RouteContext): PlanRouteContext {
  const anyC = c as any;
  if (anyC.session) {
    return anyC as PlanRouteContext;
  }
  const server = c.server;
  return {
    session: server.session,
    req: c.req,
    res: c.res,
    url: c.url,
    broadcastRunnerEvent: (event) => server.broadcastRunnerEvent(event),
    isMine: (runId) => (server as any).isMine?.(runId) ?? true,
    isBeta: (server as any).beta ?? false,
    aiFor: (context) => (server as any).aiFor?.(context),
    aiBudgetFor: (settings, key, cap) => (server as any).aiBudgetFor?.(settings, key, cap),
    recordModelOutcomes: (models) => (server as any).recordModelOutcomes?.(models),
    refuseTarget: (res, target) => (server as any).refuseTarget?.(res, target),
    siteDir: () => (server as any).siteDir?.() ?? server.session.paths.dataDir,
    testCopyOf: (typed, marked) => (server as any).testCopyOf?.(typed, marked) ?? Promise.resolve(true),
    onApproved: (record, specTestCases, notRun, generation) => {
      (server as any).executeTesting?.(record, specTestCases, notRun, generation);
    },
  };
}

export const planRoutes: readonly Route[] = [
  // GET /api/runner/plan
  {
    method: 'GET',
    path: '/api/runner/plan',
    handle: (c) => getPlan(toPlanContext(c)),
  },

  // PATCH /api/runner/plan
  {
    method: 'PATCH',
    path: '/api/runner/plan',
    handle: (c) => patchPlan(toPlanContext(c)),
  },

  // POST /api/runner/plan/approve
  {
    method: 'POST',
    path: '/api/runner/plan/approve',
    handle: (c) => approvePlan(toPlanContext(c)),
  },

  // POST /api/runner/plan/interpret — a sentence becomes a test or a rule, shown back before it's added
  {
    method: 'POST',
    path: '/api/runner/plan/interpret',
    handle: (c) => interpret(toPlanContext(c)),
  },

  // GET /api/runner/plan/markdown — the whole plan as a Markdown document, for sign-off
  {
    method: 'GET',
    path: '/api/runner/plan/markdown',
    handle: (c) => planMarkdown(toPlanContext(c)),
  },

  // GET /api/runner/plan/export — the approved plan as a Playwright project (zip)
  {
    method: 'GET',
    path: '/api/runner/plan/export',
    handle: (c) => planExport(toPlanContext(c)),
  },

  // Changes that need the AI or the crawler run in the background (202, then PLAN_UPDATE_* events):
  // POST /api/runner/plan/replan — plan an item, a promoted page, or everything again
  {
    method: 'POST',
    path: '/api/runner/plan/replan',
    handle: (c) => replan(toPlanContext(c)),
  },

  // POST /api/runner/plan/add-page — add a page by its address
  {
    method: 'POST',
    path: '/api/runner/plan/add-page',
    handle: (c) => addPage(toPlanContext(c)),
  },

  // GET/POST /api/runner/waiting-plans — plans kept aside for other sites, and bringing one back
  {
    method: '*',
    path: '/api/runner/waiting-plans',
    anyMethod: true,
    handle: (c) => waitingPlans(toPlanContext(c)),
  },

  // POST /api/runner/plan/add-sign-in — sign in as a role, explore what it sees, and plan it
  {
    method: 'POST',
    path: '/api/runner/plan/add-sign-in',
    handle: (c) => addSignIn(toPlanContext(c)),
  },

  // POST /api/runner/plan/include-host — explore another host the site links to, and plan its pages
  {
    method: 'POST',
    path: '/api/runner/plan/include-host',
    handle: (c) => includeHost(toPlanContext(c)),
  },
];
