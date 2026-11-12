/**
 * The words that describe a field, lower-cased, with selector syntax taken out: in `input[name="quantity"]`
 * the attribute word "name" says nothing about the field, only its value does.
 */
export function fieldHint(target: string): string {
  return target.toLowerCase().replace(/\b(name|id|type|placeholder|aria-label|data-testid|for)\s*=/g, ' ');
}

/** A believable value for a form field, from its selector and label. */
export function guessFillValue(target: string): string {
  const hint = fieldHint(target);
  if (hint.includes('email')) return 'test.user@example.com';
  if (hint.includes('password') || hint.includes('pass')) return 'TestPassword123!';
  if (hint.includes('search') || hint.includes('query') || hint.includes('find')) return 'test';
  if (hint.includes('date') || hint.includes('birth') || hint.includes('dob')) return '2026-11-01';
  if (hint.includes('zip') || hint.includes('postal')) return '90210';
  if (hint.includes('price') || hint.includes('cost') || hint.includes('total')) return '49.99';
  if (
    hint.includes('url') ||
    hint.includes('address') ||
    hint.includes('site') ||
    hint.includes('domain') ||
    hint.includes('host')
  )
    return 'https://example.com';
  if (hint.includes('phone') || hint.includes('tel') || hint.includes('mobile')) return '+15555550123';
  if (
    hint.includes('number') ||
    hint.includes('amount') ||
    hint.includes('qty') ||
    hint.includes('quantity') ||
    hint.includes('count')
  )
    return '1';
  if (hint.includes('first') && hint.includes('name')) return 'Alex';
  if (hint.includes('last') && hint.includes('name')) return 'Smith';
  if (hint.includes('name')) return 'Test User';
  return 'Test Value';
}
