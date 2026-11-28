/**
 * The JSON object in a model's answer, without code fences or chatter around it. Small free models
 * often leave a comma before a closing bracket; that one slip is forgiven, nothing else is guessed.
 */
export function parseJsonAnswer(text: string): any {
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const body = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  try {
    return JSON.parse(body);
  } catch (err) {
    const withoutTrailingCommas = body.replace(/,(\s*[}\]])/g, '$1');
    if (withoutTrailingCommas === body) throw err;
    return JSON.parse(withoutTrailingCommas);
  }
}
