import type { Finding, FindingSeverity } from '@qa/types';
import { Redactor, redactUrl } from './redact.js';
import { validate } from './json-schema-lite.js';

/**
 * API checks from a supplied OpenAPI file (JSON). Negative-first: at least 40% of the checks send
 * something the API should refuse. Responses are checked with the in-repo subset JSON Schema validator.
 * With no spec nothing is generated and the report says so. GET-only unless writes are allowed
 * (Test Copy plus the owner's consent, ADR 0022 / 0030). No sign-in values ever reach a finding.
 */

export const NO_SPEC_NOTE = 'No API spec supplied; API checks not generated.';
export const MIN_ERROR_SHARE = 0.4;

type Obj = Record<string, unknown>;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export interface ApiCheck {
  id: string;
  method: string;
  /** Path template, e.g. /users/{id}. */
  path: string;
  /** Path with values filled in. */
  url: string;
  kind: 'happy' | 'error';
  description: string;
  /** What a good API answers: any 2xx, or any 4xx. */
  expect: 'success' | 'client-error';
  /** JSON body to send, or a raw string for the malformed-body case. */
  body?: unknown;
  rawBody?: string;
  /** True when the check sends a change (anything but GET). */
  sends: boolean;
  omitAuth?: boolean;
  /** Schema (already reduced to the validator subset) for a successful answer. */
  responseSchema?: Obj;
}

export interface ApiCheckPlan {
  checks: ApiCheck[];
  errorShare: number;
  notChecked: string[];
}

export function parseOpenApi(text: string): { spec?: Obj; error?: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: 'The API spec is not JSON. Convert the OpenAPI file to JSON and supply it again.' };
  }
  const d = doc as Obj;
  if (!d || typeof d !== 'object' || (!d.openapi && !d.swagger) || typeof d.paths !== 'object') {
    return { error: 'The file is not an OpenAPI document (no openapi version or paths).' };
  }
  return { spec: d };
}

function deref(spec: Obj, node: unknown, depth = 0): unknown {
  if (!node || typeof node !== 'object' || depth > 8) return node;
  const o = node as Obj;
  if (typeof o.$ref === 'string' && o.$ref.startsWith('#/')) {
    let cur: unknown = spec;
    for (const part of o.$ref.slice(2).split('/'))
      cur = (cur as Obj | undefined)?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    return deref(spec, cur, depth + 1);
  }
  return o;
}

/** Reduces an OpenAPI schema to what the validator supports; everything else is dropped. */
export function toLiteSchema(spec: Obj, raw: unknown, depth = 0): Obj {
  const s = deref(spec, raw, depth) as Obj | undefined;
  if (!s || typeof s !== 'object' || depth > 8) return {};
  const out: Obj = {};
  const parts = Array.isArray(s.allOf) ? (s.allOf as unknown[]).map((p) => toLiteSchema(spec, p, depth + 1)) : [];
  for (const p of parts) {
    Object.assign(out, { ...p, properties: { ...(out.properties as Obj), ...(p.properties as Obj) } });
    if (p.required) out.required = [...new Set([...((out.required as string[]) ?? []), ...(p.required as string[])])];
  }
  if (typeof s.type === 'string') out.type = s.type;
  if (Array.isArray(s.enum)) out.enum = s.enum;
  if (s.const !== undefined) out.const = s.const;
  if (typeof s.pattern === 'string') {
    try {
      new RegExp(s.pattern);
      out.pattern = s.pattern;
    } catch {
      /* unusable pattern: dropped */
    }
  }
  if (typeof s.minimum === 'number') out.minimum = s.minimum;
  if (Array.isArray(s.required))
    out.required = [...new Set([...((out.required as string[]) ?? []), ...(s.required as string[])])];
  if (s.properties && typeof s.properties === 'object') {
    out.properties = {
      ...(out.properties as Obj),
      ...Object.fromEntries(Object.entries(s.properties as Obj).map(([k, v]) => [k, toLiteSchema(spec, v, depth + 1)])),
    };
  }
  if (s.items) out.items = toLiteSchema(spec, s.items, depth + 1);
  // OpenAPI 3.0 nullable: a null answer is allowed, so the type check is lifted.
  if (s.nullable === true) delete out.type;
  if (out.properties && !out.type) out.type = 'object';
  return out;
}

