import fs from 'fs/promises';
import path from 'path';
import type {
  ReviewPlan,
  PageLink,
  RoleCredential,
  ProductProfile,
  ReleaseReport,
  Breakpoint,
  DiscoveryDraft,
  RunCap,
  AIProviderType,
} from '@qa/types';
import { normalizePlanIntents, normalizeTestIntents } from '@qa/types';
import { writeJsonAtomic, readJsonSafe, Redactor, type PreFlightResult } from '@qa/core';
import type { RunSecrets } from './run-secrets.js';

export interface StoredPlanRecord {
  /** Document schema version: missing or 0 = legacy, 1 = current. Higher = read-only. */
  schemaVersion?: number;
  /** Current state of the plan: awaiting-review, approved, or done. */
  status?: 'awaiting-review' | 'approved' | 'done';
  plan: ReviewPlan;
  context: {
    targetUrl: string;
    productId: string;
    runId: string;
    profile?: ProductProfile;
    reportNotes?: string[];
    pageCoverage?: ReleaseReport['pageCoverage'];
    aiModels?: { text?: string; vision?: string };
    breakpoints?: Breakpoint[];
    headless?: boolean;
    releaseTarget?: string;
    draft: DiscoveryDraft;
    signInNotSaved?: string[];
    sessionNotSaved?: string[];
    contextDocuments?: Array<{ name: string; text: string }>;
    aiCap?: RunCap;
    testCap?: number;
    readOnly?: boolean;
    signInConsent?: boolean;
    recordVideo?: boolean;
    siteHost?: string;
    ai?: { provider: AIProviderType; model?: string; apiKey?: string };
    customTestCases?: boolean;
    productContext?: string;
    searchChecks?: boolean;
    visibility?: { search: boolean; answers: boolean; aiSearch: boolean; marketing: boolean };
    designNotes?: string;
    contextFilePath?: string;
    customHeaders?: Record<string, string>;
    customHeaderNames?: string[];
    userAgent?: string;
    tunnelAuth?: string;
    headerHosts?: string[];
    preflight?: PreFlightResult;
  };
}

export interface PlanStore {
  /** Where the Plan under review is written (today's `planFile`). */
  readonly file: string;
  /** Current in-memory record, synchronous. */
  readonly currentRecord: StoredPlanRecord | null;
  /** Parked plans in memory by host. */
  readonly parked: ReadonlyMap<string, StoredPlanRecord>;
  /** The Plan awaiting review, read from disk once (today's `ensurePlanLoaded`). */
  current(): Promise<StoredPlanRecord | null>;
  /** Replace the in-memory record; `null` clears it. */
  set(record: StoredPlanRecord | null): void;
  /** Write the record to disk as it is (today's `savePlan`). */
  save(record: StoredPlanRecord): Promise<void>;
  /** Forget the Plan, and its file (today's `clearPlan`). */
  clear(runId?: string): Promise<void>;
  /** The host a record belongs to (today's `hostOfPlan`). */
  hostOf(record: StoredPlanRecord): string;
  /** The waiting-Plan file for a host (today's `parkedFile`). */
  parkedFileFor(host: string): string;
  /** Park a record for its host (today's `parkPlan`) and read the parked ones (today's `listParkedPlans`). */
  park(record: StoredPlanRecord): Promise<void>;
  waiting(): Promise<Array<{ host: string; record: StoredPlanRecord }>>;
  /** Take a waiting record for a host (today's `unparkPlan`). */
  unpark(host: string): Promise<StoredPlanRecord | null>;
  /** Removes waiting records not written for longer than `maxAgeMs`; returns the file names removed. */
  expireWaiting(maxAgeMs: number, now?: number): Promise<string[]>;
  /** The in-flight re-plan, if any (today's `planUpdate`): set it, read it, await it. */
  setUpdate(update: Promise<void> | null): void;
  update(): Promise<void> | null;
  /** Approval idempotency (today's `recentApprovals`). */
  rememberApproval(key: string, runId: string): void;
  recentApproval(key: string): { timestamp: number; runId: string } | undefined;
  /** Drops a key whose approval was refused, so the same key can be sent again. */
  forgetApproval(key: string): void;
  /** The Plan as the wizard receives it (today's `planForClient`). */
  forClient(plan: ReviewPlan): ReviewPlan;
  /** The Plan as written to disk, credentials replaced (today's `planForDisk`). */
  forDisk(record: StoredPlanRecord): StoredPlanRecord;
  /** A saved Plan read back into the current shape (today's `normalizeStoredPlan`). */
  normalize(record: StoredPlanRecord): StoredPlanRecord;
}

export const DEFAULT_WAITING_PLAN_DAYS = 30;

