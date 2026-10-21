import path from 'path';
import { promises as fs } from 'fs';
import type { Breakpoint, DiscoveryDraft, ProductProfile, RoleCredential, RunStartBody } from '@qa/types';
import {
  emptyPlan,
  defaultTestCase,
  buildPlan,
  testsFor,
  handCheckNotes,
  loadSiteMemory,
  saveSiteMemory,
  emptySiteMemory,
  applySiteMemory,
  rememberRun,
  DiscoveryAgent,
  runSafeWebsiteScan,
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
  createAIProvider,
  type AIProvider,
} from '@qa/core';
import {
  checkAiCap,
  checkContextDocuments,
  checkContextUrl,
  checkTestCap,
  checkCrawlConcurrency,
  checkCrawlDelayMs,
} from '../run-inputs.js';
import { ALL_SCREEN_SIZES, LOOPBACK_HOSTS, formatDay, nothingNew, resolveTargetUrl, timingRequested } from './checkup-run-helpers.js';
import type { CheckupRun, RunAuthorization, RunContext } from './checkup-run-types.js';
import type { StoredPlanRecord } from './checkup-session.js';

/** One run from start to keep: scan, plan, then testing (or the wait for review). */
export function createExecuteRun(
  ctx: RunContext,
  executeTesting: CheckupRun['executeTesting']
): (
  body: RunStartBody,
  productId: string,
  runId: string,
  generation: number,
  authorization: RunAuthorization,
  signal?: AbortSignal,
  finishSignal?: AbortSignal
) => Promise<void> {
  const { session, deps, broadcast, forwardRunEvent, getSiteDir, discoveryTimings } = ctx;

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
        deps.afterKeep?.(runId);
        session.run.setPhase('done');
      } catch (err) {
        if (current()) session.run.setPhase('failed');
        throw err;
      } finally {
        if (current()) session.run.setIsRunning(false);
      }
      return;
    }

    let testingBegun = false;
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
      const { readOnly, signInConsent: consent, testCopy: testHost, owner } = authorization;

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
        ...(body.recordVideo !== undefined ? { recordVideo: body.recordVideo } : {}),
        siteHost,
        productContext: body.productContext,
        designNotes: body.designNotes,
        searchChecks,
        visibility,
        aiCap: aiCap.ok ? aiCap.value : undefined,
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
      if (checkedDocs.ok && checkedDocs.value) documents.push(...checkedDocs.value);
      const docsUrl = checkContextUrl(body.contextUrl);
      if (docsUrl.ok && docsUrl.value) {
        const guarded = deps.beta || !isPrivateHost(typed.hostname);
        const fetched = await fetchDocsPages(docsUrl.value, {
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
        timing: timingRequested(),
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
      if (outcome.timing) discoveryTimings.set(runId, outcome.timing);
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
        testingBegun = true;
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
      testingBegun = true;
      await executeTesting(record, specTestCases, notRun, generation);
    } catch (err) {
      if (current() && !isAbortError(err)) {
        session.run.setPhase('failed');
        session.run.setIsRunning(false);
      }
      throw err;
    } finally {
      // Before testing, a plan of this run still waiting for review keeps its sign-in; every other exit removes it.
      const keptForReview =
        !testingBegun && session.run.phase === 'awaiting-review' && session.plan.currentRecord?.plan.runId === runId;
      if (!keptForReview) {
        session.secrets.savedSessions.delete(runId);
        await session.secrets.clean(runId);
      }
    }
  };

  return executeRun;
}
