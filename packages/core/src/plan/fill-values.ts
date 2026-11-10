/**
 * The words that describe a field, lower-cased, with selector syntax taken out: in `input[name="quantity"]`
 * the attribute word "name" says nothing about the field, only its value does.
 */
export function fieldHint(target: string): string {
  return target
    .toLowerCase()
    .replace(/\b(name|id|type|placeholder|aria-label|data-testid|for)\s*=/g, ' ');
}

/** A believable value for a form field, from its selector and label. */
export function guessFillValue(target: string): string {
  const hint = fieldHint(target);
  if (hint.includes('email')) return 'test.user@example.com';
  if (hint.includes('password') || hint.includes('pass')) return 'TestPassword123!';
  if (
    hint.includes('url') ||
    hint.includes('address') ||
    hint.includes('site') ||
    hint.includes('domain') ||
    hint.includes('host')
  )
    return 'https://example.com';
  if (hint.includes('phone') || hint.includes('tel')) return '5555550123';
  if (/number|amount|qty|quantity|price/.test(hint)) return '1';
  if (hint.includes('name')) return 'Test User';
  return 'Test Value';
}