function sample(schema: Obj): unknown {
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  switch (schema.type) {
    case 'object': {
      const props = (schema.properties as Obj | undefined) ?? {};
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sample(v as Obj)]));
    }
    case 'array':
      return schema.items ? [sample(schema.items as Obj)] : [];
    case 'integer':
      return Math.max(1, typeof schema.minimum === 'number' ? schema.minimum : 1);
    case 'number':
      return 1.5;
    case 'boolean':
      return true;
    default:
      return 'sample';
  }
}

function wrongTypeOf(schema: Obj): unknown {
  return schema.type === 'string' ? 12345 : 'not-a-valid-value';
}

function fill(path: string, params: Array<{ name: string; schema: Obj }>, missing = false): string {
  return path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const p = params.find((x) => x.name === name);
    const integer = p?.schema.type === 'integer' || p?.schema.type === 'number';
    if (missing) return integer ? '999999999' : '__qa_does_not_exist__';
    return String(p ? sample(p.schema) : 'sample');
  });
}

/** Builds the checks. No spec means no checks and the note "No API spec supplied; API checks not generated." */
export function generateApiChecks(spec: Obj | undefined): ApiCheckPlan {
  if (!spec) return { checks: [], errorShare: 0, notChecked: [NO_SPEC_NOTE] };
  const checks: ApiCheck[] = [];
  const fallbacks: ApiCheck[] = [];
  const hasGlobalSecurity = Array.isArray(spec.security) && spec.security.length > 0;
  let n = 0;
  const id = () => `API-${String(++n).padStart(3, '0')}`;

  for (const [path, item] of Object.entries((spec.paths as Obj) ?? {})) {
    const pathItem = deref(spec, item) as Obj;
    for (const method of METHODS) {
      const opRaw = pathItem?.[method];
      if (!opRaw) continue;
      const op = deref(spec, opRaw) as Obj;
      const sends = method !== 'get';
      const M = method.toUpperCase();
      const params = [...((pathItem.parameters as unknown[]) ?? []), ...((op.parameters as unknown[]) ?? [])]
        .map((p) => deref(spec, p) as Obj)
        .filter((p) => p && typeof p.name === 'string')
        .map((p) => ({
          name: p.name as string,
          in: p.in as string,
          required: p.required === true || p.in === 'path',
          schema: toLiteSchema(spec, p.schema),
        }));
      const pathParams = params.filter((p) => p.in === 'path');
      const query = params.filter((p) => p.in === 'query' && p.required);
      const qs = (omit?: string) => {
        const parts = query
          .filter((q) => q.name !== omit)
          .map((q) => `${encodeURIComponent(q.name)}=${encodeURIComponent(String(sample(q.schema)))}`);
        return parts.length ? `?${parts.join('&')}` : '';
      };
      const bodyRaw = (deref(spec, op.requestBody) as Obj | undefined)?.content as Obj | undefined;
      const bodySchema = bodyRaw?.['application/json']
        ? toLiteSchema(spec, (bodyRaw['application/json'] as Obj).schema)
        : undefined;
      const ok = Object.entries((op.responses as Obj) ?? {}).find(([code]) => /^2\d\d$/.test(code));
      const okContent = ok
        ? ((deref(spec, ok[1]) as Obj)?.content as Obj | undefined)?.['application/json']
        : undefined;
      const responseSchema = okContent ? toLiteSchema(spec, (okContent as Obj).schema) : undefined;
      const base = { method: M, path, sends };
      const goodBody = bodySchema ? sample(bodySchema) : undefined;

      checks.push({
        ...base,
        id: id(),
        url: fill(path, pathParams) + qs(),
        kind: 'happy',
        description: `${M} ${path} with valid input`,
        expect: 'success',
        body: goodBody,
        responseSchema: responseSchema && Object.keys(responseSchema).length ? responseSchema : undefined,
      });

      const err = (description: string, extra: Partial<ApiCheck>, target: ApiCheck[] = checks) =>
        target.push({
          ...base,
          id: id(),
          url: fill(path, pathParams) + qs(),
          kind: 'error',
          description: `${M} ${path}: ${description}`,
          expect: 'client-error',
          ...extra,
        });

      if (bodySchema) {
        const props = Object.keys((bodySchema.properties as Obj) ?? {});
        for (const req of ((bodySchema.required as string[]) ?? []).slice(0, 2)) {
          const b = { ...(goodBody as Obj) };
          delete b[req];
          err(`required field "${req}" left out`, { body: b });
        }
        const typed = props.find(
          (k) => (bodySchema.properties as Obj)[k] && ((bodySchema.properties as Obj)[k] as Obj).type
        );
        if (typed) {
          err(`field "${typed}" has the wrong type`, {
            body: { ...(goodBody as Obj), [typed]: wrongTypeOf((bodySchema.properties as Obj)[typed] as Obj) },
          });
        }
        const enumKey = props.find((k) => Array.isArray(((bodySchema.properties as Obj)[k] as Obj).enum));
        if (enumKey)
          err(`field "${enumKey}" is not an allowed value`, {
            body: { ...(goodBody as Obj), [enumKey]: '__not_allowed__' },
          });
        err('body is not valid JSON', { rawBody: '{"broken": ' });
      }
      if (query[0])
        err(`required query "${query[0].name}" left out`, { url: fill(path, pathParams) + qs(query[0].name) });
      if (pathParams.length) err('id does not exist', { url: fill(path, pathParams, true) + qs(), body: goodBody });
      const secured = hasGlobalSecurity || (Array.isArray(op.security) && op.security.length > 0);
      if (secured) err('sent without sign-in', { omitAuth: true, body: goodBody });
      // Padding candidates, used only when the share of error cases is under 40%.
      if (method === 'get' && !pathParams.length) {
        fallbacks.push({
          ...base,
          id: '',
          url: `${fill(path, pathParams).replace(/\/$/, '')}/__qa_not_found__`,
          kind: 'error',
          description: `GET ${path}/__qa_not_found__: unknown path under this resource`,
          expect: 'client-error',
        });
      }
    }
  }

  const notChecked: string[] = [];
  const hasWrites = checks.some((c) => c.sends);
  if (hasWrites)
    notChecked.push(
      "Operations that change data (POST, PUT, PATCH, DELETE) are only sent to a Test Copy with the owner's consent."
    );
  for (const f of fallbacks) {
    const share = checks.filter((c) => c.kind === 'error').length / Math.max(1, checks.length);
    if (share >= MIN_ERROR_SHARE) break;
    checks.push({ ...f, id: id() });
  }
  const errorShare = checks.filter((c) => c.kind === 'error').length / Math.max(1, checks.length);
  if (checks.length === 0) notChecked.push('The API spec lists no operations; API checks not generated.');
  else if (errorShare < MIN_ERROR_SHARE) {
    notChecked.push(
      `Only ${Math.round(errorShare * 100)}% of the API checks are error cases; the spec gave too little to build more.`
    );
  }
  return { checks, errorShare, notChecked };
}

