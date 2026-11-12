import { promises as fs } from 'fs';
import path from 'path';
import type {
  ReleaseReport,
  DiscoveryDraft,
  Breakpoint,
  RoleCredential,
  TestCase,
  AIProviderType,
  RunStartBody,
  ProviderLimits,
  RunCap,
  ProductProfile,
} from '@qa/types';
import {
  emptyPlan,
  defaultTestCase,
  buildPlan,
  testsFor,
  siteMapOf,
  handCheckNotes,
  loadSiteMemory,
  saveSiteMemory,
  emptySiteMemory,
  applySiteMemory,
  rememberRun,
  rememberObservations,
  DiscoveryAgent,
  FlowTestOrchestrator,
  runSafeWebsiteScan,
  Redactor,
  redactUrl,
  applySafeAnswers,
  setBrowserPolicy,
  makeRequestGuard,
  resolvePublic,
  isIpLiteral,
  fetchDocsPages,
  makeGuardedDocsGet,
  localDocsGet,
  isPrivateHost,
  isAbortError,
  SignInFailedError,
  createAIProvider,
  type NetDeps,
  type AIProvider,
  type MemorySummary,
  type RunOptions,
  type SiteMemory,
  type VisualReviewItemInput,
  type ModelRecord,
  type OrchestratorEvent,
} from '@qa/core';
import {
  checkAiCap,
  checkContextDocuments,
  checkContextUrl,
  checkSavedSessions,
  checkTestCap,
  checkCrawlConcurrency,
  checkCrawlDelayMs,
  checkCustomHeaders,
  type InputProblem,
} from '../run-inputs.js';
import { testCopyFor } from '../host-policy.js';
import type { CheckupSession, StoredPlanRecord } from './checkup-session.js';
import { hostOfAddress } from './plan-store.js';

export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
export const ALL_SCREEN_SIZES: Breakpoint[] = ['375px', '768px', '1440px'];

/** What a run is allowed to do, decided by the caller (transport or CLI). */
export interface RunAuthorization {
  readOnly: boolean;
  readOnlyReason: string;
  /** The address is a Test Copy: full testing is allowed (ADRs 0014, 0022). */
  testCopy: boolean;
  owner: boolean;
  signInConsent: boolean;
}

export interface CheckupRun {
  /** Today's handleTriggerRun + executeRun, as one call. Resolves when the run has been claimed and started. */
  start(input: {
    body: RunStartBody;
    authorization: RunAuthorization;
  }): Promise<{ runId: string; awaitingReview: boolean }>;
  /** Today's handleAbortRun. `finish: true` stops after the current stage. */
  stop(input?: {
    finish?: boolean;
    /** Throw away a plan that is waiting for review. Without it, stopping keeps the plan. */
    discard?: boolean;
  }): Promise<{ aborted: boolean; planKept?: boolean; finishing?: boolean }>;
  /** Resolves when the current run is over, or when the deadline passes (today's CLI poll loop). */
  waitFor(deadlineMs: number): Promise<void>;
  /** Executes testing for an approved plan or explicit spec. */
  executeTesting(
    record: StoredPlanRecord,
    specTestCases: TestCase[],
    notRun: RunOptions['notRun'],
    generation: number,
    extra?: { testedWithApprovedPlan?: string }
  ): Promise<void>;
}

export interface RunDeps {
  prepareAI?: (body: RunStartBody) => Promise<{
    provider?: AIProvider;
    models?: { text?: string; vision?: string };
    settings?: StoredPlanRecord['context']['ai'];
    key?: string;
    fallbacks?: string[];
  }>;
  aiBudgetFor?: (
    settings: StoredPlanRecord['context']['ai'],
    key?: string,
    cap?: RunCap
  ) => Promise<
    | {
        left?: number;
        limit?: number;
        visualReview: number;
        pacing: { gapMs: number; concurrency: number; cap?: RunCap; price?: { prompt: number; completion: number } };
        limits: ProviderLimits | null;
      }
    | undefined
  >;
  signInsFor?: (
    body: RunStartBody,
    memory: SiteMemory | null,
    host: string
  ) => Promise<{ roles?: RoleCredential[]; memory: SiteMemory | null; note?: string }>;
  readDefaults?: () => Promise<{ screenSizes?: Breakpoint[] }>;
  siteDir?: () => string;
  hostAliases?: Record<string, string>;
  localhostAlias?: string;
  beta?: boolean;
  hostChecks?: NetDeps;
  stepTimeoutMs?: number;
  onEvent?: (event: OrchestratorEvent | Record<string, unknown>) => void;
  screensForReview?: (report: ReleaseReport, draft?: DiscoveryDraft) => VisualReviewItemInput[];
  visualReview?: (
    report: ReleaseReport,
    screens: VisualReviewItemInput[],
    options: { provider: AIProviderType; apiKey?: string; vision?: string }
  ) => Promise<{ reviewed: number; remaining: number; added: number; note?: string; outOfRequests?: boolean } | null>;
  saveReviewedReport?: (report: ReleaseReport) => Promise<void>;
  recordModelOutcomes?: (models?: ModelRecord) => Promise<void>;
  claimOwner?: (runId: string) => void;
  isMine?: (runId: string | null | undefined) => boolean;
}

/** At least one role has both a username and a password. */
export function hasCompleteSignIn(roles?: Array<{ username?: string; password?: string }>): boolean {
  return (roles ?? []).some((r) => !!r.username && !!r.password);
}

/**
 * Whether a run only looks. Test sign-in details count as consent to full testing on this machine
 * (ADR 0022), never on a shared machine (beta). Per run: never saved.
 */
