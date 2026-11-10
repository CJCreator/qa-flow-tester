/**
 * Shared input rules and validation helpers for roles and headers.
 * Pure, browser-safe module: no Node imports.
 */

export const ROLE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
export const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
export const MAX_CUSTOM_HEADERS = 20;
export const MAX_HEADER_VALUE_LENGTH = 2048;

/** Checks if a header value is safe (no CR, LF, NUL; length cap). */
export function isSafeHeaderValue(v: string): boolean {
  if (typeof v !== 'string') return false;
  if (v.length > MAX_HEADER_VALUE_LENGTH) return false;
  return !/[\r\n\0]/.test(v);
}

/**
 * Parses multiline "Name: value" text into a headers map.
 * Errors identify the 1-based line and never echo the header value.
 */
export function parseHeaderText(text: string): { headers: Record<string, string>; errors: string[] } {
  const headers: Record<string, string> = {};
  const errors: string[] = [];

  if (!text || typeof text !== 'string') {
    return { headers, errors };
  }

  const lines = text.split(/\r?\n/);
  let count = 0;
  // Lower-cased name -> the name as last written. Header names are case-insensitive, and a Map sees
  // only what was added here (a plain object also "has" constructor, toString and __proto__).
  const written = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const lineNum = i + 1;
    const colonIndex = rawLine.indexOf(':');
    if (colonIndex === -1) {
      errors.push(`Line ${lineNum}: header must be in "Name: value" format`);
      continue;
    }

    const name = rawLine.slice(0, colonIndex).trim();
    const value = rawLine.slice(colonIndex + 1).trim();

    if (!HEADER_NAME_PATTERN.test(name)) {
      errors.push(`Line ${lineNum}: invalid header name "${name}"`);
      continue;
    }

    if (!isSafeHeaderValue(value)) {
      errors.push(`Line ${lineNum}: invalid header value`);
      continue;
    }

    const key = name.toLowerCase();
    const earlier = written.get(key);

    if (count >= MAX_CUSTOM_HEADERS && earlier === undefined) {
      errors.push(`Line ${lineNum}: maximum of ${MAX_CUSTOM_HEADERS} headers exceeded`);
      continue;
    }

    if (earlier === undefined) {
      count++;
    } else if (earlier !== name) {
      // The same header written with other capitals: the last one replaces it.
      delete headers[earlier];
    }
    written.set(key, name);
    // defineProperty, so a name like __proto__ becomes an ordinary own property.
    Object.defineProperty(headers, name, { value, enumerable: true, writable: true, configurable: true });
  }

  return { headers, errors };
}