export interface RunApiChecksOptions {
  baseUrl: string;
  /** Test Copy plus owner consent: lets checks that change data run. */
  allowWrites?: boolean;
  /** Full Authorization header value. Used for the request, hidden from every finding. */
  authHeader?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ApiChecksResult {
  findings: Finding[];
  ran: number;
  skippedWrites: number;
  errorShare: number;
  notChecked: string[];
  notes: string[];
}

function findingFor(
  n: number,
  severity: FindingSeverity,
  c: ApiCheck,
  title: string,
  actual: string,
  errors: string[] = []
): Finding {
  return {
    id: `API-F-${String(n).padStart(3, '0')}`,
    testCaseId: c.id,
    flowId: 'api-spec-checks',
    severity,
    checker: 'bug-detection',
    title,
    where: { urlPath: c.path, role: 'visitor', breakpoint: '1440px' },
    expectedVsActual: {
      expected:
        c.expect === 'success' ? 'A 2xx answer matching the documented shape' : 'A 4xx answer that refuses the request',
      actual: [actual, ...errors.slice(0, 3)].join('; '),
    },
    stepsToReproduce: [`Send ${c.method} ${c.url} (${c.description}).`],
    evidence: {},
    resolution: 'Make the API answer as its spec says, then run the API checks again.',
  };
}

export async function runApiChecks(plan: ApiCheckPlan, options: RunApiChecksOptions): Promise<ApiChecksResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const redactor = new Redactor(
    options.authHeader ? [{ token: options.authHeader.replace(/^\w+\s+/, '') }, { token: options.authHeader }] : []
  );
  const result: ApiChecksResult = {
    findings: [],
    ran: 0,
    skippedWrites: 0,
    errorShare: plan.errorShare,
    notChecked: [...plan.notChecked],
    notes: [],
  };
  if (plan.checks.length === 0) return result;
  let n = 0;
  const add = (...a: [FindingSeverity, ApiCheck, string, string, string[]?]) =>
    result.findings.push(findingFor(++n, a[0], a[1], a[2], a[3], a[4]));