export function resolveReadOnly(input: {
  beta: boolean;
  owner: boolean;
  /** The request said `owner: true` itself. An omitted owner counts as an owner elsewhere, but never as consent. */
  ownerExplicit: boolean;
  testHost: boolean;
  signInConsent?: unknown;
  roles?: Array<{ username?: string; password?: string }>;
}): { readOnly: boolean; consent: boolean } {
  const consent = !input.beta && input.ownerExplicit && input.signInConsent === true && hasCompleteSignIn(input.roles);
  return { consent, readOnly: !(input.owner && (input.testHost || consent)) };
}

/** Why a run is read-only, in plain words. */
export function readOnlyReason(owner: boolean, testHost: boolean, unverifiedMarked = false): string {
  if (!owner) {
    return 'You didn’t say you own this site, so it’s only looked at: nothing is sent or changed. If it’s yours, start a new check-up and tick “I own this site”.';
  }
  if (!testHost && unverifiedMarked) {
    return 'This address isn’t a verified test copy yet, so it’s only looked at: nothing is sent or changed. Publish the Verified Domain line shown for it, then start a new check-up.';
  }
  if (!testHost) {
    return 'This looks like a live site, so it’s only looked at: nothing is sent or changed. If it’s a test copy of your site, start a new check-up and choose “This is a test copy”.';
  }
  return '';
}

/** The one place that decides read-only, Test Copy and consent. Used by handleTriggerRun and by checkup.ts. */
export async function resolveAuthorization(input: {
  targetUrl: string;
  owner?: boolean;
  ownerExplicit?: boolean;
  signInConsent?: boolean;
  roles?: RoleCredential[];
  testCopyMarked?: boolean;
  stagingHost?: boolean;
  beta?: boolean;
  hostChecks?: NetDeps;
  token?: () => string | undefined;
}): Promise<RunAuthorization> {
  const url = new URL(input.targetUrl);
  const owner = input.owner ?? true;
  const ownerExplicit = input.ownerExplicit ?? input.owner === true;
  const marked = input.testCopyMarked ?? input.stagingHost ?? false;
  const beta = !!input.beta;

  const testCopy = await testCopyFor({
    beta,
    hostname: url.hostname,
    origin: url.origin,
    marked,
    token: input.token ?? (() => undefined),
    deps: input.hostChecks,
  });

  const { readOnly, consent } = resolveReadOnly({
    beta,
    owner,
    ownerExplicit,
    testHost: testCopy,
    signInConsent: input.signInConsent,
    roles: input.roles,
  });

  const reason = readOnlyReason(owner, testCopy, beta && marked);

  return {
    readOnly,
    readOnlyReason: reason,
    testCopy,
    owner,
    signInConsent: consent,
  };
}

/**
 * "Test again" may skip the review only when the scan found nothing the approved plan doesn't
 * already cover: no new page, link, journey or question, and every page as it was when planned.
 */
export function nothingNew(draft: DiscoveryDraft, since: MemorySummary, memory: SiteMemory): boolean {
  if (!since.seenBefore || since.newPages > 0 || since.newJourneys > 0 || since.newQuestions > 0) return false;
  if (draft.plan?.navigation.some((n) => n.isNew)) return false;
  const planned = memory.plan?.pages || {};
  return draft.pages.every((p) => planned[p.urlPath] !== undefined && planned[p.urlPath].contentKey === p.contentKey);
}

/** The keychain account a site's saved sign-in password is kept under. */
export function signInAccount(host: string, role: string): string {
  return `signin:${host.toLowerCase()}:${role}`;
}

/**
 * The address to connect to: a host alias, or localhost mapped to the host machine when the
 * runner itself runs in a container. Everything else is used as typed.
 */
export function resolveTargetUrl(
  targetUrl: string,
  hostAliases: Record<string, string> = {},
  localhostAlias?: string
): string {
  try {
    const u = new URL(targetUrl);
    const alias = hostAliases[u.hostname.toLowerCase()];
    if (alias) u.hostname = alias;
    else if (localhostAlias && LOOPBACK_HOSTS.includes(u.hostname)) u.hostname = localhostAlias;
    else return targetUrl;
    return u.toString();
  } catch {
    return targetUrl;
  }
}

/** "30 September 2026", for sentences in the report. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Redacts secrets from error messages: passwords, tokens, email usernames, custom header values,
 * tunnel authorization, and session cookies. Also strips URL query strings so query secrets never leak.
 */
