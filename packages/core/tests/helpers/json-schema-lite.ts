/**
 * A tiny JSON Schema validator for tests (no ajv dependency, see ADR 0017). Supports only
 * `type, required, properties, items, enum, const, pattern, minimum` plus annotation keywords.
 * Any other keyword throws, so the schema cannot silently outgrow this validator.
 */
const SUPPORTED = new Set(['type', 'required', 'properties', 'items', 'enum', 'const', 'pattern', 'minimum']);
const ANNOTATIONS = new Set(['$schema', 'title', 'description']);

type Schema = Record<string, unknown>;

export function unsupportedKeywords(schema: unknown, found: Set<string> = new Set()): string[] {
  if (!schema || typeof schema !== 'object') return [...found];
  for (const key of Object.keys(schema as Schema)) {
    if (!SUPPORTED.has(key) && !ANNOTATIONS.has(key)) found.add(key);
  }
  const s = schema as Schema;
  if (s.properties && typeof s.properties === 'object') {
    for (const sub of Object.values(s.properties as Schema)) unsupportedKeywords(sub, found);
  }
  if (s.items) unsupportedKeywords(s.items, found);
  return [...found];
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function typeMatches(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

/** Returns a list of error strings; empty means valid. Throws on an unsupported keyword. */
export function validate(schema: unknown, value: unknown, at: string = '$'): string[] {
  const bad = unsupportedKeywords(schema);
  if (bad.length > 0) throw new Error(`json-schema-lite: unsupported keyword(s): ${bad.join(', ')}`);
  return check(schema as Schema, value, at);
}

function check(schema: Schema, value: unknown, at: string): string[] {
  const errors: string[] = [];
  if (schema.type !== undefined && !typeMatches(value, schema.type as string)) {
    return [`${at}: expected ${String(schema.type)}, got ${typeOf(value)}`];
  }
  if (schema.const !== undefined && value !== schema.const)
    errors.push(`${at}: expected const ${String(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    errors.push(`${at}: not one of ${schema.enum.join('|')}`);
  if (typeof schema.pattern === 'string' && (typeof value !== 'string' || !new RegExp(schema.pattern).test(value))) {
    errors.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    errors.push(`${at}: below minimum ${schema.minimum}`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in obj)) errors.push(`${at}: missing required ${key}`);
    }
    for (const [key, sub] of Object.entries((schema.properties as Schema | undefined) ?? {})) {
      if (key in obj) errors.push(...check(sub as Schema, obj[key], `${at}.${key}`));
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => errors.push(...check(schema.items as Schema, item, `${at}[${i}]`)));
  }
  return errors;
}