  for (const c of plan.checks) {
    if (c.sends && !options.allowWrites) {
      result.skippedWrites++;
      continue;
    }
    const headers: Record<string, string> = { accept: 'application/json' };
    let body: string | undefined;
    if (c.rawBody !== undefined) body = c.rawBody;
    else if (c.body !== undefined && c.sends) body = JSON.stringify(c.body);
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (options.authHeader && !c.omitAuth) headers.authorization = options.authHeader;
    let res: Response;
    try {
      res = await doFetch(new URL(c.url, options.baseUrl), {
        method: c.method,
        headers,
        body: c.sends ? body : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(options.requestTimeoutMs ?? 10_000),
      });
    } catch {
      add('Major', c, `${c.description}: no answer`, 'No answer in time');
      result.ran++;
      continue;
    }
    result.ran++;
    const text = await res.text().catch(() => '');
    if (c.expect === 'client-error') {
      if (res.status >= 500) add('Major', c, `Server error on bad input: ${c.description}`, `Answered ${res.status}`);
      else if (res.status >= 200 && res.status < 300)
        add('Major', c, `Bad input accepted: ${c.description}`, `Answered ${res.status}`);
    } else if (res.status < 200 || res.status >= 300) {
      add('Major', c, `Valid request refused: ${c.description}`, `Answered ${res.status}`);
    } else if (c.responseSchema) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        add('Major', c, `Answer is not JSON: ${c.description}`, `Answered ${res.status} with a body that is not JSON`);
        continue;
      }
      const errors = validate(c.responseSchema, parsed);
      if (errors.length > 0)
        add(
          'Major',
          c,
          `Answer does not match the documented shape: ${c.description}`,
          `Answered ${res.status}`,
          errors
        );
    }
  }
  if (result.skippedWrites > 0) {
    result.notChecked.push(`${result.skippedWrites} API checks that change data were not sent (no Test Copy consent).`);
  }
  result.notes.push(
    `Ran ${result.ran} API checks; ${Math.round(plan.errorShare * 100)}% of the planned checks send input the API should refuse.`
  );
  result.findings = redactor.deep(result.findings).map((f) => ({ ...f, title: redactUrl(f.title) }));
  result.notChecked = result.notChecked.map(redactUrl);
  return result;
}

/**
 * Report wiring for the lead: `apiChecksSection(result)` returns the lines for a "API checks" section.
 * `result.findings` go into `report.findings`, `result.notChecked` into `report.notChecked`.
 */
export function apiChecksSection(result: ApiChecksResult): string[] {
  if (result.ran === 0 && result.notChecked.includes(NO_SPEC_NOTE)) return [NO_SPEC_NOTE];
  return [...result.notes, ...result.notChecked];
}