/** How long a waiting Plan is kept, from RUNNER_WAITING_PLAN_DAYS; unset or invalid values use the default. */
export function waitingPlanMaxAgeMs(env: Record<string, string | undefined> = process.env): number {
  const days = /^\d+$/.test(env.RUNNER_WAITING_PLAN_DAYS ?? '') ? Number(env.RUNNER_WAITING_PLAN_DAYS) : 0;
  return (days >= 1 ? days : DEFAULT_WAITING_PLAN_DAYS) * 86_400_000;
}

export function hostOfAddress(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

export function normalizeStoredPlan(record: StoredPlanRecord): StoredPlanRecord {
  if (!record?.plan || !record.context) return record;
  const draftPlan = record.context.draft?.plan;
  return {
    ...record,
    status: record.status ?? 'awaiting-review',
    plan: normalizePlanIntents(record.plan),
    context: {
      ...record.context,
      draft: draftPlan
        ? {
            ...record.context.draft,
            plan: { ...draftPlan, pages: draftPlan.pages.map((p) => ({ ...p, tests: normalizeTestIntents(p.tests) })) },
          }
        : record.context.draft,
    },
  };
}

export function planForClient(plan: ReviewPlan): ReviewPlan {
  const { testCases: _testCases, ...rest } = plan;
  return {
    ...rest,
    pages: plan.pages.map(({ elements: _elements, links, ...page }) => ({
      ...page,
      links: links?.filter((l) => !l.leavesSite).map((l) => ({ to: l.to, landsOn: l.landsOn }) as PageLink),
    })),
  };
}

export class DefaultPlanStore implements PlanStore {
  readonly file: string;
  private readonly dataDir: string;
  private readonly secrets: RunSecrets;
  private currentPlanRecord: StoredPlanRecord | null = null;
  private parkedPlans = new Map<string, StoredPlanRecord>();
  /** Whether waiting-plans/ has been read into parkedPlans. park, unpark and expireWaiting keep the map current after that. */
  private waitingLoaded = false;
  private planUpdate: Promise<void> | null = null;
  private recentApprovals = new Map<string, { timestamp: number; runId: string }>();

  constructor(dataDir: string, secrets: RunSecrets) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, '.qa-plan.json');
    this.secrets = secrets;
  }

  get currentRecord(): StoredPlanRecord | null {
    return this.currentPlanRecord;
  }

  get parked(): ReadonlyMap<string, StoredPlanRecord> {
    return this.parkedPlans;
  }

  async current(): Promise<StoredPlanRecord | null> {
    if (this.currentPlanRecord) {
      if (this.currentPlanRecord.status === 'done') return null;
      return this.currentPlanRecord;
    }
    const res = await readJsonSafe<StoredPlanRecord>(this.file, { currentVersion: 1 });
    if (!res.data) return null;
    const record = this.normalize(res.data);
    if (record?.plan && record?.context && record.status === 'awaiting-review') {
      this.currentPlanRecord = record;
      return this.currentPlanRecord;
    }
    return null;
  }

  set(record: StoredPlanRecord | null): void {
    this.currentPlanRecord = record;
  }

  async save(record: StoredPlanRecord): Promise<void> {
    this.currentPlanRecord = record;
    // A finished plan keeps no sign-in: only one still awaiting review may reuse its session.
    if (record.status === 'done') {
      this.secrets.savedSessions.delete(record.plan.runId);
      await this.secrets.clean(record.plan.runId);
    }
    await writeJsonAtomic(this.file, this.forDisk(record));
  }

  async clear(runId?: string): Promise<void> {
    if (runId) {
      this.secrets.savedSessions.delete(runId);
      await this.secrets.clean(runId);
    } else if (this.currentPlanRecord && ![...this.parkedPlans.values()].includes(this.currentPlanRecord)) {
      this.secrets.savedSessions.delete(this.currentPlanRecord.plan.runId);
      await this.secrets.clean(this.currentPlanRecord.plan.runId);
    }
    if (!runId || (this.currentPlanRecord && this.currentPlanRecord.plan.runId === runId)) {
      this.currentPlanRecord = null;
    }
    await fs.rm(this.file, { force: true }).catch(() => {});
  }

  hostOf(record: StoredPlanRecord): string {
    return record.context.siteHost ?? hostOfAddress(record.plan.targetUrl);
  }

  parkedFileFor(host: string): string {
    return path.join(this.dataDir, 'waiting-plans', `${host.toLowerCase().replace(/[^a-z0-9.-]+/g, '_')}.json`);
  }

  async park(record: StoredPlanRecord): Promise<void> {
    const host = this.hostOf(record);
    this.parkedPlans.set(host, record);
    const file = this.parkedFileFor(host);
    await writeJsonAtomic(file, this.forDisk(record));
  }

  /** The waiting Plans. The folder is read once; after that they come from memory, not from every file. */
  async waiting(): Promise<Array<{ host: string; record: StoredPlanRecord }>> {
    if (!this.waitingLoaded) {
      const dir = path.join(this.dataDir, 'waiting-plans');
      const names = await fs.readdir(dir).catch(() => [] as string[]);
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const res = await readJsonSafe<StoredPlanRecord>(path.join(dir, name), { currentVersion: 1 });
        if (res.data?.plan && res.data?.context) {
          const record = this.normalize(res.data);
          this.parkedPlans.set(this.hostOf(record), record);
        }
      }
      this.waitingLoaded = true;
    }
    return [...this.parkedPlans].map(([host, record]) => ({ host, record }));
  }

  async unpark(host: string): Promise<StoredPlanRecord | null> {
    let record = this.parkedPlans.get(host) ?? null;
    if (!record) {
      const res = await readJsonSafe<StoredPlanRecord>(this.parkedFileFor(host), { currentVersion: 1 });
      if (res.data) {
        record = this.normalize(res.data);
      }
    }
    this.parkedPlans.delete(host);
    await fs.rm(this.parkedFileFor(host), { force: true }).catch(() => {});
    return record?.plan && record.context ? record : null;
  }

  async expireWaiting(maxAgeMs: number, now: number = Date.now()): Promise<string[]> {
    const dir = path.join(this.dataDir, 'waiting-plans');
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const expired: string[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || now - stat.mtimeMs <= maxAgeMs) continue;
      await fs.rm(file, { force: true }).catch(() => {});
      for (const host of [...this.parkedPlans.keys()]) {
        if (this.parkedFileFor(host) === file) this.parkedPlans.delete(host);
      }
      expired.push(name);
    }
    return expired;
  }

  setUpdate(update: Promise<void> | null): void {
    this.planUpdate = update;
  }

  update(): Promise<void> | null {
    return this.planUpdate;
  }

  rememberApproval(key: string, runId: string): void {
    this.recentApprovals.set(key, { timestamp: Date.now(), runId });
  }

  recentApproval(key: string): { timestamp: number; runId: string } | undefined {
    return this.recentApprovals.get(key);
  }

  forgetApproval(key: string): void {
    this.recentApprovals.delete(key);
  }

  forClient(plan: ReviewPlan): ReviewPlan {
    return planForClient(plan);
  }

  forDisk(record: StoredPlanRecord): StoredPlanRecord {
    const { profile, ai, customHeaders, tunnelAuth, preflight, ...context } = record.context;
    const roles = profile?.roles || [];
    const notSaved = [...new Set([...(context.signInNotSaved || []), ...roles.map((r) => r.role)])];
    const sessions = this.secrets.savedSessions.get(context.runId) ?? {};
    const sessionNotSaved = [...new Set([...(context.sessionNotSaved || []), ...Object.keys(sessions)])];
    const sessionSecrets = Object.values(sessions).flatMap((s) =>
      s.cookies.flatMap((c) => {
        const value = (c as { value?: unknown } | null)?.value;
        return typeof value === 'string' && value.length >= 8 ? [{ token: value }] : [];
      })
    );
    const headerNames = Object.keys(customHeaders || this.secrets.headers || {});
    const customHeaderNames = [...new Set([...(context.customHeaderNames || []), ...headerNames])];
    const headerSecrets: Array<Partial<RoleCredential>> = [];
    const activeHeaders = customHeaders || this.secrets.headers;
    if (activeHeaders) {
      for (const val of Object.values(activeHeaders)) {
        if (typeof val === 'string' && val.length >= 3) {
          headerSecrets.push({ token: val });
        }
      }
    }
    const activeTunnel = tunnelAuth || this.secrets.tunnelAuth;
    if (activeTunnel && activeTunnel.length >= 3) {
      headerSecrets.push({ token: activeTunnel });
    }
    return new Redactor([...roles, ...sessionSecrets, ...headerSecrets]).deep({
      schemaVersion: 1,
      status: record.status ?? 'awaiting-review',
      plan: record.plan,
      context: {
        ...context,
        sessionNotSaved: sessionNotSaved.length > 0 ? sessionNotSaved : undefined,
        customHeaderNames: customHeaderNames.length > 0 ? customHeaderNames : undefined,
        profile: profile && {
          ...profile,
          roles: roles.map(
            ({
              role,
              loginPath,
              usernameSelector,
              passwordSelector,
              submitSelector,
              postLoginSelector,
              postLoginUrl,
            }) => ({
              role,
              username: '',
              loginPath,
              usernameSelector,
              passwordSelector,
              submitSelector,
              postLoginSelector,
              postLoginUrl,
            })
          ),
        },
        signInNotSaved: notSaved.length > 0 ? notSaved : undefined,
        ai: ai && { provider: ai.provider, model: ai.model },
      },
    });
  }

  normalize(record: StoredPlanRecord): StoredPlanRecord {
    return normalizeStoredPlan(record);
  }
}