export function redactedMessage(
  err: unknown,
  extra?: {
    roles?: Array<Partial<RoleCredential>>;
    customHeaders?: Record<string, string>;
    tunnelAuth?: string;
    cookies?: Array<{ name?: string; value?: string }>;
    targetUrl?: string;
  }
): string {
  const raw = err instanceof Error ? err.message : String(err);
  const secrets: Array<Partial<RoleCredential>> = [...(extra?.roles || [])];

  if (extra?.customHeaders) {
    for (const val of Object.values(extra.customHeaders)) {
      if (typeof val === 'string' && val.length >= 3) {
        secrets.push({ token: val });
      }
    }
  }

  if (extra?.tunnelAuth && extra.tunnelAuth.length >= 3) {
    secrets.push({ token: extra.tunnelAuth });
  }

  if (extra?.cookies) {
    for (const c of extra.cookies) {
      if (typeof c.name === 'string' && c.name.length >= 3) {
        secrets.push({ token: c.name });
      }
      if (typeof c.value === 'string' && c.value.length >= 3) {
        secrets.push({ token: c.value });
      }
    }
  }

  if (extra?.targetUrl) {
    try {
      const u = new URL(extra.targetUrl);
      for (const val of u.searchParams.values()) {
        if (typeof val === 'string' && val.length >= 3) {
          secrets.push({ token: val });
        }
      }
    } catch {
      // ignore
    }
  }

  const redactor = new Redactor(secrets);
  let out = redactor.text(raw);
  out = redactUrl(out);
  out = out.replace(/(https?:\/\/[^\s"'<>)]+)\?[^\s"'<>)]*/gi, '$1');
  return out;
}

/**
 * One screen per Layout Group (its first page visited), with its screenshot at each size: what the
 * AI's visual review looks at.
 */
export function screensForReview(
  report: ReleaseReport,
  draft?: DiscoveryDraft,
  runDir?: string
): VisualReviewItemInput[] {
  const groupOf = new Map((draft?.plan?.pages ?? []).map((p) => [p.urlPath, p.layoutGroup || p.urlPath]));
  const byGroup = new Map<string, VisualReviewItemInput>();
  for (const result of report.results) {
    if (result.flowId !== 'page-visit' || !result.breakpoint) continue;
    const shot = [...result.stepEvidence].reverse().find((s) => s.screenshotPath);
    if (!shot?.screenshotPath) continue;
    let urlPath: string;
    try {
      urlPath = new URL(shot.urlAfter || shot.urlBefore).pathname;
    } catch {
      continue;
    }
    const group = groupOf.get(urlPath) ?? urlPath;
    const screen = byGroup.get(group) ?? { layoutGroup: group, urlPath, screenshots: [] };
    byGroup.set(group, screen);
    if (
      screen.urlPath === urlPath &&
      !screen.screenshots.some((s: { breakpoint: string }) => s.breakpoint === result.breakpoint)
    ) {
      screen.screenshots.push({
        breakpoint: result.breakpoint,
        imagePath: runDir ? path.resolve(runDir, shot.screenshotPath) : shot.screenshotPath,
      });
    }
  }
  return [...byGroup.values()];
}

/** Longest a stop waits for the aborted run to tear down (browser closed, cleanup done) before it frees the slot. */
const TEARDOWN_WAIT_MS = 6_000;

function logPlanSaveFailure(err: unknown): void {
  console.warn('[Release check-up] Couldn’t save the plan:', redactedMessage(err));
}

export function createCheckupRun(session: CheckupSession, deps: RunDeps = {}): CheckupRun {
  let currentRunPromise: Promise<void> | null = null;
  /** True from the moment start() is called until it has claimed the slot (or failed). Set before any await. */
  let starting = false;
  let startDone: Promise<void> | null = null;
  const runBusy = () =>
    Object.assign(
      new Error(
        deps.beta
          ? 'Someone else is running a check-up on this shared copy. Try again in a few minutes.'
          : 'Another check-up is running. Wait for it to finish, or stop it first.'
      ),
      { code: 'ERR_RUN_IN_PROGRESS', status: 409 }
    );

  /** A refused input: the same error and code the web route answers with, as a 400. */
  const inputRefused = (problem: InputProblem) =>
    Object.assign(new Error(problem.error), { code: problem.code, status: 400 });

  const valueOf = <T>(checked: { ok: true; value: T } | { ok: false; problem: InputProblem }): T => {
    if (!checked.ok) throw inputRefused(checked.problem);
    return checked.value;
  };

  const hostnameOf = (url?: string): string => {
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  };

  const broadcast = (event: OrchestratorEvent | Record<string, unknown>): void => {
    // RUN_COMPLETED is logged and streamed without its report (the page fetches that). One object for both,
    // so the stream finds the id the log gave it.
    const logged: OrchestratorEvent | Record<string, unknown> =
      event.type === 'RUN_COMPLETED' ? { type: event.type, runId: (event as { runId?: string }).runId } : event;
    session.events.publish(logged as Record<string, unknown>);
    if (deps.onEvent) deps.onEvent(logged);
  };

  const forwardRunEvent = (event: OrchestratorEvent): void => {
    if (event.type === 'RUN_COMPLETED') session.report.set(event.report);
    broadcast(event);
  };

  const getSiteDir = (): string => {
    return deps.siteDir ? deps.siteDir() : session.paths.dataDir;
  };

  const executeTesting = async (
    record: StoredPlanRecord,
    specTestCases: TestCase[],
    notRun: RunOptions['notRun'],
    generation: number,
    extra: { testedWithApprovedPlan?: string } = {}
  ): Promise<void> => {
    const { context } = record;
    const current = () => generation === session.run.generation;

    session.run.setPhase('testing');
    session.run.setIsRunning(true);
    session.run.setTargetUrl(record.plan.targetUrl || session.run.targetUrl);

    broadcast({
      type: 'TESTING_STARTED',
      runId: context.runId,
      testCaseCount: specTestCases.length,
      timestamp: Date.now(),
    });

    const runDir = session.report.dirFor(context.runId);
    await fs.mkdir(runDir, { recursive: true });
    const runAuthDir = session.secrets.authDirFor(context.runId);
    await fs.mkdir(runAuthDir, { recursive: true, mode: 0o700 });

    const orchestrator = new FlowTestOrchestrator();
    let report: ReleaseReport;
    try {
      report = await orchestrator.run({
        targetUrl: context.targetUrl,
        productId: context.productId,
        specTestCases,
        profile: context.profile,
        headless: context.headless ?? true,
        outputDir: runDir,
        authDir: runAuthDir,
        customHeaders: context.customHeaders || session.secrets.headers,
        userAgent: context.userAgent || session.secrets.userAgent,
        tunnelAuth: context.tunnelAuth || session.secrets.tunnelAuth,
        headerHosts: context.headerHosts || session.secrets.headerHosts,
        preflight: context.preflight,
        stateDir: session.paths.outputDir,
        evidenceUrlPrefix: `/api/evidence/runs/${context.runId}/`,
        dataDir: session.paths.dataDir,
        signal: session.run.abortController()?.signal,
        finishSignal: session.run.finishController()?.signal,
        breakpoints: context.breakpoints || ['375px', '768px', '1440px'],
        repoRoot: process.cwd(),
        runId: context.runId,
        reportNotes: context.reportNotes,
        aiModels: context.aiModels,
        readOnly: context.readOnly,
        requireSignIn: context.signInConsent && !context.readOnly ? true : undefined,
        pageCoverage: context.pageCoverage ?? context.draft?.exploration?.pageCoverage,
        notRun,
        suppliedSessions: session.secrets.savedSessions.get(context.runId),
        documentedNotFound: context.draft?.plan?.notFound?.map((n) => ({ docSource: n.docSource, reason: n.reason })),
        siteMap: context.draft
          ? siteMapOf(context.draft, context.runId, (file) => session.report.relativePath(context.runId, file))
          : undefined,
        testedWithApprovedPlan: extra.testedWithApprovedPlan,
        searchChecks: context.searchChecks,
        visibility: context.visibility,
        stepTimeoutMs: deps.stepTimeoutMs,
        onEvent: (event) => {
          if (current()) forwardRunEvent(event);
        },
      });
    } catch (err) {
      if (!current() || isAbortError(err)) return;
      if (!context.draft || session.plan.currentRecord !== record) {
        await session.plan.clear(context.runId);
        throw err;
      }
      const msg = redactedMessage(err, {
        roles: context.profile?.roles,
        customHeaders: context.customHeaders || session.secrets.headers,
        tunnelAuth: context.tunnelAuth || session.secrets.tunnelAuth,
        targetUrl: context.targetUrl,
      });
      await session.plan.save(record).catch(logPlanSaveFailure);
      session.run.setPhase('awaiting-review');
      session.run.setIsRunning(true);
      session.report.setError(msg, 'ERR_TEST_EXECUTION_FAILED');
      broadcast({
        type: 'RUN_FAILED',
        runId: context.runId,
        error: msg,
        code: 'ERR_TEST_EXECUTION_FAILED',
        planKept: true,
        timestamp: Date.now(),
      });
      return;
    }

    if (!current()) return;
    record.status = 'done';
    await session.plan.save(record).catch(logPlanSaveFailure);
    if (context.runId) {
      session.secrets.savedSessions.delete(context.runId);
      await session.secrets.clean(context.runId);
    }
    session.plan.set(null);

    if (context.siteHost && context.draft) {
      const memory = await loadSiteMemory(getSiteDir(), context.siteHost);
      if (memory) {
        rememberObservations(memory, context.draft, report);
        await saveSiteMemory(getSiteDir(), memory).catch(() => {});
      }
    }

    report.aiUsage = context.draft?.plan?.budget?.tokens;
    const coverage = context.pageCoverage ?? context.draft?.exploration?.pageCoverage;
    if (coverage) report.pageCoverage = coverage;

    if (context.draft && context.ai && context.ai.provider !== 'mock') {
      const screens = deps.screensForReview
        ? deps.screensForReview(report, context.draft)
        : screensForReview(report, context.draft, runDir);
      if (screens.length > 0 && deps.visualReview) {
        broadcast({
          type: 'VISUAL_REVIEW_STARTED',
          runId: context.runId,
          screens: screens.length,
          timestamp: Date.now(),
        });
        const reviewed = await deps
          .visualReview(report, screens, {
            provider: context.ai.provider,
            apiKey: context.ai.apiKey,
            vision: context.aiModels?.vision,
          })
          .catch(() => null);
        if (!current()) return;
        if (!reviewed) {
          report.notes = [
            ...(report.notes || []),
            'Looks and reads well wasn’t fully checked: no AI model that reads screenshots is set up. Choose one in Settings.',
          ];
        } else if (reviewed.remaining > 0) {
          report.notes = [
            ...(report.notes || []),
            reviewed.outOfRequests
              ? `The AI’s visual review looked at ${reviewed.reviewed} of ${screens.length} screens before today’s AI requests ran out. Finish it from the report when requests are available again.`
              : `The AI’s visual review stopped after ${reviewed.reviewed} of ${screens.length} screens because the AI service didn’t answer. Finish it from the report later.`,
          ];
        }
        if (reviewed && deps.saveReviewedReport) await deps.saveReviewedReport(report);
      }
    }

    const creds = context.profile?.roles || [];
    const activeHeaders = context.customHeaders || session.secrets.headers;
    const headerSecrets: Array<Partial<RoleCredential>> = [];
    if (activeHeaders) {
      for (const val of Object.values(activeHeaders)) {
        if (typeof val === 'string' && val.length >= 3) {
          headerSecrets.push({ token: val });
        }
      }
    }
    const activeTunnel = context.tunnelAuth || session.secrets.tunnelAuth;
    if (activeTunnel && activeTunnel.length >= 3) {
      headerSecrets.push({ token: activeTunnel });
    }
    await new Redactor([...creds, ...headerSecrets]).files(runDir);

    await session.report
      .keep(report, record.plan.targetUrl || context.targetUrl, context.siteHost)
      .catch((err) => console.warn('[Release check-up] Couldn’t keep the run’s report:', redactedMessage(err)));
    session.report.set(report);
    session.secrets.savedSessions.delete(context.runId);
    session.run.setPhase('done');
    session.run.setIsRunning(false);
    session.run.setTargetUrl(null);
  };

  const executeRun = async (
    body: RunStartBody,
    productId: string,
    runId: string,
    generation: number,
    authorization: RunAuthorization,
    signal?: AbortSignal,
    finishSignal?: AbortSignal
  ): Promise<void> => {
    const targetUrl = resolveTargetUrl(body.targetUrl, deps.hostAliases, deps.localhostAlias);
    const runDir = session.report.dirFor(runId);
    const current = () => generation === session.run.generation;

    if (body.mode === 'safe-public') {
      try {
        session.run.setPhase('scanning');
        const report = await runSafeWebsiteScan({
          targetUrl,
          productId: body.productId,
          outputDir: runDir,
          runId,
          headless: body.headless ?? true,
          onEvent: (event) => {
            if (current()) forwardRunEvent(event);
          },
        });
        if (!current()) return;
        session.report.set(report);
        await session.report.keep(report, body.targetUrl, undefined).catch(() => {});
        session.run.setPhase('done');
      } catch (err) {
        if (current()) session.run.setPhase('failed');
        throw err;
      } finally {
        if (current()) session.run.setIsRunning(false);
      }
      return;
    }

    try {
      const typed = new URL(body.targetUrl);
      const siteHost = typed.host;
      let memory = await loadSiteMemory(getSiteDir(), siteHost);

      if (body.stagingHost !== undefined || body.owner !== undefined || body.searchChecks !== undefined) {
        memory = {
          ...(memory ?? emptySiteMemory(siteHost)),
          ...(body.stagingHost !== undefined ? { staging: body.stagingHost || undefined } : {}),
          ...(body.owner !== undefined && !(body.signInConsent === true && !deps.beta) ? { owner: body.owner } : {}),
          ...(body.searchChecks !== undefined ? { searchChecks: body.searchChecks } : {}),
        };
        await saveSiteMemory(getSiteDir(), memory);
      }

      const signIns = deps.signInsFor
        ? await deps.signInsFor(body, memory, siteHost)
        : { roles: body.roles, memory, note: undefined };
      if (signIns.memory && signIns.memory !== memory) {
        memory = signIns.memory;
        await saveSiteMemory(getSiteDir(), signIns.memory);
      }

      const sessionRoles = Object.keys(session.secrets.savedSessions.get(runId) ?? {});
      const allRoles: RoleCredential[] = [
        ...(signIns.roles ?? []),
        ...sessionRoles
          .filter((r) => !signIns.roles?.some((x) => x.role === r))
          .map((r) => ({ role: r, username: '' })),
      ];
      const profile: ProductProfile | undefined = allRoles.length
        ? { name: productId, productId, roles: allRoles }
        : undefined;

      const breakpoints: Breakpoint[] =
        (body.breakpoints as Breakpoint[] | undefined) ||
        (body.testAgain && memory?.plan?.screenSizes?.length ? memory.plan.screenSizes : undefined) ||
        (deps.readDefaults ? (await deps.readDefaults()).screenSizes : undefined) ||
        ALL_SCREEN_SIZES;
      const urlFirst = body.owner !== undefined;
      const { readOnly, signInConsent: consent, testCopy: testHost } = authorization;

      if (deps.beta) {
        const checked = await resolvePublic(typed.hostname, deps.hostChecks);
        setBrowserPolicy({
          guard: makeRequestGuard(deps.hostChecks),
          pinned: checked.ok && !isIpLiteral(typed.hostname) ? { [typed.hostname]: checked.address } : undefined,
        });
      } else {
        // Same alias the runner's own requests use, so the browser reaches a live-looking host on this machine too.
        const alias = deps.hostAliases?.[typed.hostname.toLowerCase()];
        setBrowserPolicy(
          alias ? { pinned: { [typed.hostname]: LOOPBACK_HOSTS.includes(alias) ? '127.0.0.1' : alias } } : null
        );
      }

      const searchChecks = body.searchChecks ?? memory?.searchChecks ?? (urlFirst ? !testHost : true);
      const visibility =
        (body.visibility as { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean } | undefined) ??
        (searchChecks
          ? { search: true, answers: true, aiSearch: true, marketing: true }
          : { search: false, answers: false, aiSearch: false, marketing: false });

      const aiCap = checkAiCap(body.aiCap);
      const context: StoredPlanRecord['context'] = {
        targetUrl,
        productId,
        runId,
        profile,
        breakpoints,
        headless: body.headless ?? true,
        releaseTarget: body.releaseTarget,
        draft: undefined as unknown as DiscoveryDraft,
        readOnly,
        signInConsent: consent && !readOnly ? true : undefined,
        siteHost,
        productContext: body.productContext,
        designNotes: body.designNotes,
        searchChecks,
        visibility,
        aiCap: valueOf(aiCap),
        testCap: checkTestCap(body.testCap),
        customHeaders: session.secrets.headers,
        userAgent: body.userAgent,
        tunnelAuth: body.tunnelAuth,
        headerHosts: body.headerHosts,
      };

      if (body.specTestCases && body.specTestCases.length > 0) {
        await executeTesting({ plan: emptyPlan(runId, body.targetUrl), context }, body.specTestCases, [], generation);
        return;
      }
      if (!body.useAI && !urlFirst) {
        // No plan exists here, so there is nothing to test. The home page is still opened once, and the
        // report says so instead of passing it off as a checked journey (T-35 decision).
        context.reportNotes = [
          ...(context.reportNotes || []),
          'Nothing to test: no plan was made, so only the home page was opened to see that the site responds. This is not a checked journey.',
        ];
        await executeTesting({ plan: emptyPlan(runId, body.targetUrl), context }, [defaultTestCase()], [], generation);
        return;
      }

      const prepareAIFn =
        deps.prepareAI ??
        (async (
          b
        ): Promise<{
          provider?: AIProvider;
          models?: { text?: string; vision?: string };
          settings?: StoredPlanRecord['context']['ai'];
          key?: string;
          fallbacks?: string[];
        }> => {
          if (!b.useAI) return {};
          const p = b.aiProvider || 'openrouter';
          const k = b.apiKey;
          const m = b.aiModel;
          return {
            provider: createAIProvider(p, k || 'mock-key', undefined, m),
            models: m ? { text: m } : undefined,
            settings: { provider: p, model: m, apiKey: k },
            key: k,
            fallbacks: undefined,
          };
        });

      // A no-AI run must not need a key: forcing useAI here made it fail with ERR_NO_AI_KEY when none is saved.
      const ai = await prepareAIFn(body);
      context.aiModels = ai.models;
      context.ai = ai.settings;
      if (body.planWithoutAI) ai.provider = undefined;
      const aiBudget =
        ai.provider && deps.aiBudgetFor ? await deps.aiBudgetFor(ai.settings, ai.key, context.aiCap) : undefined;
      if (!current()) return;

      await fs.mkdir(runDir, { recursive: true });
      const runAuthDir = session.secrets.authDirFor(runId);
      await fs.mkdir(runAuthDir, { recursive: true, mode: 0o700 });

      const docsNotes: string[] = [];
      const documents: Array<{ name: string; text: string }> = [];
      const checkedDocs = checkContextDocuments(body.contextDocuments);
      const docs = valueOf(checkedDocs);
      if (docs) documents.push(...docs);
      const docsUrl = checkContextUrl(body.contextUrl);
      const url = valueOf(docsUrl);
      if (url) {
        const guarded = deps.beta || !isPrivateHost(typed.hostname);
        const fetched = await fetchDocsPages(url, {
          get: guarded ? makeGuardedDocsGet(deps.hostChecks) : localDocsGet,
        }).catch(() => null);
        if (!fetched) {
          docsNotes.push('The docs address couldn’t be read, so the Product Context comes from your files only.');
        } else {
          documents.push(...fetched.docs);
          if (fetched.docs.length === 0) {
            docsNotes.push(
              `No pages could be read from the docs address${fetched.skipped[0] ? ` (${fetched.skipped[0].why})` : ''}.`
            );
          } else if (fetched.skipped.length > 0) {
            docsNotes.push(
              `${fetched.skipped.length} docs page(s) were left out (for example: ${fetched.skipped[0].why}).`
            );
          }
        }
      }
      if (!current()) return;

      let contextFilePath: string | undefined;
      const contextText = documents.length
        ? [body.productContext?.trim(), ...documents.map((d) => `# Document: ${d.name}\n${d.text}`)]
            .filter(Boolean)
            .join('\n\n')
        : body.productContext;
      if (documents.length) {
        context.contextDocuments = documents;
        context.productContext = contextText;
      }
      if (contextText?.trim()) {
        contextFilePath = path.join(runDir, 'product-context.md');
        await fs.writeFile(contextFilePath, contextText, 'utf8');
        context.contextFilePath = contextFilePath;
      }

      session.run.setPhase('scanning');
      broadcast({ type: 'DISCOVERY_STARTED', runId, timestamp: Date.now() });
      const outcome = await new DiscoveryAgent().discoverWithSession({
        targetUrl,
        productId,
        profile,
        contextFilePath,
        contextDocuments: documents.length ? documents : undefined,
        suppliedSessions: session.secrets.savedSessions.get(runId),
        aiPacing: aiBudget?.pacing,
        outputDir: runDir,
        authDir: runAuthDir,
        signal,
        finishSignal,
        aiProvider: ai.provider,
        readOnly,
        requireSignIn: consent ? true : undefined,
        maxPages:
          typeof body.maxPages === 'number' && body.maxPages > 0
            ? Math.min(Math.floor(body.maxPages), 1000)
            : undefined,
        crawlConcurrency: checkCrawlConcurrency(body.crawlConcurrency),
        crawlDelayMs: checkCrawlDelayMs(body.crawlDelayMs),
        customHeaders: session.secrets.headers,
        userAgent: body.userAgent,
        tunnelAuth: body.tunnelAuth,
        headerHosts: body.headerHosts,
        aiBudget,
        aiModels: { model: ai.models?.text, fallbacks: ai.fallbacks },
        onProgress: (progress) => {
          if (current()) broadcast({ type: 'DISCOVERY_PROGRESS', runId, ...progress, timestamp: Date.now() });
        },
        remembered: body.replanAll ? undefined : memory?.plan,
      });
      if (!current()) return;

      const draft = outcome.draft;
      context.preflight = outcome.preflight;
      if (deps.recordModelOutcomes) await deps.recordModelOutcomes(draft.plan?.budget?.models);
      const sinceLastRun = applySiteMemory(draft, memory);
      context.draft = draft;
      if (body.planWithoutAI && draft.exploration) {
        draft.exploration.notes = [
          'Planned with fixed rules, as you chose, so no AI requests were used. Re-plan any item with the AI when you have requests to spare.',
          ...draft.exploration.notes.filter((n) => !n.startsWith('No AI key is set up')),
        ];
      }
      if (docsNotes.length && draft.exploration) draft.exploration.notes = [...draft.exploration.notes, ...docsNotes];
      context.reportNotes = [...(draft.exploration?.notes || []), ...(signIns.note ? [signIns.note] : [])];
      if (consent && !readOnly) {
        context.reportNotes.push(
          'Tested with the sign-in details you gave, as you agreed: forms were filled in and sent. Pages that need no sign-in (such as sign-up or contact) were tested signed out, after the sign-in succeeded. Sensitive Actions (such as deleting or paying) were still skipped.'
        );
      }
      context.pageCoverage = draft.exploration?.pageCoverage;
      broadcast({
        type: 'DISCOVERY_COMPLETED',
        runId,
        flowsFound: draft.flows.length,
        timestamp: Date.now(),
      });

      const record: StoredPlanRecord = { plan: emptyPlan(runId, body.targetUrl), context };
      record.plan = buildPlan({
        context,
        targetUrl: body.targetUrl,
        sinceLastRun,
        aiAvailable: !!ai.provider,
        reason: authorization.readOnlyReason,
        relative: (file?: string) => session.report.relativePath(context.runId, file),
      });

      const approvedAt = memory?.planApprovedAt;
      if (body.testAgain && approvedAt && memory && nothingNew(draft, sinceLastRun, memory)) {
        applySafeAnswers(record.plan.questions);
        applySafeAnswers(draft.ambiguityQuestions);
        await saveSiteMemory(getSiteDir(), rememberRun(memory, siteHost, draft, { reviewed: false }));
        const { specTestCases, notRun } = testsFor(record.context);
        record.plan.testCases = specTestCases;
        await session.plan.save(record);
        context.reportNotes.push(...handCheckNotes(draft));
        context.reportNotes.push(
          `Nothing on the site had changed since the plan was approved on ${formatDay(approvedAt)}, so it was tested as approved, without a new review.`
        );
        await executeTesting(record, specTestCases, notRun, generation, { testedWithApprovedPlan: approvedAt });
        return;
      }

      if (body.skipReview === false || body.testAgain) {
        await session.plan.save(record);
        session.run.setPhase('awaiting-review');
        broadcast({
          type: 'PLAN_READY',
          runId,
          pageCount: draft.pages.length,
          flowCount: draft.flows.length,
          questionCount: draft.ambiguityQuestions.length,
          changedSinceApproval: body.testAgain ? true : undefined,
          timestamp: Date.now(),
        });
        return;
      }

      applySafeAnswers(draft.ambiguityQuestions);
      await saveSiteMemory(getSiteDir(), rememberRun(memory, siteHost, draft, { reviewed: false }));
      const { specTestCases, notRun } = testsFor(record.context);
      context.reportNotes.push(...handCheckNotes(draft));
      await executeTesting(record, specTestCases, notRun, generation);
    } catch (err) {
      if (current() && !isAbortError(err)) {
        session.run.setPhase('failed');
        session.run.setIsRunning(false);
      }
      throw err;
    } finally {
      if (session.run.phase !== 'awaiting-review') {
        await session.secrets.clean(runId);
      }
    }
  };

  return {
    async start(input: {
      body: RunStartBody;
      authorization: RunAuthorization;
    }): Promise<{ runId: string; awaitingReview: boolean }> {
      const { body, authorization } = input;
      // Checked and set before the first await: a second start while this one is still starting is refused.
      if (starting || (session.run.isRunning && session.run.phase !== 'awaiting-review')) throw runBusy();
      for (const checked of [
        checkContextDocuments(body.contextDocuments),
        checkContextUrl(body.contextUrl),
        checkAiCap(body.aiCap),
        checkCustomHeaders(body.customHeaders),
        checkSavedSessions(body.savedSessions, hostnameOf(body.targetUrl)),
      ]) {
        if (!checked.ok) throw inputRefused(checked.problem);
      }
      starting = true;
      let finishStarting!: () => void;
      startDone = new Promise<void>((resolve) => (finishStarting = resolve));
      try {
        return await startRun(body, authorization);
      } finally {
        starting = false;
        startDone = null;
        finishStarting();
      }
    },

    async stop(input?: {
      finish?: boolean;
      discard?: boolean;
    }): Promise<{ aborted: boolean; planKept?: boolean; finishing?: boolean }> {
      // A stop that arrives while a run is still starting waits for the start, then stops that run.
      if (starting && startDone) await startDone;
      return stopRun(input);
    },

    async waitFor(deadlineMs: number): Promise<void> {
      if (!currentRunPromise && !session.run.isRunning) return;
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, deadlineMs));
      });
      try {
        await Promise.race([currentRunPromise ?? Promise.resolve(), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },

    // Tracked like a run started here, so a stop waits for its teardown before freeing the slot.
    executeTesting: (...args: Parameters<typeof executeTesting>) => {
      const run = executeTesting(...args);
      currentRunPromise = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };

  async function startRun(
    body: RunStartBody,
    authorization: RunAuthorization
  ): Promise<{ runId: string; awaitingReview: boolean }> {
    {
      await session.plan.current();
      const waiting = session.run.phase === 'awaiting-review' ? session.plan.currentRecord : null;
      const othersPlan = !!deps.beta && !!waiting && (deps.isMine ? !deps.isMine(waiting.plan.runId) : false);
      // On the shared copy another tester's waiting plan is never moved: the start is refused instead.
      if (othersPlan) throw runBusy();
      const parkWaiting = !!waiting && session.plan.hostOf(waiting) !== hostOfAddress(body.targetUrl);
      if (waiting && !parkWaiting && !body.replacePlan) {
        let waitingFor = waiting.plan.targetUrl;
        try {
          waitingFor = new URL(waitingFor).host;
        } catch {}
        const err = Object.assign(
          new Error(
            `The plan for ${waitingFor} is waiting for your review. Starting a new check-up of it throws that plan away.`
          ),
          {
            code: 'ERR_PLAN_WAITING',
            status: 409,
            suggestion: 'Open the plan to finish reviewing it, or start again to replace it.',
            targetUrl: waiting.plan.targetUrl,
          }
        );
        throw err;
      }

      if (parkWaiting && waiting) await session.plan.park(waiting);
      await session.plan.unpark(hostOfAddress(body.targetUrl));
      await session.plan.clear();

      const productId = body.productId || 'default-product';
      const runId = `run-${Date.now()}`;
      if (deps.claimOwner) deps.claimOwner(runId);

      // begin() refuses when a run holds the slot; the start never goes on without it.
      if (!session.run.begin(runId, body.targetUrl)) throw runBusy();
      session.run.setPhase('scanning');
      session.report.setError(null, null);

      const abortController = new AbortController();
      const finishController = new AbortController();
      session.run.setAbortController(abortController);
      session.run.setFinishController(finishController);

      session.events.clear();
      const generation = session.run.generation;

      const typedHostname = hostnameOf(body.targetUrl);
      const customHeadersChecked = checkCustomHeaders(body.customHeaders);
      const sessions = checkSavedSessions(body.savedSessions, typedHostname);
      const savedSessions = valueOf(sessions);
      if (savedSessions) session.secrets.savedSessions.set(runId, savedSessions);
      delete body.savedSessions;

      session.secrets.set({
        headers: valueOf(customHeadersChecked),
        tunnelAuth: body.tunnelAuth,
        headerHosts: body.headerHosts,
        userAgent: body.userAgent,
      });

      const runPromise = executeRun(
        body,
        productId,
        runId,
        generation,
        authorization,
        abortController.signal,
        finishController.signal
      ).catch((err: unknown) => {
        if (generation !== session.run.generation || isAbortError(err)) return;
        session.secrets.savedSessions.delete(runId);
        const msg = redactedMessage(err, {
          roles: body.roles,
          customHeaders: session.secrets.headers,
          tunnelAuth: session.secrets.tunnelAuth,
          targetUrl: session.run.targetUrl || undefined,
        });
        const code = (err as { code?: string } | undefined)?.code || 'ERR_DISCOVERY_FAILED';
        session.report.setError(msg, code);
        session.run.setPhase('failed');
        session.run.setIsRunning(false);
        const signInReason = err instanceof SignInFailedError ? err.reason : undefined;
        broadcast({
          type: 'RUN_FAILED',
          runId,
          error: msg,
          code,
          ...(signInReason ? { signInReason } : {}),
          timestamp: Date.now(),
        });
      });

      currentRunPromise = runPromise;

      return { runId, awaitingReview: false };
    }
  }

  /** Waits, up to TEARDOWN_WAIT_MS, for the current run's promise to settle. A run that is stuck is logged and left. */
  async function waitForTeardown(): Promise<void> {
    const pending = currentRunPromise;
    if (!pending) return;
    let timer: NodeJS.Timeout | undefined;
    const cap = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn('[Release check-up] The stopped check-up did not finish tearing down in time; freeing the slot.');
        resolve();
      }, TEARDOWN_WAIT_MS);
    });
    try {
      await Promise.race([pending.catch(() => {}), cap]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function stopRun(input?: {
    finish?: boolean;
    discard?: boolean;
  }): Promise<{ aborted: boolean; planKept?: boolean; finishing?: boolean }> {
    {
      const runId = session.run.runId;
      const finishCtrl = session.run.finishController();
      if (input?.finish && (session.run.phase === 'scanning' || session.run.phase === 'testing') && finishCtrl) {
        finishCtrl.abort();
        broadcast({
          type: 'RUN_FINISHING',
          runId: runId ?? undefined,
          phase: session.run.phase,
          timestamp: Date.now(),
        });
        return { aborted: false, finishing: true };
      }
      // Nothing is running (idle, or a Check-up that already ended): leave its result and error as they are.
      if (!session.run.isRunning) {
        return { aborted: false };
      }
      // Nothing is running while a plan waits for review. Stop keeps that plan; only an explicit discard clears it.
      if (session.run.phase === 'awaiting-review' && !input?.discard) {
        return { aborted: false, planKept: true };
      }

      session.run.setGeneration(session.run.generation + 1);
      const activeCtrl = session.run.abortController();
      if (activeCtrl) {
        try {
          activeCtrl.abort();
        } catch {}
        session.run.setAbortController(null);
      }

      const record = session.plan.currentRecord;
      const planKept = session.run.phase === 'testing' && !!record && record.plan.runId === runId;
      if (planKept) {
        session.run.setPhase('awaiting-review');
        session.run.setIsRunning(true);
        await session.plan.save(record!).catch(logPlanSaveFailure);
      }

      // The slot stays held (isRunning) until the aborted run has torn down, so a start cannot overlap it.
      await waitForTeardown();

      if (!planKept) {
        session.run.setIsRunning(false);
        session.run.setPhase('idle');
        session.run.setTargetUrl(null);
        await session.plan.clear(runId ?? undefined);
      }
      session.report.setError('Run was manually stopped by user.', 'ERR_RUN_ABORTED');

      broadcast({
        type: 'RUN_ABORTED',
        runId: runId ?? undefined,
        planKept,
        code: 'ERR_RUN_ABORTED',
        message: 'Run was stopped by the user.',
        timestamp: Date.now(),
      });

      return { aborted: true, planKept, finishing: false };
    }
  }
}
