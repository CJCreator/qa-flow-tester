/** Provider error text that is safe to show and log: no key, no raw JSON, short. */

const MAX_CHARS = 300;

/** The text with every occurrence of the API key replaced. */
export function scrubKey(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join('[key]') : text;
}

/**
 * The message from an upstream error body (Google, Anthropic, OpenAI and OpenRouter shapes), without the JSON
 * around it. OpenRouter's `error.metadata.raw` (its upstream provider's own words) is added when it is text,
 * and a `[status]` tag when the body gives one. Plain text bodies are returned as sent. The key is removed,
 * whitespace collapsed, and the result is at most 300 characters.
 */
export function summarizeApiError(body: string, apiKey: string): string {
  let text = body;
  try {
    const err = (
      JSON.parse(body) as {
        error?: { message?: unknown; status?: unknown; metadata?: { raw?: unknown } };
      }
    ).error;
    if (err && typeof err.message === 'string' && err.message) {
      const raw = err.metadata?.raw;
      text = typeof raw === 'string' && raw ? `${err.message}: ${raw}` : err.message;
      if (typeof err.status === 'string' && err.status) text = `${text} [${err.status}]`;
    }
  } catch {
    // not JSON: the text as sent
  }
  const clean = scrubKey(text, apiKey).replace(/\s+/g, ' ').trim();
  return clean.length > MAX_CHARS ? `${clean.slice(0, MAX_CHARS - 3)}...` : clean;
}
