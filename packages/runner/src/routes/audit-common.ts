/** Helpers shared by the Website Audit route modules. */

const VERSION = /^[1-9][0-9]{0,6}$/;

/**
 * The `?version=` of a Website Audit request: the number, undefined when the query has none (the caller
 * then uses the latest version), or 'invalid' for anything that is not a whole number from 1.
 */
export function versionQuery(url: URL): number | undefined | 'invalid' {
  const raw = url.searchParams.get('version');
  if (raw === null) return undefined;
  return VERSION.test(raw) ? Number(raw) : 'invalid';
}
