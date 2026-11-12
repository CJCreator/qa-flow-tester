import vm from 'node:vm';
import type { PageInventoryItem, PlanPage, PlanPageTest, TestCaseStep } from '@qa/types';
import type { SafetyFilter } from '../discovery/safety-filter.js';
import type { PlannerForm } from './ai-planner.js';
import { guessFillValue } from './fill-values.js';

/**
 * Rejects Plan Items: for each form that sends data, one item per rule the form itself states
 * (required, email or web address, pattern, minimum, maximum, minimum length), each with a value
 * that breaks that one rule and valid values everywhere else. The form should refuse it.
 *
 * Fixed rules, so they are planned without an AI key. Each item needs a Test Copy: it sends a form.
 */

type FormInput = PlannerForm['inputs'][number];

type RejectRule = 'required' | 'email' | 'url' | 'pattern' | 'min' | 'max' | 'minlength';

/** Field types a test can type into. */
const TEXT_TYPES = new Set([
  '',
  'text',
  'email',
  'url',
  'tel',
  'number',
  'search',
  'password',
  'textarea',
  'date',
  'time',
  'month',
]);
const CHECK_TYPES = new Set(['checkbox']);

/** Values tried, in order, for a field with a pattern, until one matches the whole pattern. */
const PATTERN_CANDIDATES = ['Test Value', 'test', 'abc123', '12345', 'A1b2C3d4', 'test.user@example.com', 'Test User'];
/** Values tried, in order, to find one the pattern refuses. Never empty: an empty value is the required rule's business. */
const NON_MATCHING = ['!', 'x', '0', '#@#', 'zzzzzzzz', '12345', 'AAAA', 'Test Value'];

/** A longer `pattern` is not read: the field gets no pattern item and no typed value. */
const MAX_PATTERN_LENGTH = 256;
/** The longest value a Rejects item types; a field that needs more gets no item. */
const MAX_VALUE_LENGTH = 1000;
/** One pattern check may take this long; a slower pattern is never run again in this process. */
const PATTERN_TIMEOUT_MS = 100;

// The page's pattern runs in a separate context with a time limit, so a pattern that backtracks
// for minutes cannot stop the runner. Results are cached: the same few values are tried for each pattern.
const matchContext = vm.createContext({ pattern: '', value: '' });
const matchScript = new vm.Script('new RegExp("^(?:" + pattern + ")$", "v").test(value)');
const matchCache = new Map<string, boolean>();
const slowPatterns = new Set<string>();

/** undefined: the pattern is too long or too slow to check, so nothing is planned from it. */
function wholeMatch(pattern: string, value: string): boolean | undefined {
  if (pattern.length > MAX_PATTERN_LENGTH || slowPatterns.has(pattern)) return undefined;
  const key = `${pattern}\u0000${value}`;
  const known = matchCache.get(key);
  if (known !== undefined) return known;
  matchContext.pattern = pattern;
  matchContext.value = value;
  let result: boolean;
  try {
    result = matchScript.runInContext(matchContext, { timeout: PATTERN_TIMEOUT_MS }) === true;
  } catch {
    if (slowPatterns.size >= 1000) slowPatterns.clear();
    slowPatterns.add(pattern);
    return undefined;
  }
  if (matchCache.size >= 5000) matchCache.clear();
  matchCache.set(key, result);
  return result;
}

/** The pattern the browser applies: none when it does not compile with the `v` flag (HTML spec). */
function patternInForce(pattern: string | undefined): string | undefined {
  if (!pattern) return undefined;
  try {
    new RegExp(`^(?:${pattern})$`, 'v'); // compiling does not backtrack; only matching can
    return pattern;
  } catch {
    return undefined;
  }
}

/**
 * A value for a simple pattern (classes, \d \w \s, literals and quantifiers; no groups or choices),
 * built from its pieces and checked against the whole pattern. undefined when it is not that simple.
 */
const BACKSLASH = String.fromCharCode(92);

