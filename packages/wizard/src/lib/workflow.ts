// The one workflow template lives in templates/qa-check.yml, so the file people copy from this page
// and the one in the repo can't drift apart.
import template from '../../../../templates/qa-check.yml?raw';

/** Pinned release tag of the QA Tool the workflow gets. Bump with the version; a test guards it. */
export const TOOL_REF = 'v0.1.0';

/**
 * The shared online copy (the full app on a free host), when one is published. Set VITE_ONLINE_APP_URL
 * when building; without it the page doesn't offer it.
 */
export const ONLINE_APP_URL: string | null =
  (import.meta.env.VITE_ONLINE_APP_URL as string | undefined)?.trim() || null;

export const WORKFLOW_PATH = '.github/workflows/qa-check.yml';

/** A single-quoted YAML value: the only character to escape is the quote itself. */
const yamlQuote = (value: string) => value.replace(/'/g, "''");

/** The workflow file, with the address people typed filled in as the default to check. */
export function workflowFor(url: string): string {
  return template.replace('__DEFAULT_URL__', yamlQuote(url.trim())).replace('__QA_TOOL_REF__', TOOL_REF);
}

/** Where to open the repo's Actions page from, when the repo address is known. */
export function actionsPageFor(repo: string): string | null {
  const match = repo.trim().match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return match ? `https://github.com/${match[1]}/${match[2]}/actions/workflows/qa-check.yml` : null;
}
