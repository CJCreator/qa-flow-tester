import type { DocSource, Finding, TestCase } from '@qa/types';

/** "Admin guide" or "Admin guide, section Users > Create". */
export function describeSource(source: DocSource): string {
  return source.section ? `${source.document}, section ${source.section}` : source.document;
}

/**
 * Words a finding the way ADR 0020 says:
 * - A failed expectation that came from a document (a Source) reads "Behaviour differs from <document>",
 *   with the Source as what was expected, and the severity the person chose (default Major). When the person
 *   said the document is out of date, it is "Could not verify" instead.
 * - A failed AI guess about logical flow is a judgement item: held out of the verdict until the person accepts it.
 * Anything else is returned unchanged. The generated words never say "bug".
 */
export function withSourceWording(f: Finding, testCase: TestCase): Finding {
  if (f.checker !== 'spec-conformance') return f;
  const guess = testCase.expectations?.origin === 'ai-guess';
  if (guess) {
    return f.needsConfirmation ? { ...f, needsJudgement: true, ...(testCase.docSource ? { docSource: testCase.docSource } : {}) } : f;
  }
  if (!testCase.docSource || f.needsConfirmation) return f;
  const named = describeSource(testCase.docSource);
  const stale = testCase.docStale === true;
  return {
    ...f,
    title: `Behaviour differs from ${named}${stale ? ' (the document may be out of date)' : ''}`,
    severity: testCase.docSeverity ?? 'Major',
    docSource: testCase.docSource,
    expectedVsActual: {
      expected: `${named} says: ${f.expectedVsActual.expected}`,
      actual: f.expectedVsActual.actual,
    },
    resolution: stale
      ? `Check whether ${named} is out of date. If the app is right, update the document.`
      : `Change the app to match ${named}, or update the document if the app is right.`,
    ...(stale ? { needsConfirmation: true } : {}),
  };
}