function sampleFor(pattern: string): string | undefined {
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    let unit: string;
    const c = pattern[i];
    if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0 || pattern[i + 1] === '^') return undefined;
      unit =
        pattern[i + 1] === BACKSLASH
          ? (({ d: '1', w: 'a', s: ' ' } as Record<string, string>)[pattern[i + 2]] ?? pattern[i + 2])
          : pattern[i + 1];
      i = end + 1;
    } else if (c === BACKSLASH) {
      const n = pattern[i + 1];
      unit = ({ d: '1', w: 'a', s: ' ' } as Record<string, string>)[n] ?? (/[A-Za-z]/.test(n) ? '' : n);
      if (!unit) return undefined;
      i += 2;
    } else if ('()|^$'.includes(c)) return undefined;
    else {
      unit = c === '.' ? 'a' : c;
      i += 1;
    }
    let times = 1;
    const q = pattern[i];
    if (q === '{') {
      const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i));
      if (!m) return undefined;
      times = Number(m[1]);
      if (times > MAX_VALUE_LENGTH) return undefined;
      i += m[0].length;
    } else if (q === '+') {
      i += 1;
    } else if (q === '*' || q === '?') {
      times = 0;
      i += 1;
    }
    out += unit.repeat(times);
    if (out.length > MAX_VALUE_LENGTH) return undefined;
  }
  return out;
}

/** A value this field accepts, or undefined when none can be worked out (the item is then left out). */
function validValue(input: FormInput): string | undefined {
  const pattern = patternInForce(input.pattern);
  const type = (input.type || '').toLowerCase();
  let value: string;
  if (type === 'email') value = 'test.user@example.com';
  else if (type === 'url') value = 'https://example.com';
  else if (type === 'tel') value = '5555550123';
  else if (type === 'date') value = '2030-01-01';
  else if (type === 'time') value = '12:00';
  else if (type === 'month') value = '2030-01';
  else if (type === 'number') {
    const min = Number(input.min);
    const max = Number(input.max);
    value =
      input.min !== undefined && Number.isFinite(min)
        ? String(min)
        : input.max !== undefined && Number.isFinite(max)
          ? String(max)
          : '1';
  } else value = guessFillValue(`${input.selector} ${input.label ?? ''}`);
  if (pattern && wholeMatch(pattern, value) !== true) {
    const built = sampleFor(pattern);
    const fit = [...(built ? [built] : []), ...PATTERN_CANDIDATES].find(
      (c) => c !== '' && wholeMatch(pattern, c) === true
    );
    if (fit === undefined) return undefined;
    value = fit;
  }
  if (input.minLength && value.length < input.minLength) {
    if (input.minLength > MAX_VALUE_LENGTH) return undefined;
    const padded = value.padEnd(input.minLength, 'a');
    if (pattern && wholeMatch(pattern, padded) !== true) return undefined;
    value = padded;
  }
  if (input.maxLength && value.length > input.maxLength) {
    value = value.slice(0, input.maxLength);
    if (pattern && wholeMatch(pattern, value) !== true) return undefined;
  }
  return value;
}

/** The rules a field states that a test can break, each with a value that breaks only it. */
export function rejectRulesOf(input: FormInput): Array<{ rule: RejectRule; value: string; what: string }> {
  const pattern = patternInForce(input.pattern);
  const type = (input.type || '').toLowerCase();
  const out: Array<{ rule: RejectRule; value: string; what: string }> = [];
  if (!TEXT_TYPES.has(type) && !CHECK_TYPES.has(type)) return out;
  if (input.required) out.push({ rule: 'required', value: '', what: 'left empty' });
  if (!TEXT_TYPES.has(type)) return out;
  if (type === 'email') out.push({ rule: 'email', value: 'not-an-email', what: 'is not an email address' });
  if (type === 'url') out.push({ rule: 'url', value: 'not a web address', what: 'is not a web address' });
  if (pattern && type !== 'email' && type !== 'url' && validValue(input) !== undefined) {
    const bad = NON_MATCHING.find((v) => wholeMatch(pattern, v) === false);
    if (bad !== undefined) out.push({ rule: 'pattern', value: bad, what: 'does not match the expected format' });
  }
  if (type === 'number') {
    const min = Number(input.min);
    const max = Number(input.max);
    if (input.min !== undefined && Number.isFinite(min))
      out.push({ rule: 'min', value: String(min - 1), what: 'is below the minimum' });
    if (input.max !== undefined && Number.isFinite(max))
      out.push({ rule: 'max', value: String(max + 1), what: 'is above the maximum' });
  }
  // A browser stops typing at the maximum length, so a longer value can't be sent: no item for it.
  if (type !== 'number' && input.minLength && input.minLength >= 2 && input.minLength <= MAX_VALUE_LENGTH)
    out.push({ rule: 'minlength', value: 'a'.repeat(input.minLength - 1), what: 'is too short' });
  return out;
}

export interface RejectsOptions {
  safety?: SafetyFilter;
  /** The crawled pages, for the submit button's name. */
  inventory?: PageInventoryItem[];
}

/** One Rejects Plan Item per (form that sends data, rule a field states, role that reaches the page). */
export function deriveRejects(
  pages: PlanPage[],
  forms: PlannerForm[],
  options: RejectsOptions = {}
): Array<{ urlPath: string; test: PlanPageTest }> {
  const out: Array<{ urlPath: string; test: PlanPageTest }> = [];
  for (const page of pages) {
    if (page.coverage === 'covered' || page.skipped) continue;
    const roles = page.reachedBy.length > 0 ? page.reachedBy : ['visitor'];
    const inventory = options.inventory?.find((p) => p.urlPath === page.urlPath);
    const pageForms = forms.filter((f) => f.urlPath === page.urlPath);
    pageForms.forEach((form, formIdx) => {
      // Nothing is sent by a GET form (a search box): nothing to refuse.
      if (!form.submitButtonSelector || (form.method || 'GET').toUpperCase() === 'GET') return;
      const submit = form.submitButtonSelector;
      const submitName = inventory?.elements?.find((e) => e.selector === submit)?.name?.trim() || 'Send';
      // The Source: a planned test on this page that uses this form and cites a document.
      const selectors = new Set([submit, ...form.inputs.map((i) => i.selector)]);
      const sourced = page.tests.find(
        (t) => t.docSource && t.steps.some((s) => s.selector && selectors.has(s.selector))
      );
      for (const target of form.inputs) {
        const label = target.label?.trim() || target.selector;
        for (const { rule, value, what } of rejectRulesOf(target)) {
          // Every other field gets a value it accepts; if none can be worked out, the item is left out.
          const steps: TestCaseStep[] = [];
          let workable = true;
          for (const other of form.inputs) {
            const type = (other.type || '').toLowerCase();
            const name = other.label || other.selector;
            if (other.selector === target.selector) {
              if (TEXT_TYPES.has(type)) steps.push({ action: 'fill', selector: other.selector, value, name });
              continue;
            }
            if (CHECK_TYPES.has(type)) {
              if (other.required) steps.push({ action: 'check', selector: other.selector, name });
              continue;
            }
            if (!TEXT_TYPES.has(type)) {
              if (other.required) workable = false;
              continue;
            }
            const ok = validValue(other);
            if (ok === undefined) {
              workable = false;
              break;
            }
            steps.push({ action: 'fill', selector: other.selector, value: ok, name });
          }
          if (!workable) continue;
          steps.push({ action: 'click', selector: submit, name: submitName });
          for (const role of roles) {
            const id = `rejects:${page.urlPath}:${formIdx}:${target.selector}:${rule}:${role}`;
            if (page.tests.some((t) => t.id === id) || out.some((o) => o.test.id === id)) continue;
            const test: PlanPageTest = {
              id,
              name: `Rejects: “${label}” ${what}`,
              role,
              intent: 'rejects',
              steps: steps.map((s) => ({ ...s })),
              // 'observed': a form that accepts it is a real, lower-severity finding unless a Source backs it.
              expectations: { origin: 'observed', refusal: { formPath: page.urlPath, submitSelector: submit } },
              source: 'fallback',
              needsTestCopy: true,
            };
            if (form.opening?.length) test.openingSteps = form.opening.map((s) => ({ ...s }));
            if (sourced?.docSource) {
              test.docSource = sourced.docSource;
              test.proposedRoles = [role];
              test.rolesConfirmed = false;
            }
            out.push({ urlPath: page.urlPath, test });
          }
        }
      }
    });
  }
  return out;
}
